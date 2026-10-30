/** httpOnly cookie that holds the raw session token. The database stores only its SHA-256. */
export const SESSION_COOKIE = process.env.SESSION_COOKIE || 'pi_session';

export const SESSION_SECONDS = 8 * 60 * 60;
