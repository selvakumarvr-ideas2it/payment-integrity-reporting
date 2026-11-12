-- Local POC schema (Postgres 16). Table and column names follow the Snowflake model.
-- Applied by scripts/db-setup.mjs, which drops and recreates the pi and bi_engine schemas.

CREATE SCHEMA pi;

CREATE TABLE pi.customer (
  customer_id   integer PRIMARY KEY,
  name          text NOT NULL UNIQUE
);

CREATE TABLE pi.users (
  user_id       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      text NOT NULL,
  display_name  text NOT NULL,
  password_hash text NOT NULL,              -- scrypt: <salt hex>:<hash hex>
  customer_id   integer NOT NULL REFERENCES pi.customer,
  is_active     boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX ux_users_username ON pi.users (lower(username));

CREATE TABLE pi.user_session (
  token_hash          text PRIMARY KEY,     -- sha256 of the bearer token; the token itself is never stored
  user_id             integer NOT NULL REFERENCES pi.users ON DELETE CASCADE,
  created_date_time   timestamptz NOT NULL DEFAULT now(),
  expires_date_time   timestamptz NOT NULL
);

-- Report catalog: the only tables, columns and aggregate expressions the BI engine may put in SQL.
CREATE TABLE pi.report (
  report_id     text PRIMARY KEY,
  title         text NOT NULL,
  fact_table    text NOT NULL,              -- table name inside schema pi
  month_column  text NOT NULL
);

CREATE TABLE pi.kpi_measure (
  report_id     text NOT NULL REFERENCES pi.report,
  measure_key   text NOT NULL,
  label         text NOT NULL,
  format        text NOT NULL CHECK (format IN ('number', 'currency')),
  agg_sql       text NOT NULL,              -- written by developers only, e.g. sum(claims_denied)
  sort_order    integer NOT NULL,
  PRIMARY KEY (report_id, measure_key)
);

CREATE TABLE pi.query_attribute (
  report_id     text NOT NULL REFERENCES pi.report,
  attribute_key text NOT NULL,
  column_name   text NOT NULL,
  label         text NOT NULL,
  is_filter     boolean NOT NULL DEFAULT false,
  is_aggregate  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (report_id, attribute_key)
);

CREATE TABLE pi.fact_savings (
  customer_id   integer NOT NULL REFERENCES pi.customer,
  month         char(7) NOT NULL,           -- YYYY-MM
  market        text NOT NULL,
  program_type  text NOT NULL,
  claims_denied integer NOT NULL,
  gross_savings numeric(14, 2) NOT NULL,
  amount        numeric(14, 2) NOT NULL
);
CREATE INDEX ix_fact_savings_month ON pi.fact_savings (customer_id, month);
CREATE INDEX ix_fact_savings_filters ON pi.fact_savings (customer_id, market, program_type);

-- DATASET: a reporting configuration whose primary definition is time periods
-- (current / prior / prior-prior service, payment and enrollment dates), matching
-- APP.DATASET in Health Plan Manager. Filter values still live in pi.dataset_filter.
-- readpolicy_id: 1 = private (owner only), 2 = public (every user of the customer).
-- dataset_status_id: 1 = active.
CREATE TABLE pi.dataset (
  dataset_id                        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id                       integer NOT NULL REFERENCES pi.customer,
  lineofbusiness_id                 integer NOT NULL DEFAULT 1,
  name                              text NOT NULL,
  description                       text,
  dataset_status_id                 integer NOT NULL DEFAULT 1,
  copied_from_dataset_id            integer REFERENCES pi.dataset ON DELETE SET NULL,
  is_norm                           boolean NOT NULL DEFAULT false,
  is_default_template               boolean NOT NULL DEFAULT false,
  current_period_months             integer,
  prior_period_months               integer,
  prior_prior_period_months         integer,
  current_service_start_date        date NOT NULL,
  current_service_end_date          date NOT NULL,
  prior_service_start_date          date,
  prior_service_end_date            date,
  prior_prior_service_start_date    date,
  prior_prior_service_end_date      date,
  current_payment_start_date        date,
  current_payment_end_date          date,
  prior_payment_start_date          date,
  prior_payment_end_date            date,
  prior_prior_payment_start_date    date,
  prior_prior_payment_end_date      date,
  current_enrollment_start_date     date,
  current_enrollment_end_date       date,
  prior_enrollment_start_date       date,
  prior_enrollment_end_date         date,
  prior_prior_enrollment_start_date date,
  prior_prior_enrollment_end_date   date,
  continuously_enrolled_start_date  date,
  continuously_enrolled_end_date    date,
  use_paid_only                     boolean NOT NULL DEFAULT false,
  include_continuously_enrolled     boolean NOT NULL DEFAULT true,
  owner_user_id                     integer NOT NULL REFERENCES pi.users,
  readpolicy_id                     integer NOT NULL DEFAULT 1,
  created_user_id                   integer NOT NULL REFERENCES pi.users,
  last_modified_user_id             integer NOT NULL REFERENCES pi.users,
  created_date_time                 timestamptz NOT NULL DEFAULT now(),
  last_modified_date_time           timestamptz NOT NULL DEFAULT now(),
  last_accessed_date_time           timestamptz,
  CHECK (current_service_start_date <= current_service_end_date)
);
CREATE UNIQUE INDEX ux_dataset_owner_name ON pi.dataset (customer_id, owner_user_id, lower(name)) WHERE dataset_status_id = 1;

-- One row per selected value; several rows for one attribute make a multi-select filter.
CREATE TABLE pi.dataset_filter (
  dataset_id    integer NOT NULL REFERENCES pi.dataset ON DELETE CASCADE,
  attribute_key text NOT NULL,
  value         text NOT NULL,
  PRIMARY KEY (dataset_id, attribute_key, value)
);
