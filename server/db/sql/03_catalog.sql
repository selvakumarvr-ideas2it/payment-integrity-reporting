-- Report catalog for the Savings Invoice report. Adding a measure or filter is a row here, not code.

INSERT INTO pi.report (report_id, title, fact_table, month_column)
VALUES ('savings-invoice', 'Savings Invoice', 'fact_savings', 'month');

INSERT INTO pi.kpi_measure (report_id, measure_key, label, format, agg_sql, sort_order) VALUES
  ('savings-invoice', 'claimsDenied', 'Total # Claims Denied', 'number',   'sum(claims_denied)', 1),
  ('savings-invoice', 'grossSavings', 'Total Gross Savings',   'currency', 'sum(gross_savings)', 2),
  ('savings-invoice', 'amount',       'Amount',                'currency', 'sum(amount)',        3);

INSERT INTO pi.query_attribute (report_id, attribute_key, column_name, label, is_filter, is_aggregate) VALUES
  ('savings-invoice', 'month',       'month',        'Month of Transaction', false, true),
  ('savings-invoice', 'market',      'market',       'Market',               true,  true),
  ('savings-invoice', 'programType', 'program_type', 'Program Type',         true,  true);
