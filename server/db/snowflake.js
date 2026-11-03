// Snowflake connection used by the Function API to CALL PI.BI_ENGINE.EXECUTE_QUERY.
// Auth is password (SNOWFLAKE_PASSWORD) or key-pair (SNOWFLAKE_PRIVATE_KEY_PATH). Never log either.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const snowflake = require('snowflake-sdk');

const CALL_SQL =
  'CALL PI.BI_ENGINE.EXECUTE_QUERY(PARSE_JSON(?), ?, ?, TRUE, FALSE)';

snowflake.configure({ logLevel: 'ERROR' });

export function describeSnowflakeError(err) {
  if (!err) return 'unknown Snowflake error';
  const status = err.response?.statusCode ?? err.response?.status;
  const dataMsg = err.data?.message || err.data?.data?.message;
  const cause = err.cause && err.cause !== err ? err.cause.message : null;
  const parts = [err.message || 'Snowflake request failed'];
  if (status) parts.push(`HTTP ${status}`);
  if (dataMsg) parts.push(dataMsg);
  if (cause && cause !== err.message) parts.push(cause);
  if (status === 404) {
    parts.push(
      'The account identifier is wrong for the login host. In Snowsight run: SELECT CURRENT_ORGANIZATION_NAME() || \'-\' || CURRENT_ACCOUNT_NAME(); and set SNOWFLAKE_ACCOUNT to that value (org-account, not the locator). Or set SNOWFLAKE_ACCESS_URL to the host in the Snowsight address bar, e.g. https://myorg-myaccount.snowflakecomputing.com',
    );
  }
  return parts.join(' — ');
}

export function snowflakeConfigFromEnv(env = process.env) {
  const account = env.SNOWFLAKE_ACCOUNT?.trim();
  const username = env.SNOWFLAKE_USER?.trim();
  if (!account || !username) {
    throw new Error('Snowflake is enabled but SNOWFLAKE_ACCOUNT and SNOWFLAKE_USER are not set. Add them to .env.local, or set BI_ENGINE_BACKEND=postgres.');
  }

  const accessUrl = env.SNOWFLAKE_ACCESS_URL?.trim().replace(/\/$/, '');
  const cfg = {
    account,
    username,
    warehouse: env.SNOWFLAKE_WAREHOUSE || 'PI_BI_WH',
    role: env.SNOWFLAKE_ROLE || 'SYSADMIN',
    database: env.SNOWFLAKE_DATABASE || 'PI',
    schema: env.SNOWFLAKE_SCHEMA || 'BI_ENGINE',
    application: 'pi-function-api',
    clientSessionKeepAlive: true,
    sfRetryMaxLoginRetries: 1,
    ...(accessUrl ? { accessUrl } : {}),
  };

  const keyPath = env.SNOWFLAKE_PRIVATE_KEY_PATH?.trim();
  if (keyPath) {
    cfg.authenticator = 'SNOWFLAKE_JWT';
    cfg.privateKey = readFileSync(keyPath, 'utf8');
    if (env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE) cfg.privateKeyPass = env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE;
  } else if (env.SNOWFLAKE_PASSWORD) {
    cfg.password = env.SNOWFLAKE_PASSWORD;
  } else {
    throw new Error('Set SNOWFLAKE_PASSWORD or SNOWFLAKE_PRIVATE_KEY_PATH in .env.local.');
  }
  return cfg;
}

function parseCallResult(rows) {
  if (!rows?.length) throw new Error('Snowflake EXECUTE_QUERY returned no rows');
  const raw = Object.values(rows[0])[0];
  if (raw == null) throw new Error('Snowflake EXECUTE_QUERY returned an empty result');
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

function execute(conn, sqlText, binds) {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText,
      binds,
      complete: (err, _stmt, rows) => (err ? reject(err) : resolve(rows)),
    });
  });
}

/** Connection pool + CALL helper. Create once at process start. */
function wrap(err) {
  const wrapped = new Error(describeSnowflakeError(err));
  wrapped.cause = err;
  return wrapped;
}

export function createSnowflake(env = process.env) {
  const connectionOptions = snowflakeConfigFromEnv(env);
  const pool = snowflake.createPool(connectionOptions, {
    max: Number(env.SNOWFLAKE_POOL_MAX || 8),
    min: 0,
    evictionRunIntervalMillis: 60_000,
    idleTimeoutMillis: 300_000,
  });

  return {
    host: connectionOptions.accessUrl || `https://${connectionOptions.account}.snowflakecomputing.com`,
    async callExecuteQuery(payload, { userId, clientIp } = {}) {
      try {
        return await pool.use(async (conn) => {
          const rows = await execute(conn, CALL_SQL, [
            JSON.stringify(payload),
            userId == null ? null : String(userId),
            clientIp ?? null,
          ]);
          return parseCallResult(rows);
        });
      } catch (err) {
        throw wrap(err);
      }
    },
    async ping() {
      try {
        return await pool.use(async (conn) => {
          await execute(conn, 'SELECT 1', []);
        });
      } catch (err) {
        throw wrap(err);
      }
    },
    async close() {
      if (typeof pool.drain === 'function') await pool.drain();
      if (typeof pool.clear === 'function') await pool.clear();
    },
  };
}

export { parseCallResult };
