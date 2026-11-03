// One-shot Snowflake login check. Prints the real driver error, never the password.
//   node --env-file-if-exists=.env.local scripts/snowflake-ping.mjs
import { createRequire } from 'node:module';
import { describeSnowflakeError, snowflakeConfigFromEnv } from '../server/db/snowflake.js';

const require = createRequire(import.meta.url);
const snowflake = require('snowflake-sdk');

snowflake.configure({ logLevel: 'DEBUG', disableOCSPChecks: true });

const cfg = snowflakeConfigFromEnv();
const host = cfg.accessUrl || `https://${String(cfg.account).replace(/_/, '-')}.snowflakecomputing.com`;
console.log(
  JSON.stringify(
    {
      account: cfg.account,
      username: cfg.username,
      warehouse: cfg.warehouse,
      role: cfg.role,
      database: cfg.database,
      schema: cfg.schema,
      authenticator: cfg.authenticator || 'SNOWFLAKE (password)',
      hasPassword: Boolean(cfg.password),
      hasPrivateKey: Boolean(cfg.privateKey),
      hostHint: host,
    },
    null,
    2,
  ),
);

const conn = snowflake.createConnection(cfg);
conn.connect((err) => {
  if (!err) {
    console.log('Connected. session id:', conn.getId());
    conn.destroy(() => process.exit(0));
    return;
  }
  const cause = err.cause || err.originalError || err;
  console.error('connect failed:', describeSnowflakeError(err));
  console.error({
    message: err.message,
    code: err.code,
    name: err.name,
    causeMessage: cause?.message,
    causeCode: cause?.code,
    causeErrno: cause?.errno,
    causeSyscall: cause?.syscall,
    causeAddress: cause?.address,
    causePort: cause?.port,
    responseStatus: err.response?.statusCode || err.response?.status,
    dataMessage: err.data?.message || err.data?.data?.message,
    dataCode: err.data?.code || err.data?.data?.errorCode,
  });
  if (cause?.stack) console.error(String(cause.stack).split('\n').slice(0, 8).join('\n'));
  process.exit(1);
});
