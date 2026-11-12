// Username/password sign-in with opaque bearer tokens stored (hashed) in pi.user_session.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { badRequest, unauthorized } from './errors.js';

const SESSION_HOURS = 8;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function hashPassword(password) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

const USER_SQL = `SELECT u.user_id, u.username, u.display_name, u.password_hash, u.customer_id, c.name AS customer_name
  FROM pi.users u JOIN pi.customer c USING (customer_id)`;

const toUser = (r) => ({ id: r.user_id, username: r.username, displayName: r.display_name, customerId: r.customer_id, customer: r.customer_name });

export async function login(pool, { username, password } = {}) {
  if (!username || !password) throw badRequest('Username and password are required');
  const { rows } = await pool.query(`${USER_SQL} WHERE lower(u.username) = lower($1) AND u.is_active`, [String(username)]);
  // Same message for unknown user and wrong password.
  if (!rows[0] || !verifyPassword(String(password), rows[0].password_hash)) throw unauthorized('Invalid username or password');

  const token = randomBytes(32).toString('hex');
  await pool.query('DELETE FROM pi.user_session WHERE expires_date_time < now()');
  const { rows: s } = await pool.query(
    `INSERT INTO pi.user_session (token_hash, user_id, expires_date_time)
     VALUES ($1, $2, now() + make_interval(hours => $3)) RETURNING expires_date_time`,
    [sha256(token), rows[0].user_id, SESSION_HOURS],
  );
  return { token, expiresAt: s[0].expires_date_time, user: toUser(rows[0]) };
}

export async function logout(pool, token) {
  if (token) await pool.query('DELETE FROM pi.user_session WHERE token_hash = $1', [sha256(token)]);
}

/** Resolve a bearer token to its user, or throw 401. */
export async function authenticate(pool, token) {
  if (!token) throw unauthorized();
  const { rows } = await pool.query(
    `${USER_SQL} JOIN pi.user_session s USING (user_id)
     WHERE s.token_hash = $1 AND s.expires_date_time > now() AND u.is_active`,
    [sha256(token)],
  );
  if (!rows[0]) throw unauthorized('Session expired. Please sign in again.');
  return toUser(rows[0]);
}

export function bearerToken(headers) {
  const m = /^Bearer\s+(\S+)$/i.exec(headers.authorization || '');
  return m ? m[1] : null;
}
