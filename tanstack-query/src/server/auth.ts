import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { SESSION_COOKIE, SESSION_SECONDS } from '@/session-cookie';
import type { SessionUser } from '@/model';
import { db } from './db/client';
import { customer, userSession, users } from './db/schema';
import { badRequest, unauthorized } from './http';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Password hash stored as "<salt hex>:<hash hex>". */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [saltHex, hashHex] = String(stored).split(':');
    if (!saltHex || !hashHex || saltHex.length % 2 !== 0 || hashHex.length % 2 !== 0) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = scryptSync(password, salt, expected.length);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

type UserRow = {
  userId: number;
  username: string;
  displayName: string;
  passwordHash: string;
  customerId: number;
  customerName: string;
};

function toUser(row: Pick<UserRow, 'userId' | 'username' | 'displayName' | 'customerId' | 'customerName'>): SessionUser {
  return {
    id: row.userId,
    username: row.username,
    displayName: row.displayName,
    customerId: row.customerId,
    customer: row.customerName,
  };
}

async function findActiveUser(username: string): Promise<UserRow | undefined> {
  const rows = await db
    .select({
      userId: users.userId,
      username: users.username,
      displayName: users.displayName,
      passwordHash: users.passwordHash,
      customerId: users.customerId,
      customerName: customer.name,
    })
    .from(users)
    .innerJoin(customer, eq(users.customerId, customer.customerId))
    .where(and(sql`lower(${users.username}) = lower(${username})`, eq(users.isActive, true)))
    .limit(1);
  return rows[0];
}

/**
 * Check a username and password. Unknown user and wrong password throw the same 401.
 * Does not set a cookie; the login route does that after createSession.
 */
export async function loginUser(username: unknown, password: unknown): Promise<SessionUser> {
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    throw badRequest('Username and password are required');
  }
  const row = await findActiveUser(username.trim());
  if (!row || !verifyPassword(password, row.passwordHash)) throw unauthorized('Invalid username or password');
  return toUser(row);
}

/** Store only the SHA-256 of the token. The raw token goes in the cookie. */
export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_SECONDS * 1000);
  await db.delete(userSession).where(lt(userSession.expiresDateTime, new Date()));
  await db.insert(userSession).values({
    tokenHash: sha256(token),
    userId,
    expiresDateTime: expires,
  });
  return token;
}

export async function setSessionCookie(token: string) {
  const { cookies } = await import('next/headers');
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  });
}

export async function clearSessionCookie() {
  const { cookies } = await import('next/headers');
  const jar = await cookies();
  jar.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/** Resolve the session cookie to its user, or throw 401. */
export async function requireUser(): Promise<SessionUser> {
  const { cookies } = await import('next/headers');
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) throw unauthorized('Your session expired');
  const rows = await db
    .select({
      userId: users.userId,
      username: users.username,
      displayName: users.displayName,
      customerId: users.customerId,
      customerName: customer.name,
    })
    .from(userSession)
    .innerJoin(users, eq(userSession.userId, users.userId))
    .innerJoin(customer, eq(users.customerId, customer.customerId))
    .where(and(eq(userSession.tokenHash, sha256(token)), gt(userSession.expiresDateTime, new Date()), eq(users.isActive, true)))
    .limit(1);
  if (!rows[0]) throw unauthorized('Your session expired');
  return toUser(rows[0]);
}

export async function logout() {
  const { cookies } = await import('next/headers');
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(userSession).where(eq(userSession.tokenHash, sha256(token)));
  await clearSessionCookie();
}
