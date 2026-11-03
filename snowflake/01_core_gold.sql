-- 01_core_gold.sql : PI.CORE (Gold optimized layer).
--
-- In production the Gold tables are built by dbt (Bronze -> Silver -> Gold) and this script is NOT run.
-- It only creates the development fact table that the Savings Invoice POC uses, so the engine can be
-- tested end to end. Rules every Gold fact table must follow so the engine can query it:
--
--   1. It lives in PI.CORE.
--   2. It has a CUSTOMER_ID column. The engine adds "F.CUSTOMER_ID = <id>" to every query; the id
--      comes from the Function API (the signed-in user), never from the browser.
--   3. Every attribute (filter / group-by) it supports has a row in BI_ENGINE.RELATIONSHIP_METADATA_DETAILS.
--   4. Every measure on it has a row in BI_ENGINE.MEASURE_DETAILS (MEASUREFACT = table name).
--
-- Run as PI_BI_OWNER or SYSADMIN (needs CREATE TABLE on PI.CORE).

USE DATABASE PI;
USE SCHEMA CORE;

CREATE TABLE IF NOT EXISTS CORE.FACT_SAVINGS (
  CUSTOMER_ID   NUMBER(38,0)  NOT NULL,
  MONTH         VARCHAR(7)    NOT NULL,   -- 'YYYY-MM' (the engine's "latest N months" window relies on this format)
  MARKET        VARCHAR(10)   NOT NULL,
  PROGRAM_TYPE  VARCHAR(20)   NOT NULL,
  CLAIMS_DENIED NUMBER(38,0)  NOT NULL,
  GROSS_SAVINGS NUMBER(14,2)  NOT NULL,
  AMOUNT        NUMBER(14,2)  NOT NULL
)
CLUSTER BY (CUSTOMER_ID, MONTH)
COMMENT = 'POC Gold fact: monthly prepay savings by customer, market and program type';

-- Load the synthetic data (public/data/savings-invoice.csv: customer_id is the first column, 1 = Centene).
-- 1) Upload the CSV to a stage (Snowsight: Data > Add Data, or SnowSQL PUT), e.g. @PI.CORE.POC_STAGE
-- 2) Then:
--
-- CREATE STAGE IF NOT EXISTS CORE.POC_STAGE;
-- PUT file://public/data/savings-invoice.csv @CORE.POC_STAGE AUTO_COMPRESS = TRUE;   -- SnowSQL only
--
-- COPY INTO CORE.FACT_SAVINGS (CUSTOMER_ID, MONTH, MARKET, PROGRAM_TYPE, CLAIMS_DENIED, GROSS_SAVINGS, AMOUNT)
-- FROM (
--   SELECT $1::NUMBER, $2, $3, $4, $5::NUMBER, $6::NUMBER(14,2), $7::NUMBER(14,2)      -- $1 = customer_id (1 = Centene, see 04_seed_savings_invoice.sql)
--   FROM @CORE.POC_STAGE/savings-invoice.csv.gz
-- )
-- FILE_FORMAT = (TYPE = CSV SKIP_HEADER = 1 FIELD_OPTIONALLY_ENCLOSED_BY = '"');
