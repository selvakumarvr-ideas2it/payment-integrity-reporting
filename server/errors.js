/** An error that maps to an HTTP status; the message is safe to show to the client. */
export class ApiError extends Error {
  constructor(status, message, field) {
    super(message);
    this.status = status;
    if (field) this.field = field;
  }
}

export const badRequest = (message, field) => new ApiError(400, message, field);
export const unauthorized = (message = 'Sign in required') => new ApiError(401, message);
export const forbidden = (message = 'Not allowed') => new ApiError(403, message);
export const notFound = (message = 'Not found') => new ApiError(404, message);
export const conflict = (message, field) => new ApiError(409, message, field);

// SQLSTATEs raised on purpose by bi_engine.fail(); anything else stays a 500.
const PG_STATUS = { 22023: 400, P0002: 404, 42501: 403 };

export function fromPgError(e) {
  const status = PG_STATUS[e?.code];
  return status ? new ApiError(status, e.message, e.detail || undefined) : e;
}
