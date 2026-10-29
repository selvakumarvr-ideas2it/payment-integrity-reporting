import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Papa from 'papaparse';
import { Alert, Box, Breadcrumbs, Container, Divider, Link, Snackbar, Stack, Typography } from '@mui/material';
import BrandLogo from '../components/BrandLogo.jsx';
import KpiCards from '../components/KpiCards.jsx';
import SavingsTable from '../components/SavingsTable.jsx';
import ReportToolbar from '../components/ReportToolbar.jsx';
import DatasetBar, { describeFilters } from '../components/DatasetBar.jsx';
import SaveDatasetDialog from '../components/SaveDatasetDialog.jsx';
import { loadSavingsInvoice, parseCsvFile } from '../data/dataService.js';
import { createDataset, deleteDataset, fromFilterList, listDatasets, sameFilters, updateDataset } from '../data/datasetsApi.js';
import { COLUMNS, formatMonth } from '../data/schema.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { config } from '../config.js';
import { brand } from '../theme.js';

const EMPTY = { kpis: [], rows: [], columns: COLUMNS, filterOptions: { market: [], programType: [] } };
const NO_FILTERS = { market: [], programType: [] };

export default function SavingsInvoicePage() {
  const { user } = useAuth();
  const [source, setSource] = useState(config.defaultSource);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [uploaded, setUploaded] = useState(null); // { name, rows }
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const [datasets, setDatasets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [dialog, setDialog] = useState(null); // 'create' | 'rename' | null
  const [toast, setToast] = useState('');

  const selected = datasets.find((d) => d.id === selectedId) || null;
  const selectedFilters = useMemo(() => (selected ? fromFilterList(selected.filters) : null), [selected]);
  const dirty = Boolean(selected && !sameFilters(filters, selectedFilters));
  const hasFilters = Boolean(filters.market.length || filters.programType.length);
  // An unmodified saved dataset is sent by id, so the stored procedure resolves its filters.
  const queryDatasetId = selected && !dirty ? selected.id : null;

  const refreshDatasets = useCallback(
    () =>
      listDatasets()
        .then(setDatasets)
        .catch((e) => setError(`Could not load saved datasets: ${e.message}`)),
    [],
  );

  useEffect(() => {
    refreshDatasets();
  }, [refreshDatasets]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    loadSavingsInvoice({ source, filters, datasetId: queryDatasetId, uploadedRows: uploaded?.rows })
      .then((d) => !cancelled && setData(d))
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || String(e));
        setData(EMPTY);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [source, filters, queryDatasetId, uploaded, reloadKey]);

  const handleSelectDataset = useCallback(
    (id) => {
      setSelectedId(id);
      const ds = datasets.find((d) => d.id === id);
      if (ds) setFilters(fromFilterList(ds.filters));
    },
    [datasets],
  );

  const handleSaveDialog = useCallback(
    async ({ name, description }) => {
      if (dialog === 'create') {
        const created = await createDataset({ name, description, filters });
        await refreshDatasets();
        setSelectedId(created.id);
        setToast(`Saved dataset “${created.name}”`);
      } else {
        const renamed = await updateDataset(selected.id, { name, description });
        await refreshDatasets();
        setToast(`Renamed to “${renamed.name}”`);
      }
      setDialog(null);
    },
    [dialog, filters, selected, refreshDatasets],
  );

  const handleUpdate = useCallback(async () => {
    try {
      await updateDataset(selected.id, { filters });
      await refreshDatasets();
      setToast(`Updated “${selected.name}”`);
    } catch (e) {
      setError(e.message);
    }
  }, [selected, filters, refreshDatasets]);

  const handleDelete = useCallback(async () => {
    try {
      await deleteDataset(selected.id);
      setSelectedId(null);
      await refreshDatasets();
      setToast(`Deleted “${selected.name}”`);
    } catch (e) {
      setError(e.message);
    }
  }, [selected, refreshDatasets]);

  const handleUpload = useCallback(async (file) => {
    try {
      const rows = await parseCsvFile(file);
      setFilters(NO_FILTERS);
      setSelectedId(null);
      setUploaded({ name: file.name, rows });
    } catch (e) {
      setError(`Could not read ${file.name}: ${e.message}`);
    }
  }, []);

  const handleExport = useCallback(() => {
    const csv = Papa.unparse(
      data.rows.map((r) => ({
        'Month of Transaction': formatMonth(r.month),
        'Total # Claims Denied': r.claimsDenied,
        'Total Gross Savings': r.grossSavings.toFixed(2),
        Amount: r.amount.toFixed(2),
      })),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'savings-invoice.csv' });
    a.click();
    URL.revokeObjectURL(url);
  }, [data.rows]);

  const months = data.rows.length;
  const sourceLabel = uploaded ? `uploaded file ${uploaded.name}` : { api: 'Function API', json: 'JSON file', csv: 'CSV file' }[source];
  const viewLabel = selected ? `Dataset: ${selected.name}${dirty ? ' (modified)' : ''}` : describeFilters(filters);

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Breadcrumbs sx={{ mb: 2, fontSize: 14 }}>
        <Link component={RouterLink} to="/" underline="hover" color="inherit">
          Home
        </Link>
        <Link component={RouterLink} to="/explore" underline="hover" color="inherit">
          Explore
        </Link>
        <Typography color="text.primary" sx={{ fontSize: 14 }}>
          Savings Invoice
        </Typography>
      </Breadcrumbs>

      <Box sx={{ border: `1px solid ${brand.border}`, bgcolor: '#fff' }}>
        <Stack direction="row" sx={{ alignItems: 'center', px: { xs: 2, md: 3 }, py: 1.5, borderBottom: `2px solid ${brand.ink}` }} spacing={2}>
          <BrandLogo name="optum" label="Optum" height={30} color={brand.orange} />
          <Divider orientation="vertical" flexItem />
          <BrandLogo name="centene" label={user?.customer || config.customerName} height={30} color={brand.navy} />
          <Typography variant="h2" component="h1" sx={{ flexGrow: 1, textAlign: 'center', color: '#222', fontSize: { xs: 18, md: 22 }, pr: { md: 18 } }}>
            {data.report?.title || 'Savings Invoice'}
          </Typography>
        </Stack>

        <Box sx={{ p: { xs: 2, md: 3 } }}>
          <DatasetBar
            datasets={datasets}
            selected={selected}
            dirty={dirty}
            hasFilters={hasFilters}
            disabled={loading || Boolean(uploaded)}
            onSelect={handleSelectDataset}
            onSaveNew={() => setDialog('create')}
            onUpdate={handleUpdate}
            onRename={() => setDialog('rename')}
            onDelete={handleDelete}
          />

          <ReportToolbar
            filters={filters}
            filterOptions={data.filterOptions}
            onFilterChange={setFilters}
            source={source}
            onSourceChange={setSource}
            uploadedName={uploaded?.name}
            onUpload={handleUpload}
            onClearUpload={() => setUploaded(null)}
            onRefresh={() => setReloadKey((k) => k + 1)}
            onExport={handleExport}
            loading={loading}
          />

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}

          <Stack spacing={4} sx={{ mt: 4 }}>
            <KpiCards kpis={data.kpis} loading={loading} title={`${months || 24} Months Savings Invoice - Summary`} />
            <SavingsTable columns={data.columns} rows={data.rows} loading={loading} title={`${months || 24} Months Savings Invoice - Summary by Month`} />
          </Stack>

          {!loading && !error && (
            <Typography variant="caption" color="text.secondary" component="p" align="center" sx={{ mt: 2 }}>
              {viewLabel} · Source: {sourceLabel} · {months} months
              {data.report?.note ? ` · ${data.report.note}` : ''}
            </Typography>
          )}
        </Box>
      </Box>

      <SaveDatasetDialog
        open={Boolean(dialog)}
        mode={dialog === 'rename' ? 'rename' : 'create'}
        initial={dialog === 'rename' ? selected : null}
        filterSummary={dialog === 'create' ? describeFilters(filters) : ''}
        onSubmit={handleSaveDialog}
        onClose={() => setDialog(null)}
      />
      <Snackbar open={Boolean(toast)} autoHideDuration={3000} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Container>
  );
}
