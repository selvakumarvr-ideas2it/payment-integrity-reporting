-- 02_engine_tables.sql : the 9 tables the BI Engine needs, in PI.BI_ENGINE.
-- Run as SYSADMIN (or PI_BI_OWNER if you created the roles).
--
-- Source: the schema screenshots in schemas.zip. The old Snowflake layout used the schemas META and DBO in
-- AVRC_PRD_AVRC_DB; here the engine's tables and procedures are all in PI.BI_ENGINE:
--
--   old META.*   -> PI.BI_ENGINE.*   engine metadata, caches, logs (this file)
--   old DBO.*    -> PI.BI_ENGINE.*   procedures
--
-- NOT in Snowflake: LINEOFBUSINESS, CUSTOMER, DATASET and DATASETSTRUCTURE. They belong to the App DB (Postgres).
-- The Function API reads them there and passes what the engine needs (customerId, lineOfBusinessId, datasetId)
-- in the payload. See docs/BI_ENGINE_SNOWFLAKE.md sections 3 and 7.
--
-- Column names, types and nullability are exactly as in the screenshots, with one deliberate difference:
--   * EVENT_TS (both log tables) and CREATED_AT (both cache tables) get DEFAULT CURRENT_TIMESTAMP().
--     The V2 procedure inserts into EXECUTE_QUERY_ERROR_LOG without EVENT_TS, which would otherwise stay NULL.
-- Everything else that looks odd (VARCHAR date columns, the CUSTOMATRJOININD spelling, QUERY_HASH VARCHAR in the log)
-- is kept as shown. docs/BI_ENGINE_SNOWFLAKE.md section 3 lists each one.

USE DATABASE PI;
USE SCHEMA BI_ENGINE;

-- =============================================================================================
-- A. Engine metadata: how a measure / attribute turns into SQL
-- =============================================================================================

-- A1. MEASURE_DETAILS (from MEASURE_DETAILS.png, 22 columns)
CREATE TABLE IF NOT EXISTS BI_ENGINE.MEASURE_DETAILS (
  MEASUREID             NUMBER(38,0),
  MEASURE               VARCHAR,
  MEASUREDESCRIPTION    VARCHAR,
  MEASUREFACT           VARCHAR,
  SQLCALCSTATEMENT      VARCHAR,
  FORMATSTRING          VARCHAR,
  USESNORM              NUMBER(38,0),
  ISANNUALIZED          NUMBER(38,0),
  BASENUMERATOR         NUMBER(38,0),
  BASEDENOMINATOR       NUMBER(38,0),
  RESULTMULTIPLIER      VARCHAR,
  OPERATOR              VARCHAR,
  USESABSOLUTE          NUMBER(38,0),
  TERMINATEDDATETIME    TIMESTAMP_NTZ,
  CREATEDUSERID         NUMBER(38,0),
  CREATEDDATETIME       TIMESTAMP_NTZ,
  MODIFIEDUSERID        NUMBER(38,0),
  MODIFIEDDATETIME      TIMESTAMP_NTZ,
  LINEOFBUSINESS_ID     NUMBER(38,0),
  FORDETAILS            BOOLEAN,
  CC                    NUMBER(38,0),
  CANONICAL_MEASURE_ID  NUMBER(38,0)
);

-- A2. MEASURE_FILTER_DETAILS (from MEASURE_DETAILS.png, 11 columns)
CREATE TABLE IF NOT EXISTS BI_ENGINE.MEASURE_FILTER_DETAILS (
  MEASUREFILTERID     NUMBER(38,0),
  MEASUREID           NUMBER(38,0),
  FILTERTYPE          VARCHAR,
  ATTRIBUTEID         NUMBER(38,0),
  ATTRIBUTEKEY        VARCHAR,
  FILTERSTATEMENT     VARCHAR,
  TERMINATEDDATETIME  TIMESTAMP_NTZ,
  CREATEDUSERID       NUMBER(38,0),
  CREATEDDATETIME     TIMESTAMP_NTZ,
  MODIFIEDUSERID      NUMBER(38,0),
  MODIFIEDDATETIME    TIMESTAMP_NTZ
);

-- A3. ATTRIBUTE_DETAILS (from ATTRIBUTE_DETAILS.png, 14 columns)
CREATE TABLE IF NOT EXISTS BI_ENGINE.ATTRIBUTE_DETAILS (
  ATTRIBUTEID             NUMBER(38,0),
  ATTRIBUTEKEY            VARCHAR,
  ATTRIBUTEDESCRIPTION    VARCHAR,
  FILTERSQL               VARCHAR,
  TERMINATEDDATETIME      TIMESTAMP_NTZ,
  CREATEDUSERID           NUMBER(38,0),
  CREATEDDATETIME         TIMESTAMP_NTZ,
  MODIFIEDUSERID          NUMBER(38,0),
  MODIFIEDDATETIME        TIMESTAMP_NTZ,
  LINEOFBUSINESS_ID       NUMBER(38,0),
  ISCATASTROPHIC          BOOLEAN,
  CC                      NUMBER(38,0),
  CANONICAL_ATTRIBUTE_ID  NUMBER(38,0),
  SUPPORTNORM             NUMBER(38,0)
);

-- A4. RELATIONSHIP_METADATA_DETAILS (from ATTRIBUTE_DETAILS.png, 17 columns)
--     Kept as shown: CREATEDDATETIME / MODIFIEDDATETIME are VARCHAR here (TIMESTAMP_NTZ everywhere else),
--     and CUSTOMATRJOININD is spelled that way in the source.
CREATE TABLE IF NOT EXISTS BI_ENGINE.RELATIONSHIP_METADATA_DETAILS (
  RELATIONSHIPMETADATAID  NUMBER(38,0),
  ATTRIBUTEKEY            VARCHAR,
  DESTINATIONENTITY       VARCHAR,
  FACTTABLE               VARCHAR,
  SQLCOLUMN               VARCHAR,
  SQLJOINSTATEMENT        VARCHAR,
  SQLPKTABLE              VARCHAR,
  CROSSFACTFILTER         NUMBER(38,0),
  CROSSFACTGROUP          NUMBER(38,0),
  CREATEDUSERID           NUMBER(38,0),
  CREATEDDATETIME         VARCHAR,
  MODIFIEDUSERID          NUMBER(38,0),
  MODIFIEDDATETIME        VARCHAR,
  ATTRIBUTEID             NUMBER(38,0),
  ISYEARMONTH             VARCHAR,
  CUSTOMATRJOININD        VARCHAR
);

-- A5. CROSSFACT_JOIN_KEY_POLICY (from EXECUTE_QUERY_CACHE.png / Screenshot 093303, identical in both)
CREATE TABLE IF NOT EXISTS BI_ENGINE.CROSSFACT_JOIN_KEY_POLICY (
  JOIN_KEY_ID        NUMBER(38,0) NOT NULL,
  MAIN_FACT          VARCHAR NOT NULL,
  CROSS_FACT         VARCHAR NOT NULL,
  JOIN_HASH_COLUMN   VARCHAR NOT NULL,
  IS_ACTIVE          BOOLEAN,
  LINEOFBUSINESS_ID  NUMBER(38,0),
  CREATED_AT         TIMESTAMP_NTZ,
  UPDATED_AT         TIMESTAMP_NTZ
);

-- =============================================================================================
-- B. Caches and logs
-- =============================================================================================

-- B1. EXECUTE_QUERY_CACHE (from EXECUTE_QUERY_CACHE.png). Used by BI_ENGINE.EXECUTE_QUERY.
--     GENERATED_SQL = the SQL built for that payload hash. ANSWER = plan metadata (column list, applied
--     filters). It does not hold result rows, so cached entries never go stale because of data loads.
CREATE TABLE IF NOT EXISTS BI_ENGINE.EXECUTE_QUERY_CACHE (
  QUERY_HASH     NUMBER(38,0) NOT NULL,
  QUERY_TEXT     VARCHAR,
  MEASURE        VARCHAR,
  DATASET_ID     NUMBER(38,0),
  GENERATED_SQL  VARCHAR,
  ANSWER         VARIANT,
  USECOUNT       NUMBER(38,0),
  LASTUSE        TIMESTAMP_NTZ,
  RUNTIME_MS     NUMBER(38,0),
  LASTUIUSER     VARCHAR,
  CREATED_AT     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- B2. CUSTOM_QUERY_CACHE (from CUSTOMER_QUERY_CACHE.png / Screenshot 093303, identical in both).
--     Per-measure cache used by the production V2 procedure (BIEXECUTEQUERY_PARALLEL_V2).
CREATE TABLE IF NOT EXISTS BI_ENGINE.CUSTOM_QUERY_CACHE (
  QUERY_HASH     NUMBER(38,0) NOT NULL,
  QUERY_TEXT     VARCHAR,
  MEASURE        VARCHAR,
  MEASURE_DESC   VARCHAR,
  DATASET_ID     NUMBER(38,0),
  GENERATED_SQL  VARCHAR NOT NULL,
  AGG_COLUMNS    VARIANT,
  FORMATSTRING   VARCHAR,
  USECOUNT       NUMBER(38,0),
  LASTUSE        TIMESTAMP_NTZ,
  RUNTIME_MS     NUMBER(38,0),
  LASTUIUSER     VARCHAR,
  CREATED_AT     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- B3. EXECUTE_QUERY_LOG (from QUERY_LOG.png / BI_Engine_query screenshots). One row per call.
CREATE TABLE IF NOT EXISTS BI_ENGINE.EXECUTE_QUERY_LOG (
  EVENT_TS    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  PROC_NAME   VARCHAR,
  USER_ID     VARCHAR,
  CLIENT_IP   VARCHAR,
  DATASET_ID  NUMBER(38,0),
  MEASURE     VARCHAR,
  QUERY_HASH  VARCHAR,     -- VARCHAR here, NUMBER(38,0) in the caches (as in the source)
  DEBUG_FLAG  BOOLEAN,
  CACHE_HIT   BOOLEAN,
  STATUS      VARCHAR,
  MESSAGE     VARCHAR,
  RUNTIME_MS  NUMBER(38,0)
);

-- B4. EXECUTE_QUERY_ERROR_LOG. One row per failed call, with the payload and the SQL that failed.
CREATE TABLE IF NOT EXISTS BI_ENGINE.EXECUTE_QUERY_ERROR_LOG (
  EVENT_TS       TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  PROC_NAME      VARCHAR,
  USER_ID        VARCHAR,
  CLIENT_IP      VARCHAR,
  XML_QUERY      VARCHAR,     -- the request payload (the name is historical; it is JSON now)
  ERROR_MESSAGE  VARCHAR,
  STACK_TRACE    VARCHAR,
  ERROR_SQL      VARCHAR,
  DATASET_ID     NUMBER(38,0),
  UPDT_DTTM      TIMESTAMP_NTZ
);

