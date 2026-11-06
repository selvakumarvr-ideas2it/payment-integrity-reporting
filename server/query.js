// App API Query rollback: Postgres bi_engine.execute_query.
// The Function API tab calls the Azure Function App financial-impact endpoint, not this path.
import { fromPgError } from './errors.js';

export function createPostgresExecuteQuery(pool) {
  return async function executeQuery(user, request) {
    try {
      const { rows } = await pool.query('SELECT bi_engine.execute_query($1, $2::jsonb) AS result', [
        user.id,
        JSON.stringify(request ?? {}),
      ]);
      return rows[0].result;
    } catch (e) {
      throw fromPgError(e);
    }
  };
}
