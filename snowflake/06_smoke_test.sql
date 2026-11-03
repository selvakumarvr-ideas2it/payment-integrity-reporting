-- 06_smoke_test.sql : run these one at a time after 01-04 (05 is optional; and after loading CORE.FACT_SAVINGS).
-- Each statement says what a good result looks like.

USE ROLE SYSADMIN;
USE WAREHOUSE PI_BI_WH;
USE DATABASE PI;

-- 1. Objects exist. Expect 9 BI_ENGINE tables and the EXECUTE_QUERY procedure.
SHOW TABLES IN SCHEMA PI.BI_ENGINE;
SHOW PROCEDURES LIKE 'EXECUTE_QUERY' IN SCHEMA PI.BI_ENGINE;

-- 2. The fact has data. Expect 2,400 rows for customer 1 once the synthetic CSV is loaded.
SELECT CUSTOMER_ID, COUNT(*) AS ROWS_LOADED, MIN(MONTH), MAX(MONTH) FROM PI.CORE.FACT_SAVINGS GROUP BY 1;

-- 3. SQL_ONLY: see the generated SQL without running it. Expect STATUS = OK and a "sql" field with one CTE (c1..c3).
CALL PI.BI_ENGINE.EXECUTE_QUERY(
  PARSE_JSON('{"customerId":1,"lineOfBusinessId":1,"measures":["claimsDenied","grossSavings","amount"],"aggregates":[{"attributeKey":"month"}],"months":24}'),
  'smoke-test', '127.0.0.1', TRUE, TRUE);

-- 4. The Savings Invoice request the React app sends today. Expect 24 rows (newest month first), 3 measure columns.
CALL PI.BI_ENGINE.EXECUTE_QUERY(
  PARSE_JSON('{"customerId":1,"lineOfBusinessId":1,"measures":["claimsDenied","grossSavings","amount"],
               "aggregates":[{"attributeKey":"month","grain":"month"}],
               "filters":[{"attributeKey":"market","values":["AZ","TX"]}],
               "months":24,"attributeValues":["market","programType"]}'),
  'smoke-test', '127.0.0.1');

-- 5. KPI totals: the same measures with no aggregates. Expect one row.
CALL PI.BI_ENGINE.EXECUTE_QUERY(
  PARSE_JSON('{"customerId":1,"lineOfBusinessId":1,"measures":["claimsDenied","grossSavings","amount"],"months":24}'), 'smoke-test', '127.0.0.1');

-- 6. Derived measure. Expect savingsPerClaim = grossSavings / claimsDenied on each row.
CALL PI.BI_ENGINE.EXECUTE_QUERY(
  PARSE_JSON('{"customerId":1,"lineOfBusinessId":1,"measures":["savingsPerClaim"],"aggregates":[{"attributeKey":"programType"}],"months":12}'),
  'smoke-test', '127.0.0.1');

-- 7. Cache: run statement 4 again. Expect "cache": {"hit": true}.
SELECT QUERY_HASH, MEASURE, USECOUNT, LASTUSE FROM PI.BI_ENGINE.EXECUTE_QUERY_CACHE ORDER BY CREATED_AT DESC LIMIT 5;

-- 8. Validation errors come back as data, not exceptions. Expect STATUS = ERROR, CODE = INVALID_REQUEST, FIELD = measures[0].
CALL PI.BI_ENGINE.EXECUTE_QUERY(PARSE_JSON('{"customerId":1,"lineOfBusinessId":1,"measures":["doesNotExist"]}'), 'smoke-test', '127.0.0.1');

-- 9. The Function API must send lineOfBusinessId (it comes from the App DB). Expect INVALID_REQUEST, field = lineOfBusinessId.
CALL PI.BI_ENGINE.EXECUTE_QUERY(PARSE_JSON('{"customerId":1,"measures":["claimsDenied"]}'), 'smoke-test', '127.0.0.1');

-- 10. Log. Expect one row per call above.
SELECT EVENT_TS, USER_ID, MEASURE, CACHE_HIT, STATUS, MESSAGE, RUNTIME_MS
FROM PI.BI_ENGINE.EXECUTE_QUERY_LOG ORDER BY EVENT_TS DESC LIMIT 20;

-- 11. Only meaningful when the PI_BI_API role exists (05_grants.sql was run): CALL works, direct table access does not.
--     Skip this when running everything as SYSADMIN, because SYSADMIN can read the table directly.
-- USE ROLE PI_BI_API;
-- CALL PI.BI_ENGINE.EXECUTE_QUERY(PARSE_JSON('{"customerId":1,"lineOfBusinessId":1,"measures":["claimsDenied"],"months":1}'), 'smoke-test', '127.0.0.1');
-- SELECT * FROM PI.CORE.FACT_SAVINGS LIMIT 1;   -- expect an access error for PI_BI_API
