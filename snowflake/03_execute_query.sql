-- 03_execute_query.sql : PI.BI_ENGINE.EXECUTE_QUERY, the JSON -> SQL procedure the Function API calls.
-- Run as SYSADMIN (or PI_BI_OWNER if you created the roles) after 02_engine_tables.sql.
--
--   CALL PI.BI_ENGINE.EXECUTE_QUERY(
--     PARSE_JSON('{
--       "customerId": 1,                                   -- required; set by the Function API from the signed-in user
--       "lineOfBusinessId": 1,                             -- required; read by the Function API from the App DB
--                                                          --   (the dataset's, else the customer's). Selects which
--                                                          --   measures / attributes apply.
--       "datasetId": 1,                                    -- optional; already checked by the Function API; cache key + log only
--       "measures": ["claimsDenied", "grossSavings"],      -- MEASURE_DETAILS.MEASURE names
--       "aggregates": [{"attributeKey": "month"}],         -- group-by attributes (ATTRIBUTE_DETAILS.ATTRIBUTEKEY)
--       "filters": [{"attributeKey": "market", "values": ["AZ","TX"]}],
--       "months": 24,                                      -- optional: latest N months of the customer's data
--       "attributeValues": ["market", "programType"],      -- optional: distinct values for filter dropdowns
--       "recordLimit": 0, "recordStart": 0,                -- optional paging
--       "debug": false                                     -- true adds the generated SQL to the response
--     }'),
--     '<user id>', '<client ip>',                          -- logged only
--     TRUE,                                                -- USE_CACHE: reuse generated SQL for identical payloads
--     FALSE);                                              -- SQL_ONLY: return the SQL without running it
--
-- How it works (docs/BI_ENGINE_SNOWFLAKE.md section 5 has the full description):
--   1. Validate the payload. The customer, line of business and dataset are NOT looked up here: they live in the
--      App DB (Postgres) and the Function API has already resolved and authorised them.
--   2. Cache lookup by payload hash (EXECUTE_QUERY_CACHE). A hit skips steps 3-4.
--   3. Read the metadata: MEASURE_DETAILS (+ MEASURE_FILTER_DETAILS), ATTRIBUTE_DETAILS, RELATIONSHIP_METADATA_DETAILS.
--   4. Build one CTE per base measure (its own fact table, filters and GROUP BY) and merge them with a full
--      outer join on the group-by keys. Derived measures (BASENUMERATOR OPERATOR BASEDENOMINATOR) are computed
--      from those CTEs in the final SELECT.
--   5. Run the SQL against PI.CORE, log the call, return { status, columns, rows, ... }.
--
-- Errors never raise: the procedure returns { status: 'ERROR', code, message, field }.
--   INVALID_REQUEST -> HTTP 400, INVALID_METADATA / INTERNAL -> 500.
--
-- Security: the engine trusts customerId and lineOfBusinessId, because only the Function API's role (PI_BI_API)
-- may call it. The Function API must take both from the signed-in user / dataset in the App DB, never from the
-- browser. EXECUTE AS OWNER, so callers need no table access. Table, column and expression text comes only
-- from the metadata tables (developer-maintained, screened for ';', comments and DDL/DML keywords). Every
-- request value is emitted as an escaped string literal, capped in length and count; attribute keys, measure
-- names and operators are matched against metadata or a whitelist and never written to SQL as typed.

CREATE OR REPLACE PROCEDURE PI.BI_ENGINE.EXECUTE_QUERY(
    PAYLOAD    VARIANT,
    USER_ID    VARCHAR DEFAULT NULL,
    CLIENT_IP  VARCHAR DEFAULT NULL,
    USE_CACHE  BOOLEAN DEFAULT TRUE,
    SQL_ONLY   BOOLEAN DEFAULT FALSE)
RETURNS VARIANT
LANGUAGE JAVASCRIPT
EXECUTE AS OWNER
AS
$$
var DB = 'PI';
var SCH = DB + '.BI_ENGINE.';
var CORE = DB + '.CORE.';
var PROC_NAME = DB + '.BI_ENGINE.EXECUTE_QUERY';
var T = {
  M: SCH + 'MEASURE_DETAILS',
  F: SCH + 'MEASURE_FILTER_DETAILS',
  A: SCH + 'ATTRIBUTE_DETAILS',
  R: SCH + 'RELATIONSHIP_METADATA_DETAILS',
  C: SCH + 'EXECUTE_QUERY_CACHE',
  L: SCH + 'EXECUTE_QUERY_LOG',
  E: SCH + 'EXECUTE_QUERY_ERROR_LOG'
};
var MAX_DEPTH = 10;       // nesting of derived measures
var MAX_MEASURES = 25;
var MAX_GROUPS = 5;
var MAX_FILTERS = 25;
var MAX_VALUES = 200;     // values per filter
var MAX_VALUE_LEN = 500;
var MAX_MONTHS = 60;
var MAX_ROWS = 10000;
var MAX_DISTINCT = 1000;
var MEASURE_OPS = { '/': 1, '*': 1, '+': 1, '-': 1 };
var FILTER_OPS = ['=', '!=', '<>', '>', '>=', '<', '<=', 'IN', 'NOT IN', 'LIKE', 'NOT LIKE', 'BETWEEN', 'IS NULL', 'IS NOT NULL'];
var IDENT = /^[A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*){0,2}$/;
var BARE = /^[A-Za-z_][A-Za-z0-9_$]*$/;
var UNSAFE = /;|--|\/\*|\*\/|\b(DROP|DELETE|INSERT|UPDATE|MERGE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|CALL)\b/i;

var started = Date.now();
var state = { datasetId: 0, hash: null, measures: '', cacheHit: false, debug: false, sql: null };

/* ---------- helpers ---------- */
function fail(code, message, field) {
  var e = new Error(message);
  e.bi = { code: code, field: field || null };
  throw e;
}
function query(sqlText, binds) {
  var rs = snowflake.execute({ sqlText: sqlText, binds: binds || [] });
  var n = rs.getColumnCount(), cols = [], out = [];
  for (var i = 1; i <= n; i++) cols.push(rs.getColumnName(i));
  while (rs.next()) {
    var r = {};
    for (var j = 0; j < n; j++) {
      var v = rs.getColumnValue(j + 1);
      r[cols[j]] = (v instanceof Date) ? v.toISOString() : v;
    }
    out.push(r);
  }
  return out;
}
function run(sqlText, binds) { snowflake.execute({ sqlText: sqlText, binds: binds || [] }); }
function up(s) { return String(s).toUpperCase(); }
function marks(n) { var a = []; for (var i = 0; i < n; i++) a.push('?'); return a.join(','); }
function lit(v) { return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'"; }
function quoteAlias(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }
function pick(o, names) {
  if (o === null || typeof o !== 'object') return undefined;
  var keys = Object.keys(o);
  for (var i = 0; i < names.length; i++)
    for (var k = 0; k < keys.length; k++)
      if (keys[k].toLowerCase() === names[i].toLowerCase()) return o[keys[k]];
  return undefined;
}
function parseJson(v) { return (typeof v === 'string') ? JSON.parse(v) : v; }
function safeSql(s, what) {
  s = String(s === null || s === undefined ? '' : s).trim();
  if (!s || UNSAFE.test(s)) fail('INVALID_METADATA', what + ' is empty or contains a forbidden token');
  return s;
}
function factName(ft) { var p = String(ft).trim().split('.'); return up(p[p.length - 1]); }
function qualifyFact(ft) {
  ft = String(ft === null || ft === undefined ? '' : ft).trim();
  if (!IDENT.test(ft)) fail('INVALID_METADATA', "Invalid fact table name '" + ft + "'");
  var p = ft.split('.');
  if (p.length === 3 && up(p[0] + '.' + p[1]) !== DB + '.CORE') fail('INVALID_METADATA', "Fact table '" + ft + "' is not in " + DB + '.CORE');
  if (p.length === 2 && up(p[0]) !== 'CORE') fail('INVALID_METADATA', "Fact table '" + ft + "' is not in " + DB + '.CORE');
  return CORE + up(p[p.length - 1]);
}
function toInt(v, field, required, min, max) {
  if (v === undefined || v === null || v === '') {
    if (required) fail('INVALID_REQUEST', field + ' is required', field);
    return null;
  }
  var n = Number(v);
  if (typeof v === 'boolean' || !isFinite(n) || Math.floor(n) !== n || n < min || n > max)
    fail('INVALID_REQUEST', field + ' must be a whole number from ' + min + ' to ' + max, field);
  return n;
}
function keyOf(item, names) {
  if (typeof item === 'string') return item.replace(/[{}]/g, '').trim();
  var v = pick(item, names);
  return (typeof v === 'string') ? v.trim() : '';
}
function toKeys(v, field, names, max) {
  if (v === undefined || v === null) return [];
  if (typeof v === 'string') v = v.split(',');
  if (!Array.isArray(v)) fail('INVALID_REQUEST', field + ' must be an array', field);
  var out = [], seen = {};
  for (var i = 0; i < v.length; i++) {
    var k = keyOf(v[i], names);
    if (!k || k.length > 128) fail('INVALID_REQUEST', field + '[' + i + '] must be a non-empty name', field + '[' + i + ']');
    if (!seen[up(k)]) { seen[up(k)] = 1; out.push(k); }
  }
  if (out.length > max) fail('INVALID_REQUEST', 'At most ' + max + ' entries allowed in ' + field, field);
  return out;
}

/* ---------- request ---------- */
function normalizeFilter(f, i) {
  var field = 'filters[' + i + ']';
  var key = keyOf(f, ['attributeKey', 'attribute', 'key']);
  if (!key) fail('INVALID_REQUEST', 'attributeKey is required', field + '.attributeKey');
  var op = up(String(pick(f, ['operator', 'op']) || 'IN')).replace(/\s+/g, ' ').trim();
  if (FILTER_OPS.indexOf(op) < 0) fail('INVALID_REQUEST', "Operator '" + op + "' is not allowed", field + '.operator');
  var raw = pick(f, ['values', 'value']);
  var arr = (raw === undefined || raw === null) ? [] : (Array.isArray(raw) ? raw : [raw]);
  var vals = [], seen = {};
  for (var k = 0; k < arr.length; k++) {
    var t = typeof arr[k];
    if (t !== 'string' && t !== 'number' && t !== 'boolean') fail('INVALID_REQUEST', 'Filter values must be strings or numbers', field + '.values');
    var s = String(arr[k]).trim();
    if (!s || s.length > MAX_VALUE_LEN || /[\u0000-\u001f]/.test(s)) fail('INVALID_REQUEST', 'Filter values must be non-empty text of at most ' + MAX_VALUE_LEN + ' characters', field + '.values');
    if (!seen[s]) { seen[s] = 1; vals.push(s); }
  }
  if (vals.length > MAX_VALUES) fail('INVALID_REQUEST', 'At most ' + MAX_VALUES + ' values per filter', field + '.values');
  if (op === 'IS NULL' || op === 'IS NOT NULL') { if (vals.length) fail('INVALID_REQUEST', op + ' takes no values', field + '.values'); }
  else if (op === 'BETWEEN') { if (vals.length !== 2) fail('INVALID_REQUEST', 'BETWEEN needs exactly two values', field + '.values'); }
  else if (op === 'IN' || op === 'NOT IN') { if (!vals.length) return null; }   // an empty list means "all values"
  else if (vals.length !== 1) fail('INVALID_REQUEST', op + ' needs exactly one value', field + '.values');
  return { key: key, op: op, values: vals };
}
function parseRequest(p) {
  p = parseJson(p);
  if (p === null || typeof p !== 'object' || Array.isArray(p)) fail('INVALID_REQUEST', 'Payload must be a JSON object', 'payload');
  var req = {};
  req.customerId = toInt(pick(p, ['customerId']), 'customerId', true, 1, 9007199254740991);
  req.lobId = toInt(pick(p, ['lineOfBusinessId', 'lobId']), 'lineOfBusinessId', true, 1, 9007199254740991);
  req.datasetId = toInt(pick(p, ['datasetId']), 'datasetId', false, 1, 9007199254740991) || 0;
  req.measures = toKeys(pick(p, ['measures', 'measure']), 'measures', ['measure', 'name', 'key'], MAX_MEASURES);
  req.groups = toKeys(pick(p, ['aggregates', 'groupBy']), 'aggregates', ['attributeKey', 'attribute', 'key'], MAX_GROUPS);
  req.attributeValues = toKeys(pick(p, ['attributeValues']), 'attributeValues', ['attributeKey', 'attribute', 'key'], MAX_GROUPS * 4);
  var rawFilters = pick(p, ['filters']);
  if (rawFilters !== undefined && rawFilters !== null && !Array.isArray(rawFilters)) fail('INVALID_REQUEST', 'filters must be an array', 'filters');
  rawFilters = rawFilters || [];
  if (rawFilters.length > MAX_FILTERS) fail('INVALID_REQUEST', 'At most ' + MAX_FILTERS + ' filters allowed', 'filters');
  req.filters = [];
  for (var i = 0; i < rawFilters.length; i++) { var f = normalizeFilter(rawFilters[i], i); if (f) req.filters.push(f); }
  req.months = toInt(pick(p, ['months']), 'months', false, 1, MAX_MONTHS);
  req.recordLimit = toInt(pick(p, ['recordLimit']), 'recordLimit', false, 0, MAX_ROWS) || 0;
  req.recordStart = toInt(pick(p, ['recordStart']), 'recordStart', false, 0, 1000000000) || 0;
  req.debug = pick(p, ['debug']) === true;
  if (!req.measures.length && !req.attributeValues.length) fail('INVALID_REQUEST', 'Request at least one measure or attributeValues entry', 'measures');
  if (!req.measures.length && req.groups.length) fail('INVALID_REQUEST', 'aggregates need at least one measure', 'aggregates');
  return req;
}
function canonicalText(req) {
  var c = {
    customerId: req.customerId, lineOfBusinessId: req.lobId, datasetId: req.datasetId,
    measures: req.measures.map(up), groups: req.groups.map(up),
    filters: req.filters.map(function (f) { return [up(f.key), f.op, f.values]; }),
    months: req.months, recordLimit: req.recordLimit, recordStart: req.recordStart
  };
  return JSON.stringify(c);
}

/* ---------- metadata ---------- */
function loadMeasures(lobId) {
  var rows = query(
    'SELECT MEASUREID, MEASURE, MEASUREDESCRIPTION, MEASUREFACT, SQLCALCSTATEMENT, FORMATSTRING, BASENUMERATOR, BASEDENOMINATOR,' +
    ' RESULTMULTIPLIER, OPERATOR, USESABSOLUTE FROM ' + T.M +
    ' WHERE TERMINATEDDATETIME IS NULL AND (LINEOFBUSINESS_ID = ? OR LINEOFBUSINESS_ID IS NULL)' +
    ' ORDER BY IFF(LINEOFBUSINESS_ID IS NULL, 1, 0), MODIFIEDDATETIME DESC NULLS LAST', [lobId]);
  var byName = {}, byId = {};
  rows.forEach(function (r) {
    if (r.MEASURE && !byName[up(r.MEASURE)]) byName[up(r.MEASURE)] = r;
    if (r.MEASUREID !== null && r.MEASUREID !== undefined && !byId[String(r.MEASUREID)]) byId[String(r.MEASUREID)] = r;
  });
  return { byName: byName, byId: byId };
}
function loadAttributes(keys, lobId) {
  var out = {};
  if (!keys.length) return out;
  var rows = query(
    'SELECT ATTRIBUTEID, ATTRIBUTEKEY, ATTRIBUTEDESCRIPTION, FILTERSQL FROM ' + T.A +
    ' WHERE TERMINATEDDATETIME IS NULL AND LINEOFBUSINESS_ID = ? AND UPPER(ATTRIBUTEKEY) IN (' + marks(keys.length) + ')' +
    ' QUALIFY ROW_NUMBER() OVER (PARTITION BY UPPER(ATTRIBUTEKEY) ORDER BY MODIFIEDDATETIME DESC NULLS LAST) = 1',
    [lobId].concat(keys.map(up)));
  rows.forEach(function (r) { out[up(r.ATTRIBUTEKEY)] = r; });
  return out;
}
function loadRelationships(keys) {
  var out = {};
  if (!keys.length) return out;
  var rows = query(
    'SELECT RELATIONSHIPMETADATAID, ATTRIBUTEKEY, FACTTABLE, SQLCOLUMN, SQLJOINSTATEMENT, ISYEARMONTH FROM ' + T.R +
    ' WHERE UPPER(ATTRIBUTEKEY) IN (' + marks(keys.length) + ') ORDER BY RELATIONSHIPMETADATAID', keys.map(up));
  rows.forEach(function (r) { (out[up(r.ATTRIBUTEKEY)] = out[up(r.ATTRIBUTEKEY)] || []).push(r); });
  return out;
}
function loadYearMonth(fact) {
  var rows = query(
    'SELECT ATTRIBUTEKEY, FACTTABLE FROM ' + T.R + " WHERE UPPER(ISYEARMONTH) IN ('Y', 'YES', 'TRUE', '1') ORDER BY RELATIONSHIPMETADATAID");
  var hit = rows.filter(function (r) { return factName(r.FACTTABLE) === factName(fact); });
  return hit.length ? hit[0].ATTRIBUTEKEY : null;
}
function loadMeasureFilters(ids) {
  var out = {};
  if (!ids.length) return out;
  query('SELECT MEASUREID, ATTRIBUTEKEY, FILTERSTATEMENT FROM ' + T.F +
        ' WHERE TERMINATEDDATETIME IS NULL AND MEASUREID IN (' + marks(ids.length) + ') ORDER BY MEASUREFILTERID', ids)
    .forEach(function (r) { (out[String(r.MEASUREID)] = out[String(r.MEASUREID)] || []).push(r); });
  return out;
}

/* ---------- SQL building ---------- */
// Attribute -> SQL expression on a given fact. Registers the join it needs in `joins`.
function attrExpr(model, key, fact, joins, field) {
  var a = model.attrs[up(key)];
  if (!a) fail('INVALID_REQUEST', "Unknown attribute '" + key + "'", field);
  var rels = (model.rels[up(key)] || []).filter(function (r) { return factName(r.FACTTABLE) === factName(fact); });
  if (!rels.length) fail('INVALID_REQUEST', "Attribute '" + key + "' is not available for fact " + factName(fact), field);
  var rel = rels[0];
  var col = String(rel.SQLCOLUMN || a.FILTERSQL || '').trim();
  if (!col) fail('INVALID_METADATA', "Attribute '" + key + "' has no SQLCOLUMN or FILTERSQL");
  var expr = BARE.test(col) ? 'F.' + col : safeSql(col, "Attribute '" + key + "' SQLCOLUMN");
  if (rel.SQLJOINSTATEMENT && String(rel.SQLJOINSTATEMENT).trim()) {
    var j = safeSql(rel.SQLJOINSTATEMENT, "Attribute '" + key + "' SQLJOINSTATEMENT");
    if (!joins.seen[j]) { joins.seen[j] = 1; joins.list.push(j); }
  }
  return expr;
}
function predicate(expr, f) {
  switch (f.op) {
    case 'IN': case 'NOT IN': return expr + ' ' + f.op + ' (' + f.values.map(lit).join(', ') + ')';
    case 'BETWEEN': return expr + ' BETWEEN ' + lit(f.values[0]) + ' AND ' + lit(f.values[1]);
    case 'IS NULL': case 'IS NOT NULL': return expr + ' ' + f.op;
    default: return expr + ' ' + f.op + ' ' + lit(f.values[0]);
  }
}
function leafCte(model, req, leaf, mfilters) {
  var m = leaf.m;
  var fact = qualifyFact(m.MEASUREFACT);
  var joins = { list: [], seen: {} };
  var sel = req.groups.map(function (g, i) { return attrExpr(model, g, m.MEASUREFACT, joins, 'aggregates[' + i + ']') + ' AS g' + i; });
  var where = ['F.CUSTOMER_ID = ' + req.customerId];
  req.filters.forEach(function (f, i) {
    where.push(predicate(attrExpr(model, f.key, m.MEASUREFACT, joins, 'filters[' + i + '].attributeKey'), f));
  });
  if (req.months) {
    var ymKey = loadYearMonth(m.MEASUREFACT);
    if (!ymKey) fail('INVALID_REQUEST', 'months is not supported for fact ' + factName(m.MEASUREFACT) + ' (no ISYEARMONTH attribute)', 'months');
    var yj = { list: [], seen: {} };
    var yExpr = attrExpr(model, ymKey, m.MEASUREFACT, yj, 'months');
    where.push(yExpr + ' >= (SELECT TO_CHAR(DATEADD(month, -' + (req.months - 1) + ", TO_DATE(MAX(" + yExpr + ") || '-01')), 'YYYY-MM') FROM " +
               fact + ' AS F ' + yj.list.join(' ') + ' WHERE F.CUSTOMER_ID = ' + req.customerId + ')');
  }
  (mfilters[String(m.MEASUREID)] || []).forEach(function (mf) {
    var stmt = safeSql(mf.FILTERSTATEMENT, 'Measure filter ' + m.MEASURE);
    if (mf.ATTRIBUTEKEY && /^(=|!=|<>|<=|>=|<|>|IN\b|NOT\b|LIKE\b|BETWEEN\b|IS\b)/i.test(stmt))
      stmt = attrExpr(model, mf.ATTRIBUTEKEY, m.MEASUREFACT, joins, 'measure filter') + ' ' + stmt;
    where.push('(' + stmt + ')');
  });
  sel.push(safeSql(m.SQLCALCSTATEMENT, 'Measure ' + m.MEASURE + ' SQLCALCSTATEMENT') + ' AS V');
  var ordinals = req.groups.map(function (g, i) { return String(i + 1); }).join(', ');
  return 'SELECT ' + sel.join(', ') + ' FROM ' + fact + ' AS F ' + joins.list.join(' ') +
         ' WHERE ' + where.join(' AND ') + (req.groups.length ? ' GROUP BY ' + ordinals : '');
}
function buildMeasureSql(req, scope) {
  var mm = loadMeasures(scope.lobId);
  var leaves = [], leafIdx = {};
  function leafFor(m) {
    var id = String(m.MEASUREID);
    if (leafIdx[id] === undefined) { leafIdx[id] = leaves.length; leaves.push({ m: m }); }
    return leafIdx[id] + 1;
  }
  function compile(m, depth) {
    if (depth > MAX_DEPTH) fail('INVALID_METADATA', "Measure '" + m.MEASURE + "' is nested too deeply (cycle?)");
    var expr;
    if (m.SQLCALCSTATEMENT && String(m.SQLCALCSTATEMENT).trim()) {
      if (!m.MEASUREFACT) fail('INVALID_METADATA', "Measure '" + m.MEASURE + "' has no MEASUREFACT");
      expr = 'c' + leafFor(m) + '.V';
    } else if (m.BASENUMERATOR !== null && m.BASENUMERATOR !== undefined && m.BASEDENOMINATOR !== null && m.BASEDENOMINATOR !== undefined) {
      var op = String(m.OPERATOR || '/').trim();
      if (!MEASURE_OPS[op]) fail('INVALID_METADATA', "Measure '" + m.MEASURE + "' has an unsupported OPERATOR '" + op + "'");
      var n = mm.byId[String(m.BASENUMERATOR)], d = mm.byId[String(m.BASEDENOMINATOR)];
      if (!n || !d) fail('INVALID_METADATA', "Measure '" + m.MEASURE + "' refers to a missing or terminated base measure");
      var a = compile(n, depth + 1), b = compile(d, depth + 1);
      expr = (op === '/') ? '(' + a + ' / NULLIF(' + b + ', 0))' : '(' + a + ' ' + op + ' ' + b + ')';
      var mult = (m.RESULTMULTIPLIER === null || m.RESULTMULTIPLIER === undefined) ? '' : String(m.RESULTMULTIPLIER).trim();
      if (mult !== '') {
        if (!/^-?\d+(\.\d+)?$/.test(mult)) fail('INVALID_METADATA', "Measure '" + m.MEASURE + "' has a non-numeric RESULTMULTIPLIER");
        expr = '(' + expr + ' * ' + mult + ')';
      }
    } else {
      fail('INVALID_METADATA', "Measure '" + m.MEASURE + "' has neither SQLCALCSTATEMENT nor base measures");
    }
    return (Number(m.USESABSOLUTE) === 1) ? 'ABS(' + expr + ')' : expr;
  }

  var requested = req.measures.map(function (name, i) {
    var m = mm.byName[up(name)];
    if (!m) fail('INVALID_REQUEST', "Unknown measure '" + name + "'", 'measures[' + i + ']');
    return m;
  });
  var measureExprs = requested.map(function (m) { return compile(m, 1); });

  // metadata for the attributes: group-by + request filters + measure-level filters
  var mfilters = loadMeasureFilters(leaves.map(function (l) { return l.m.MEASUREID; }));
  var attrKeys = req.groups.concat(req.filters.map(function (f) { return f.key; }));
  Object.keys(mfilters).forEach(function (id) { mfilters[id].forEach(function (r) { if (r.ATTRIBUTEKEY) attrKeys.push(r.ATTRIBUTEKEY); }); });
  var seen = {}; attrKeys = attrKeys.filter(function (k) { var u = up(k); if (seen[u]) return false; seen[u] = 1; return true; });
  var ymKeys = [];
  var model = { attrs: loadAttributes(attrKeys, scope.lobId), rels: null };
  if (req.months) {   // the year-month attribute is needed by every leaf's fact
    leaves.forEach(function (l) { var y = loadYearMonth(l.m.MEASUREFACT); if (y) ymKeys.push(y); });
    var extra = loadAttributes(ymKeys, scope.lobId);
    Object.keys(extra).forEach(function (k) { model.attrs[k] = extra[k]; });
  }
  model.rels = loadRelationships(attrKeys.concat(ymKeys));

  // validate group keys up front so the error names the field
  var groupAttrs = req.groups.map(function (g, i) {
    var a = model.attrs[up(g)];
    if (!a) fail('INVALID_REQUEST', "Unknown attribute '" + g + "'", 'aggregates[' + i + ']');
    return a;
  });

  var ctes = leaves.map(function (l, i) { return 'c' + (i + 1) + ' AS (' + leafCte(model, req, l, mfilters) + ')'; });

  // merge: full outer join of the per-measure CTEs on the group-by keys
  var gSel = req.groups.map(function (g, i) {
    var cols = leaves.map(function (l, k) { return 'c' + (k + 1) + '.g' + i; });
    return (cols.length > 1 ? 'COALESCE(' + cols.join(', ') + ')' : cols[0]) + ' AS ' + quoteAlias(groupAttrs[i].ATTRIBUTEKEY);
  });
  var mSel = measureExprs.map(function (e, i) { return e + ' AS ' + quoteAlias(requested[i].MEASURE); });
  var from = 'c1';
  for (var k = 1; k < leaves.length; k++) {
    if (!req.groups.length) { from += ' CROSS JOIN c' + (k + 1); continue; }
    var cond = req.groups.map(function (g, i) {
      var prev = []; for (var p = 0; p < k; p++) prev.push('c' + (p + 1) + '.g' + i);
      return 'EQUAL_NULL(' + (prev.length > 1 ? 'COALESCE(' + prev.join(', ') + ')' : prev[0]) + ', c' + (k + 1) + '.g' + i + ')';
    }).join(' AND ');
    from += ' FULL OUTER JOIN c' + (k + 1) + ' ON ' + cond;
  }
  var limit = req.recordLimit > 0 ? Math.min(req.recordLimit, MAX_ROWS) : MAX_ROWS;
  var sql = 'WITH ' + ctes.join(', ') + ' SELECT ' + gSel.concat(mSel).join(', ') + ' FROM ' + from +
    (req.groups.length ? ' ORDER BY ' + req.groups.map(function (g, i) { return (i + 1) + ' DESC'; }).join(', ') : '') +
    ' LIMIT ' + limit + (req.recordStart > 0 ? ' OFFSET ' + req.recordStart : '');
  var columns = groupAttrs.map(function (a) {
    return { name: a.ATTRIBUTEKEY, kind: 'attribute', description: a.ATTRIBUTEDESCRIPTION || null };
  }).concat(requested.map(function (m) {
    return { name: m.MEASURE, kind: 'measure', description: m.MEASUREDESCRIPTION || null, format: m.FORMATSTRING || null };
  }));
  var applied = req.filters.map(function (f) { return { attributeKey: f.key, operator: f.op, values: f.values, source: 'request' }; });
  return { sql: sql, plan: { columns: columns, appliedFilters: applied } };
}

function attributeValues(req, scope) {
  var attrs = loadAttributes(req.attributeValues, scope.lobId);
  var rels = loadRelationships(req.attributeValues);
  var model = { attrs: attrs, rels: rels };
  var out = {};
  req.attributeValues.forEach(function (key, i) {
    var r = (rels[up(key)] || [])[0];
    if (!attrs[up(key)] || !r) fail('INVALID_REQUEST', "Unknown attribute '" + key + "'", 'attributeValues[' + i + ']');
    var joins = { list: [], seen: {} };
    var expr = attrExpr(model, key, r.FACTTABLE, joins, 'attributeValues[' + i + ']');
    var sql = 'SELECT DISTINCT ' + expr + ' AS V FROM ' + qualifyFact(r.FACTTABLE) + ' AS F ' + joins.list.join(' ') +
              ' WHERE F.CUSTOMER_ID = ' + req.customerId + ' AND ' + expr + ' IS NOT NULL ORDER BY 1 LIMIT ' + MAX_DISTINCT;
    out[attrs[up(key)].ATTRIBUTEKEY] = query(sql).map(function (x) { return x.V; });
  });
  return out;
}

/* ---------- cache and logging ---------- */
function cacheLookup(hash, datasetId) {
  var rows = query('SELECT GENERATED_SQL, ANSWER FROM ' + T.C + ' WHERE QUERY_HASH = TO_NUMBER(?) AND COALESCE(DATASET_ID, 0) = ? ORDER BY CREATED_AT DESC LIMIT 1', [hash, datasetId]);
  if (!rows.length || !rows[0].GENERATED_SQL) return null;
  var plan = parseJson(rows[0].ANSWER);
  return plan && plan.columns ? { sql: rows[0].GENERATED_SQL, plan: plan } : null;
}
function cacheStore(hash, text, built, ms) {
  // MERGE (not a plain INSERT) so two concurrent identical requests do not create duplicate cache rows.
  run('MERGE INTO ' + T.C + ' t USING (SELECT TO_NUMBER(?) AS H, ? AS D, ? AS QT, ? AS M, ? AS GS, PARSE_JSON(?) AS ANS, ? AS MS, ? AS U) s' +
      ' ON t.QUERY_HASH = s.H AND COALESCE(t.DATASET_ID, 0) = s.D' +
      ' WHEN NOT MATCHED THEN INSERT (QUERY_HASH, QUERY_TEXT, MEASURE, DATASET_ID, GENERATED_SQL, ANSWER, USECOUNT, LASTUSE, RUNTIME_MS, LASTUIUSER, CREATED_AT)' +
      ' VALUES (s.H, s.QT, s.M, s.D, s.GS, s.ANS, 1, CURRENT_TIMESTAMP(), s.MS, s.U, CURRENT_TIMESTAMP())',
      [hash, state.datasetId, text, state.measures, built.sql, JSON.stringify(built.plan), ms, USER_ID]);
}
function cacheTouch(hash, datasetId) {
  run('UPDATE ' + T.C + ' SET USECOUNT = COALESCE(USECOUNT, 0) + 1, LASTUSE = CURRENT_TIMESTAMP() WHERE QUERY_HASH = TO_NUMBER(?) AND COALESCE(DATASET_ID, 0) = ?', [hash, datasetId]);
}
function logRun(status, message) {
  try {
    run('INSERT INTO ' + T.L + ' (PROC_NAME, USER_ID, CLIENT_IP, DATASET_ID, MEASURE, QUERY_HASH, DEBUG_FLAG, CACHE_HIT, STATUS, MESSAGE, RUNTIME_MS) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [PROC_NAME, USER_ID, CLIENT_IP, state.datasetId, state.measures, state.hash, state.debug, state.cacheHit, status, message, Date.now() - started]);
  } catch (ignore) { /* logging must never break the call */ }
}
function logError(e, payloadText) {
  try {
    run('INSERT INTO ' + T.E + ' (PROC_NAME, USER_ID, CLIENT_IP, XML_QUERY, ERROR_MESSAGE, STACK_TRACE, ERROR_SQL, DATASET_ID, UPDT_DTTM) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP())',
        [PROC_NAME, USER_ID, CLIENT_IP, payloadText, String(e && e.message), String(e && e.stack || ''), state.sql, state.datasetId]);
  } catch (ignore) { /* ignore */ }
}

/* ---------- main ---------- */
var payloadText = null;
try {
  payloadText = (typeof PAYLOAD === 'string') ? PAYLOAD : JSON.stringify(PAYLOAD);
  var req = parseRequest(PAYLOAD);
  state.datasetId = req.datasetId;
  state.measures = req.measures.join(',');
  state.debug = req.debug;
  var scope = { lobId: req.lobId };   // customer / line of business / dataset come from the App DB via the Function API
  var result = { status: 'OK', dataset: req.datasetId ? { id: req.datasetId } : null };

  if (req.measures.length) {
    var text = canonicalText(req);
    state.hash = query('SELECT TO_VARCHAR(HASH(?)) AS H', [text])[0].H;
    var built = (USE_CACHE !== false) ? cacheLookup(state.hash, req.datasetId) : null;
    state.cacheHit = !!built;
    if (!built) built = buildMeasureSql(req, scope);
    state.sql = built.sql;
    result.columns = built.plan.columns;
    result.appliedFilters = built.plan.appliedFilters;
    result.cache = { hit: state.cacheHit, hash: state.hash };
    if (SQL_ONLY === true) {
      result.sql = built.sql;
    } else {
      var t0 = Date.now();
      var rows = query(built.sql);
      var ms = Date.now() - t0;
      result.rows = rows;
      result.rowCount = rows.length;
      result.truncated = rows.length >= MAX_ROWS;
      if (state.cacheHit) cacheTouch(state.hash, req.datasetId);
      else if (USE_CACHE !== false) cacheStore(state.hash, text, built, ms);
      if (req.debug) result.sql = built.sql;
    }
  }
  if (req.attributeValues.length) result.attributeValues = attributeValues(req, scope);

  result.runtimeMs = Date.now() - started;
  logRun('OK', SQL_ONLY === true ? 'SQL only' : null);
  return result;
} catch (e) {
  if (e && e.bi) {
    logRun(e.bi.code, e.message);
    return { status: 'ERROR', code: e.bi.code, message: e.message, field: e.bi.field };
  }
  logRun('INTERNAL', e && e.message);
  logError(e, payloadText);
  return { status: 'ERROR', code: 'INTERNAL', message: 'The query failed. See BI_ENGINE.EXECUTE_QUERY_ERROR_LOG.', field: null };
}
$$;
