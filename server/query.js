// App API Query rollback: Postgres bi_engine.execute_query.
// The Function API tab uses the separate query service (Snowflake), not this path.
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
