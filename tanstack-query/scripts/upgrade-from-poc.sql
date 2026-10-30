-- Manual script. Destructive to the procedure only.
-- Drops schema bi_engine (including bi_engine.execute_query) and the catalog
-- tables pi.report, pi.kpi_measure, and pi.query_attribute.
-- Leaves pi.customer, pi.users, pi.user_session, pi.fact_savings, pi.dataset,
-- and pi.dataset_filter untouched.
-- Read this file before you run it. npm run db:migrate does not apply it.

DROP SCHEMA IF EXISTS bi_engine CASCADE;

DROP TABLE IF EXISTS pi.kpi_measure CASCADE;
DROP TABLE IF EXISTS pi.query_attribute CASCADE;
DROP TABLE IF EXISTS pi.report CASCADE;
