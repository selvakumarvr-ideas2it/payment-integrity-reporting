import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeSnowflakeError, snowflakeConfigFromEnv } from './snowflake.js';

describe('snowflakeConfigFromEnv', () => {
  it('uses password auth and SYSADMIN by default', () => {
    const cfg = snowflakeConfigFromEnv({
      SNOWFLAKE_ACCOUNT: 'HH07160',
      SNOWFLAKE_USER: 'demo',
      SNOWFLAKE_PASSWORD: 'secret',
    });
    expect(cfg).toMatchObject({
      account: 'HH07160',
      username: 'demo',
      password: 'secret',
      warehouse: 'PI_BI_WH',
      role: 'SYSADMIN',
      database: 'PI',
      schema: 'BI_ENGINE',
    });
    expect(cfg.authenticator).toBeUndefined();
  });

  it('uses key-pair auth when a private key file is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-sf-'));
    const path = join(dir, 'key.p8');
    writeFileSync(path, '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n');
    const cfg = snowflakeConfigFromEnv({
      SNOWFLAKE_ACCOUNT: 'HH07160',
      SNOWFLAKE_USER: 'svc',
      SNOWFLAKE_PRIVATE_KEY_PATH: path,
      SNOWFLAKE_ROLE: 'PI_BI_API',
    });
    expect(cfg.authenticator).toBe('SNOWFLAKE_JWT');
    expect(cfg.privateKey).toContain('BEGIN PRIVATE KEY');
    expect(cfg.role).toBe('PI_BI_API');
    expect(cfg.password).toBeUndefined();
  });

  it('passes through SNOWFLAKE_ACCESS_URL', () => {
    const cfg = snowflakeConfigFromEnv({
      SNOWFLAKE_ACCOUNT: 'myorg-myaccount',
      SNOWFLAKE_USER: 'demo',
      SNOWFLAKE_PASSWORD: 'secret',
      SNOWFLAKE_ACCESS_URL: 'https://myorg-myaccount.snowflakecomputing.com/',
    });
    expect(cfg.account).toBe('myorg-myaccount');
    expect(cfg.accessUrl).toBe('https://myorg-myaccount.snowflakecomputing.com');
  });

  it('explains an HTTP 404 as a wrong account identifier', () => {
    const msg = describeSnowflakeError({ message: 'Request to Snowflake failed.', response: { status: 404 } });
    expect(msg).toMatch(/HTTP 404/);
    expect(msg).toMatch(/CURRENT_ORGANIZATION_NAME/);
  });

  it('fails clearly when account or credentials are missing', () => {
    expect(() => snowflakeConfigFromEnv({})).toThrow(/SNOWFLAKE_ACCOUNT/);
    expect(() => snowflakeConfigFromEnv({ SNOWFLAKE_ACCOUNT: 'A', SNOWFLAKE_USER: 'u' })).toThrow(/SNOWFLAKE_PASSWORD/);
  });
});
