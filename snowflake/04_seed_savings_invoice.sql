-- 04_seed_savings_invoice.sql : metadata for the Savings Invoice report, so EXECUTE_QUERY works end to end.
-- Run as SYSADMIN (or PI_BI_OWNER if you created the roles) after 03_execute_query.sql. Safe to re-run (deletes then re-inserts its own ids).
--
-- In production these rows already exist (loaded from the existing META tables) and this script is not needed.
-- It shows the convention the engine expects, and it is the template for adding a measure or a filter:
--
--   a new measure    = one row in MEASURE_DETAILS (plus rows in MEASURE_FILTER_DETAILS if it only counts some rows)
--   a new attribute  = one row in ATTRIBUTE_DETAILS + one row per fact table in RELATIONSHIP_METADATA_DETAILS
--   no procedure change is ever needed
--
-- How the engine reads the columns (inferred from the column names and the V2 procedure; confirm against production rows):
--   MEASURE_DETAILS            MEASUREFACT = table in PI.CORE; SQLCALCSTATEMENT = aggregate over alias F (the fact);
--                              BASENUMERATOR / BASEDENOMINATOR / OPERATOR / RESULTMULTIPLIER = derived measure;
--                              LINEOFBUSINESS_ID NULL = available to every line of business
--   ATTRIBUTE_DETAILS          ATTRIBUTEKEY = name used in the payload; FILTERSQL = fallback SQL expression
--   RELATIONSHIP_METADATA_...  one row per (attribute, fact): SQLCOLUMN = column or expression, SQLJOINSTATEMENT = optional
--                              JOIN text when the column is in a dimension, ISYEARMONTH = 'Y' marks the 'YYYY-MM' attribute

USE DATABASE PI;
USE SCHEMA BI_ENGINE;

-- The line of business is not stored in Snowflake: LINEOFBUSINESS, CUSTOMER and DATASET live in the App DB (Postgres).
-- The Function API sends lineOfBusinessId in every payload. This POC uses line of business 1 and customer 1 (Centene),
-- so every metadata row below has LINEOFBUSINESS_ID = 1 and the fact rows have CUSTOMER_ID = 1.

-- Measures (ids 1-4). Names are the keys the React app already sends.
DELETE FROM BI_ENGINE.MEASURE_DETAILS WHERE MEASUREID IN (1, 2, 3, 4);
INSERT INTO BI_ENGINE.MEASURE_DETAILS
  (MEASUREID, MEASURE, MEASUREDESCRIPTION, MEASUREFACT, SQLCALCSTATEMENT, FORMATSTRING,
   BASENUMERATOR, BASEDENOMINATOR, RESULTMULTIPLIER, OPERATOR, USESABSOLUTE,
   CREATEDUSERID, CREATEDDATETIME, MODIFIEDUSERID, MODIFIEDDATETIME, LINEOFBUSINESS_ID)
SELECT column1, column2, column3, column4, column5, column6, column7, column8, column9, column10, 0,
       1, CURRENT_TIMESTAMP(), 1, CURRENT_TIMESTAMP(), 1
FROM VALUES
  (1, 'claimsDenied', 'Total # Claims Denied', 'FACT_SAVINGS', 'SUM(F.CLAIMS_DENIED)', '#,##0',       NULL, NULL, NULL, NULL),
  (2, 'grossSavings', 'Total Gross Savings',   'FACT_SAVINGS', 'SUM(F.GROSS_SAVINGS)', '$#,##0.00',   NULL, NULL, NULL, NULL),
  (3, 'amount',       'Amount',                'FACT_SAVINGS', 'SUM(F.AMOUNT)',        '$#,##0.00',   NULL, NULL, NULL, NULL),
  -- derived measure: grossSavings / claimsDenied (shows BASENUMERATOR / OPERATOR / BASEDENOMINATOR; no SQLCALCSTATEMENT)
  (4, 'savingsPerClaim', 'Gross Savings per Denied Claim', NULL, NULL, '$#,##0.00', 2, 1, NULL, '/');

-- Attributes (ids 1-3)
DELETE FROM BI_ENGINE.ATTRIBUTE_DETAILS WHERE ATTRIBUTEID IN (1, 2, 3);
INSERT INTO BI_ENGINE.ATTRIBUTE_DETAILS
  (ATTRIBUTEID, ATTRIBUTEKEY, ATTRIBUTEDESCRIPTION, FILTERSQL, CREATEDUSERID, CREATEDDATETIME, MODIFIEDUSERID, MODIFIEDDATETIME, LINEOFBUSINESS_ID)
SELECT column1, column2, column3, column4, 1, CURRENT_TIMESTAMP(), 1, CURRENT_TIMESTAMP(), 1
FROM VALUES
  (1, 'month',       'Month of Transaction', 'F.MONTH'),
  (2, 'market',      'Market',               'F.MARKET'),
  (3, 'programType', 'Program Type',         'F.PROGRAM_TYPE');

-- Relationships: where each attribute lives for each fact table (all three are plain columns of FACT_SAVINGS, so no join)
DELETE FROM BI_ENGINE.RELATIONSHIP_METADATA_DETAILS WHERE RELATIONSHIPMETADATAID IN (1, 2, 3);
INSERT INTO BI_ENGINE.RELATIONSHIP_METADATA_DETAILS
  (RELATIONSHIPMETADATAID, ATTRIBUTEKEY, DESTINATIONENTITY, FACTTABLE, SQLCOLUMN, SQLJOINSTATEMENT, SQLPKTABLE,
   CROSSFACTFILTER, CROSSFACTGROUP, CREATEDUSERID, CREATEDDATETIME, MODIFIEDUSERID, MODIFIEDDATETIME, ATTRIBUTEID, ISYEARMONTH)
SELECT column1, column2, 'FACT_SAVINGS', 'FACT_SAVINGS', column3, NULL, NULL,
       0, 0, 1, TO_VARCHAR(CURRENT_TIMESTAMP()), 1, TO_VARCHAR(CURRENT_TIMESTAMP()), column4, column5
FROM VALUES
  (1, 'month',       'MONTH',        1, 'Y'),
  (2, 'market',      'MARKET',       2, 'N'),
  (3, 'programType', 'PROGRAM_TYPE', 3, 'N');

-- Example of a measure that only counts some rows (not seeded; shows MEASURE_FILTER_DETAILS):
-- INSERT INTO BI_ENGINE.MEASURE_FILTER_DETAILS (MEASUREFILTERID, MEASUREID, FILTERTYPE, ATTRIBUTEID, ATTRIBUTEKEY, FILTERSTATEMENT, CREATEDUSERID, CREATEDDATETIME, MODIFIEDUSERID, MODIFIEDDATETIME)
-- VALUES (1, 1, 'INCLUDE', 3, 'programType', 'IN (''CPI'')', 1, CURRENT_TIMESTAMP(), 1, CURRENT_TIMESTAMP());

-- Whenever metadata changes, drop the cached SQL so the next request rebuilds it:
TRUNCATE TABLE BI_ENGINE.EXECUTE_QUERY_CACHE;
