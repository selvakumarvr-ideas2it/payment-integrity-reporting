-- 00_setup.sql : database, schemas and warehouse for the Snowflake BI Engine.
-- Run as SYSADMIN. No custom roles, no grants and no users are created: SYSADMIN owns everything it creates,
-- so scripts 01-04 and 06 also run as SYSADMIN, and 05_grants.sql is skipped.
--
--   PI                 database
--   PI.CORE            Gold optimized layer (built by dbt; the BI Engine only reads it)
--   PI.BI_ENGINE       BI Engine: metadata, caches, logs, reference mirrors, EXECUTE_QUERY procedure
--
-- Security note: the Function API will connect as SYSADMIN (or another role you already have), so it is NOT
-- limited to CALL EXECUTE_QUERY. Fine for dev / POC. For production, have an admin create PI_BI_OWNER,
-- PI_BI_API and PI_BI_ADMIN (CREATE ROLE) and run 05_grants.sql.

USE ROLE SYSADMIN;

CREATE DATABASE IF NOT EXISTS PI;
CREATE SCHEMA IF NOT EXISTS PI.CORE        COMMENT = 'Gold optimized layer (dbt). Read-only for the BI Engine.';
CREATE SCHEMA IF NOT EXISTS PI.BI_ENGINE   COMMENT = 'BI Engine: JSON payload -> SQL over PI.CORE.';

CREATE WAREHOUSE IF NOT EXISTS PI_BI_WH
  WAREHOUSE_SIZE = 'XSMALL'
  AUTO_SUSPEND = 60
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE
  COMMENT = 'Warehouse used by the Function API for BI Engine queries';
