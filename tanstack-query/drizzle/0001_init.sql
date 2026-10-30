-- Initial schema for Payment Integrity Reporting.
-- Creates schema pi and these tables only:
--   customer, users, user_session, fact_savings, dataset, dataset_filter.
-- Does not create schema bi_engine, pi.report, pi.kpi_measure, or pi.query_attribute.
-- npm run db:migrate applies this file. It does not drop schema pi.

CREATE SCHEMA pi;

CREATE TABLE pi.customer (
  customer_id integer PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE pi.users (
  user_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  customer_id integer NOT NULL REFERENCES pi.customer (customer_id),
  is_active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX ux_users_username ON pi.users (lower(username));

CREATE TABLE pi.user_session (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES pi.users (user_id) ON DELETE CASCADE,
  created_date_time timestamptz NOT NULL DEFAULT now(),
  expires_date_time timestamptz NOT NULL
);

CREATE TABLE pi.fact_savings (
  customer_id integer NOT NULL REFERENCES pi.customer (customer_id),
  month char(7) NOT NULL,
  market text NOT NULL,
  program_type text NOT NULL,
  claims_denied integer NOT NULL,
  gross_savings numeric(14, 2) NOT NULL,
  amount numeric(14, 2) NOT NULL
);
CREATE INDEX ix_fact_savings_month ON pi.fact_savings (customer_id, month);
CREATE INDEX ix_fact_savings_filters ON pi.fact_savings (customer_id, market, program_type);

CREATE TABLE pi.dataset (
  dataset_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES pi.customer (customer_id),
  name text NOT NULL,
  description text,
  dataset_status_id integer NOT NULL DEFAULT 1,
  copied_from_dataset_id integer REFERENCES pi.dataset (dataset_id) ON DELETE SET NULL,
  owner_user_id integer NOT NULL REFERENCES pi.users (user_id),
  readpolicy_id integer NOT NULL DEFAULT 1,
  created_user_id integer NOT NULL REFERENCES pi.users (user_id),
  last_modified_user_id integer NOT NULL REFERENCES pi.users (user_id),
  created_date_time timestamptz NOT NULL DEFAULT now(),
  last_modified_date_time timestamptz NOT NULL DEFAULT now(),
  last_accessed_date_time timestamptz
);
CREATE UNIQUE INDEX ux_dataset_owner_name
  ON pi.dataset (customer_id, owner_user_id, lower(name))
  WHERE dataset_status_id = 1;

CREATE TABLE pi.dataset_filter (
  dataset_id integer NOT NULL REFERENCES pi.dataset (dataset_id) ON DELETE CASCADE,
  attribute_key text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (dataset_id, attribute_key, value)
);
