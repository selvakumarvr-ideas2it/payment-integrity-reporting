-- BI engine stored procedure: JSON request -> validated dynamic SQL -> JSON result.
--
--   SELECT bi_engine.execute_query(<user_id>, '{
--     "reportId": "savings-invoice",
--     "datasetId": 1,                                         -- optional: saved filter set
--     "measures": ["claimsDenied", "grossSavings", "amount"], -- optional: default all
--     "aggregates": [{"attributeKey": "month", "grain": "month"}],
--     "filters": [{"attributeKey": "market", "values": ["AZ", "TX"]}],
--     "months": 24,
--     "debug": false                                          -- true adds the generated SQL
--   }');
--
-- Safety: table/column names come only from pi.report / pi.query_attribute (quoted with %I),
-- aggregate expressions only from pi.kpi_measure, and every request value is bound as a
-- parameter ($1 customer, $2 filter values as jsonb, $3 first month). The customer always
-- comes from the user, never from the request.
--
-- Errors: SQLSTATE 22023 = invalid request (DETAIL holds the field), P0002 = not found,
-- 42501 = user not allowed.

CREATE SCHEMA bi_engine;

CREATE FUNCTION bi_engine.fail(p_code text, p_message text, p_field text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = p_code, MESSAGE = p_message, DETAIL = coalesce(p_field, '');
END $$;

CREATE FUNCTION bi_engine.execute_query(p_user_id integer, p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  c_max_months    constant integer := 60;
  c_max_values    constant integer := 200;
  v_customer_id   integer;
  v_customer      text;
  v_report        pi.report%ROWTYPE;
  v_months        integer := 24;
  v_measures      jsonb := '[]';          -- [{key,label,format,agg}]
  v_measure_sql   text;
  v_group_select  text;
  v_group_cols    text;
  v_group_order   text;
  v_filter_values jsonb := '[]';          -- $2: one array of values per WHERE clause
  v_clauses       text := '';
  v_applied       jsonb := '[]';
  v_dataset       jsonb := 'null';
  v_dataset_id    integer;
  v_latest        text;
  v_from          text;
  v_where         text;
  v_rows_sql      text;
  v_kpi_sql       text;
  v_rows          jsonb;
  v_totals        jsonb;
  v_options       jsonb := '{}';
  v_opts          jsonb;
  v_elem          jsonb;
  v_key           text;
  v_values        jsonb;
  v_idx           integer := 0;
  r               record;
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object' THEN
    PERFORM bi_engine.fail('22023', 'Request body must be a JSON object');
  END IF;

  SELECT u.customer_id, c.name INTO v_customer_id, v_customer
    FROM pi.users u JOIN pi.customer c USING (customer_id)
   WHERE u.user_id = p_user_id AND u.is_active;
  IF NOT FOUND THEN PERFORM bi_engine.fail('42501', 'Unknown or inactive user'); END IF;

  SELECT * INTO v_report FROM pi.report WHERE report_id = coalesce(p_request->>'reportId', 'savings-invoice');
  IF NOT FOUND THEN PERFORM bi_engine.fail('P0002', format('Unknown report ''%s''', p_request->>'reportId'), 'reportId'); END IF;

  -- months
  IF p_request ? 'months' AND p_request->'months' <> 'null' THEN
    IF jsonb_typeof(p_request->'months') = 'number' AND (p_request->>'months') ~ '^\d{1,4}$' THEN
      v_months := (p_request->>'months')::integer;
    ELSE
      v_months := 0;
    END IF;
    IF v_months NOT BETWEEN 1 AND c_max_months THEN
      PERFORM bi_engine.fail('22023', format('months must be a whole number from 1 to %s', c_max_months), 'months');
    END IF;
  END IF;

  -- measures (default: all, in catalog order)
  IF jsonb_typeof(p_request->'measures') = 'array' AND jsonb_array_length(p_request->'measures') > 0 THEN
    FOR v_elem, v_idx IN SELECT e, o::integer - 1 FROM jsonb_array_elements(p_request->'measures') WITH ORDINALITY AS a(e, o) LOOP
      SELECT * INTO r FROM pi.kpi_measure WHERE report_id = v_report.report_id AND measure_key = v_elem #>> '{}';
      IF NOT FOUND THEN PERFORM bi_engine.fail('22023', format('Unknown measure ''%s''', v_elem #>> '{}'), format('measures[%s]', v_idx)); END IF;
      v_measures := v_measures || jsonb_build_object('key', r.measure_key, 'label', r.label, 'format', r.format, 'agg', r.agg_sql);
    END LOOP;
  ELSIF p_request ? 'measures' AND p_request->'measures' <> 'null' AND jsonb_typeof(p_request->'measures') <> 'array' THEN
    PERFORM bi_engine.fail('22023', 'measures must be an array', 'measures');
  ELSE
    SELECT jsonb_agg(jsonb_build_object('key', measure_key, 'label', label, 'format', format, 'agg', agg_sql) ORDER BY sort_order)
      INTO v_measures FROM pi.kpi_measure WHERE report_id = v_report.report_id;
  END IF;
  SELECT string_agg(format('round(%s, 2) AS %I', m->>'agg', m->>'key'), ', ') INTO v_measure_sql FROM jsonb_array_elements(v_measures) m;

  -- aggregates (default: month)
  v_group_select := ''; v_group_cols := ''; v_group_order := '';
  FOR v_elem, v_idx IN
    SELECT e, o::integer - 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_request->'aggregates') = 'array' AND jsonb_array_length(p_request->'aggregates') > 0
           THEN p_request->'aggregates' ELSE '[{"attributeKey": "month"}]' END) WITH ORDINALITY AS a(e, o)
  LOOP
    SELECT * INTO r FROM pi.query_attribute
     WHERE report_id = v_report.report_id AND attribute_key = v_elem->>'attributeKey' AND is_aggregate;
    IF NOT FOUND THEN
      PERFORM bi_engine.fail('22023', format('Unknown aggregate attribute ''%s''', v_elem->>'attributeKey'), format('aggregates[%s].attributeKey', v_idx));
    END IF;
    IF coalesce(v_elem->>'grain', 'month') <> 'month' THEN
      PERFORM bi_engine.fail('22023', format('Unsupported grain ''%s''', v_elem->>'grain'), format('aggregates[%s].grain', v_idx));
    END IF;
    v_group_select := v_group_select || CASE WHEN v_group_select = '' THEN '' ELSE ', ' END || format('%I AS %I', r.column_name, r.attribute_key);
    v_group_cols   := v_group_cols   || CASE WHEN v_group_cols   = '' THEN '' ELSE ', ' END || format('%I', r.column_name);
    v_group_order  := v_group_order  || CASE WHEN v_group_order  = '' THEN '' ELSE ', ' END || format('t.%I DESC', r.attribute_key);
  END LOOP;

  -- saved dataset: its filters become WHERE clauses; access = same customer and (owner or public)
  IF p_request ? 'datasetId' AND p_request->'datasetId' <> 'null' THEN
    IF (p_request->>'datasetId') !~ '^\d{1,9}$' THEN PERFORM bi_engine.fail('22023', 'datasetId must be a number', 'datasetId'); END IF;
    v_dataset_id := (p_request->>'datasetId')::integer;
    SELECT jsonb_build_object('id', d.dataset_id, 'name', d.name) INTO v_dataset
      FROM pi.dataset d
     WHERE d.dataset_id = v_dataset_id AND d.customer_id = v_customer_id AND d.dataset_status_id = 1
       AND (d.owner_user_id = p_user_id OR d.readpolicy_id = 2);
    IF NOT FOUND THEN PERFORM bi_engine.fail('P0002', format('Dataset %s not found', v_dataset_id), 'datasetId'); END IF;
    UPDATE pi.dataset SET last_accessed_date_time = now() WHERE dataset_id = v_dataset_id;

    FOR r IN
      SELECT f.attribute_key, a.column_name, jsonb_agg(f.value ORDER BY f.value) AS vals
        FROM pi.dataset_filter f
        LEFT JOIN pi.query_attribute a ON a.report_id = v_report.report_id AND a.attribute_key = f.attribute_key AND a.is_filter
       WHERE f.dataset_id = v_dataset_id
       GROUP BY f.attribute_key, a.column_name
    LOOP
      IF r.column_name IS NULL THEN
        PERFORM bi_engine.fail('22023', format('Dataset filter ''%s'' does not apply to report %s', r.attribute_key, v_report.report_id), 'datasetId');
      END IF;
      v_clauses := v_clauses || format(' AND %I = ANY (ARRAY(SELECT jsonb_array_elements_text($2 -> %s)))', r.column_name, jsonb_array_length(v_filter_values));
      v_filter_values := v_filter_values || jsonb_build_array(r.vals);
      v_applied := v_applied || jsonb_build_object('attributeKey', r.attribute_key, 'values', r.vals, 'source', 'dataset');
    END LOOP;
  END IF;

  -- request filters (ANDed with the dataset's; the same attribute in both narrows to the overlap)
  IF p_request ? 'filters' AND p_request->'filters' <> 'null' AND jsonb_typeof(p_request->'filters') <> 'array' THEN
    PERFORM bi_engine.fail('22023', 'filters must be an array', 'filters');
  END IF;
  FOR v_elem, v_idx IN
    SELECT e, o::integer - 1 FROM jsonb_array_elements(coalesce(nullif(p_request->'filters', 'null'), '[]')) WITH ORDINALITY AS a(e, o)
  LOOP
    v_key := v_elem->>'attributeKey';
    SELECT * INTO r FROM pi.query_attribute WHERE report_id = v_report.report_id AND attribute_key = v_key AND is_filter;
    IF NOT FOUND THEN PERFORM bi_engine.fail('22023', format('Unknown filter attribute ''%s''', v_key), format('filters[%s].attributeKey', v_idx)); END IF;
    v_values := coalesce(nullif(v_elem->'values', 'null'), '[]');
    IF jsonb_typeof(v_values) <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_values) x WHERE jsonb_typeof(x) <> 'string' OR btrim(x #>> '{}') = '') THEN
      PERFORM bi_engine.fail('22023', 'Filter values must be non-empty strings', format('filters[%s].values', v_idx));
    END IF;
    IF jsonb_array_length(v_values) > c_max_values THEN
      PERFORM bi_engine.fail('22023', format('At most %s values per filter', c_max_values), format('filters[%s].values', v_idx));
    END IF;
    CONTINUE WHEN jsonb_array_length(v_values) = 0;
    v_clauses := v_clauses || format(' AND %I = ANY (ARRAY(SELECT jsonb_array_elements_text($2 -> %s)))', r.column_name, jsonb_array_length(v_filter_values));
    v_filter_values := v_filter_values || jsonb_build_array(v_values);
    v_applied := v_applied || jsonb_build_object('attributeKey', v_key, 'values', v_values, 'source', 'request');
  END LOOP;

  -- month window: the latest <months> months of this customer's data
  EXECUTE format('SELECT max(%I) FROM pi.%I WHERE customer_id = $1', v_report.month_column, v_report.fact_table)
     INTO v_latest USING v_customer_id;
  IF v_latest IS NOT NULL THEN
    v_from := to_char(to_date(v_latest, 'YYYY-MM') - make_interval(months => v_months - 1), 'YYYY-MM');
  END IF;

  v_where := format('customer_id = $1 AND %I >= $3', v_report.month_column) || v_clauses;
  v_rows_sql := format(
    'SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY %s), ''[]'') FROM (SELECT %s, %s FROM pi.%I WHERE %s GROUP BY %s) t',
    v_group_order, v_group_select, v_measure_sql, v_report.fact_table, v_where, v_group_cols);
  v_kpi_sql := format('SELECT to_jsonb(t) FROM (SELECT %s FROM pi.%I WHERE %s) t', v_measure_sql, v_report.fact_table, v_where);

  EXECUTE v_rows_sql INTO v_rows USING v_customer_id, v_filter_values, v_from;
  EXECUTE v_kpi_sql INTO v_totals USING v_customer_id, v_filter_values, v_from;

  FOR r IN SELECT attribute_key, column_name FROM pi.query_attribute WHERE report_id = v_report.report_id AND is_filter ORDER BY attribute_key LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(v ORDER BY v), ''[]'') FROM (SELECT DISTINCT %I AS v FROM pi.%I WHERE customer_id = $1) d',
                   r.column_name, v_report.fact_table)
       INTO v_opts USING v_customer_id;
    v_options := v_options || jsonb_build_object(r.attribute_key, v_opts);
  END LOOP;

  RETURN jsonb_build_object(
    'report', jsonb_build_object('id', v_report.report_id, 'title', v_report.title, 'customer', v_customer,
                                 'asOf', now(), 'from', v_from, 'to', v_latest),
    'dataset', v_dataset,
    'kpis', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', m->>'key', 'label', m->>'label', 'format', m->>'format',
                                                          'value', coalesce(nullif(v_totals->(m->>'key'), 'null'::jsonb), '0'::jsonb))), '[]')
               FROM jsonb_array_elements(v_measures) m),
    'filterOptions', v_options,
    'appliedFilters', v_applied,
    'rows', v_rows
  ) || CASE WHEN p_request->'debug' = 'true'::jsonb
            THEN jsonb_build_object('sql', jsonb_build_object('rows', v_rows_sql, 'kpis', v_kpi_sql,
                                     'params', jsonb_build_array(v_customer_id, v_filter_values, v_from)))
            ELSE '{}'::jsonb END;
END $$;
