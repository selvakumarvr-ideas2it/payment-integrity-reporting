'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { Alert, Box, Breadcrumbs, Container, Divider, Link as MuiLink, Snackbar, Stack, Typography } from '@mui/material';
import { MEASURES, REPORT, type DatasetRecord, type MeasureKey, type SavingsInvoiceResponse } from '@/model';
import { apiFetch, ApiClientError } from '@/lib/api';
import { describeFilters, EMPTY_FILTERS, fromFilterList, sameFilters, toFilterList, type FilterState } from '@/lib/filters';
import { parseCsvFile, parseCsvText } from '@/lib/csv';
import { buildLocalReport } from '@/lib/local-report';
import { CSV_URL, JSON_URL, SOURCES, type DataSource } from '@/lib/sources';
import { formatMonth } from '@/lib/format';
import { sortRows } from '@/components/SavingsTable';
import BrandLogo from '@/components/BrandLogo';
import KpiCards from '@/components/KpiCards';
import SavingsTable from '@/components/SavingsTable';
import ReportToolbar from '@/components/ReportToolbar';
import DatasetBar from '@/components/DatasetBar';
import SaveDatasetDialog from '@/components/SaveDatasetDialog';
import { useAuth } from '@/auth/AuthContext';
import { brand } from '@/theme';

const MEASURE_KEYS = Object.keys(MEASURES) as MeasureKey[];

type DialogMode = 'create' | 'rename' | null;

type FilePayload = {
  rawRows: Record<string, unknown>[];
  kpis?: unknown;
  filterOptions?: { market?: string[]; programType?: string[] };
  report?: { title?: string; note?: string };
};

async function loadFile(kind: 'json' | 'csv'): Promise<FilePayload> {
  const url = kind === 'csv' ? CSV_URL : JSON_URL;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  if (kind === 'csv') return { rawRows: parseCsvText(await response.text()) };
  const json = (await response.json()) as FilePayload & { data?: Record<string, unknown>[] };
  if (Array.isArray(json)) return { rawRows: json as Record<string, unknown>[] };
  return {
    rawRows: json.rows ?? json.data ?? [],
    kpis: json.kpis,
    filterOptions: json.filterOptions,
    report: json.report,
  };
}

function reportBody(datasetId: number | null, filters: FilterState) {
  const base = {
    reportId: REPORT.id,
    measures: MEASURE_KEYS,
    aggregates: [{ attributeKey: 'month', grain: 'month' }],
    months: 24,
  };
  if (datasetId !== null) return { ...base, datasetId };
  const list = toFilterList(filters);
  return list.length ? { ...base, filters: list } : base;
}

export default function SavingsInvoicePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [source, setSource] = useState<DataSource>('api');
  const [uploaded, setUploaded] = useState<{ name: string; rows: Record<string, unknown>[] } | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [toast, setToast] = useState('');
  const [actionError, setActionError] = useState('');
  const [orderBy, setOrderBy] = useState('month');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');

  const datasetsQuery = useQuery({
    queryKey: ['datasets'],
    queryFn: () => apiFetch<{ datasets: DatasetRecord[] }>('/api/datasets').then((result) => result.datasets),
  });
  const datasets = datasetsQuery.data ?? [];
  const selected = datasets.find((item) => item.id === selectedId) ?? null;
  const selectedFilters = selected ? fromFilterList(selected.filters) : null;
  const dirty = Boolean(selected && selectedFilters && !sameFilters(filters, selectedFilters));
  const hasFilters = Boolean(filters.market.length || filters.programType.length);
  const useApi = source === 'api' && !uploaded;
  const datasetIdForQuery = useApi && selected && !dirty ? selected.id : null;
  const queryKey = datasetIdForQuery !== null ? { datasetId: datasetIdForQuery } : { filters: toFilterList(filters) };

  const reportQuery = useQuery({
    queryKey: ['savings-invoice', queryKey],
    enabled: useApi,
    queryFn: () =>
      apiFetch<SavingsInvoiceResponse>('/api/query', {
        method: 'POST',
        body: reportBody(datasetIdForQuery, filters),
      }),
  });

  const fileQuery = useQuery({
    queryKey: ['savings-invoice-file', source],
    enabled: !uploaded && (source === 'json' || source === 'csv'),
    queryFn: () => loadFile(source === 'csv' ? 'csv' : 'json'),
  });

  const local = useMemo(() => {
    if (uploaded) return buildLocalReport({ rawRows: uploaded.rows, filters, source: 'upload' });
    if ((source === 'json' || source === 'csv') && fileQuery.data) {
      return buildLocalReport({ ...fileQuery.data, filters, source });
    }
    return null;
  }, [uploaded, source, fileQuery.data, filters]);

  const refreshLists = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['datasets'] }),
      queryClient.invalidateQueries({ queryKey: ['savings-invoice'] }),
    ]);

  const createMutation = useMutation({
    mutationFn: (input: { name: string; description: string }) =>
      apiFetch<DatasetRecord>('/api/datasets', {
        method: 'POST',
        body: {
          name: input.name,
          description: input.description,
          filters: toFilterList(filters),
          ...(selected ? { copiedFromId: selected.id } : {}),
        },
      }),
  });

  const updateMutation = useMutation({
    mutationFn: (input: { id: number; name?: string; description?: string; filters?: ReturnType<typeof toFilterList> }) =>
      apiFetch<DatasetRecord>(`/api/datasets/${input.id}`, {
        method: 'PUT',
        body: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.filters ? { filters: input.filters } : {}),
        },
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/datasets/${id}`, { method: 'DELETE' }),
  });

  const data = useApi ? reportQuery.data : local;
  const rows = data?.rows ?? [];
  const reportLoading = useApi ? reportQuery.isFetching : Boolean(!uploaded && fileQuery.isFetching);
  const loadError = useApi ? reportQuery.error : uploaded ? null : fileQuery.error;
  const error = loadError instanceof Error ? loadError.message : datasetsQuery.error instanceof Error ? datasetsQuery.error.message : '';
  const months = rows.length;

  const caption = useMemo(() => {
    const datasetLabel = selected ? `Dataset: ${selected.name}${dirty ? ' (modified)' : ''}` : describeFilters(filters);
    const sourceLabel = uploaded ? `uploaded file ${uploaded.name}` : SOURCES[source];
    const note = local && !useApi && local.report.note ? ` · ${local.report.note}` : '';
    return `${datasetLabel} · Source: ${sourceLabel} · ${months} months · Figures are synthetic.${note}`;
  }, [selected, dirty, filters, uploaded, source, local, useApi, months]);

  function handleSelectDataset(id: number | null) {
    setSelectedId(id);
    setActionError('');
    const match = datasets.find((item) => item.id === id);
    if (match) setFilters(fromFilterList(match.filters));
  }

  function sortBy(field: string) {
    if (orderBy === field) setOrder(order === 'asc' ? 'desc' : 'asc');
    else {
      setOrderBy(field);
      setOrder('desc');
    }
  }

  async function handleSaveDialog(input: { name: string; description: string }) {
    if (dialog === 'create') {
      const created = await createMutation.mutateAsync(input);
      await refreshLists();
      setSelectedId(created.id);
      setToast(`Saved dataset "${created.name}"`);
    } else if (selected) {
      const renamed = await updateMutation.mutateAsync({ id: selected.id, name: input.name, description: input.description });
      await refreshLists();
      setToast(`Renamed to "${renamed.name}"`);
    }
    setDialog(null);
  }

  async function handleUpdate() {
    if (!selected) return;
    setActionError('');
    try {
      await updateMutation.mutateAsync({ id: selected.id, filters: toFilterList(filters) });
      await refreshLists();
      setToast(`Updated "${selected.name}"`);
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Could not update the dataset');
    }
  }

  async function handleDelete() {
    if (!selected) return;
    const name = selected.name;
    setActionError('');
    try {
      await deleteMutation.mutateAsync(selected.id);
      await refreshLists();
      setSelectedId(null);
      setToast(`Deleted "${name}"`);
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Could not delete the dataset');
    }
  }

  async function handleUpload(file: File) {
    setActionError('');
    try {
      const parsed = await parseCsvFile(file);
      setFilters(EMPTY_FILTERS);
      setSelectedId(null);
      setUploaded({ name: file.name, rows: parsed });
    } catch (err) {
      setActionError(`Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handleRefresh() {
    if (uploaded) return;
    if (source === 'api') void reportQuery.refetch();
    else void fileQuery.refetch();
  }

  function handleExport() {
    const csv = Papa.unparse(
      sortRows(rows, orderBy, order).map((row) => ({
        'Month of Transaction': formatMonth(row.month),
        'Total # Claims Denied': row.claimsDenied ?? '',
        'Total Gross Savings': (row.grossSavings ?? 0).toFixed(2),
        Amount: (row.amount ?? 0).toFixed(2),
      })),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'savings-invoice.csv' });
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Breadcrumbs sx={{ mb: 2, fontSize: 14 }}>
        <MuiLink component={Link} href="/" underline="hover" color="inherit">
          Home
        </MuiLink>
        <MuiLink component={Link} href="/explore" underline="hover" color="inherit">
          Explore
        </MuiLink>
        <Typography color="text.primary" sx={{ fontSize: 14 }}>
          Savings Invoice
        </Typography>
      </Breadcrumbs>

      <Box sx={{ border: `1px solid ${brand.border}`, bgcolor: '#fff' }}>
        <Stack direction="row" sx={{ alignItems: 'center', px: { xs: 2, md: 3 }, py: 1.5, borderBottom: `2px solid ${brand.ink}` }} spacing={2}>
          <BrandLogo name="optum" label="Optum" height={30} color={brand.orange} />
          <Divider orientation="vertical" flexItem />
          <BrandLogo name="centene" label={user?.customer || 'Centene'} height={30} color={brand.navy} />
          <Typography variant="h2" component="h1" sx={{ flexGrow: 1, textAlign: 'center', color: '#222', fontSize: { xs: 18, md: 22 }, pr: { md: 18 } }}>
            {data?.report.title || REPORT.title}
          </Typography>
        </Stack>

        <Box sx={{ p: { xs: 2, md: 3 } }}>
          <DatasetBar
            datasets={datasets}
            selected={selected}
            dirty={dirty}
            hasFilters={hasFilters}
            disabled={reportLoading || Boolean(uploaded)}
            onSelect={handleSelectDataset}
            onSaveNew={() => setDialog('create')}
            onUpdate={() => void handleUpdate()}
            onRename={() => setDialog('rename')}
            onDelete={() => void handleDelete()}
          />

          <ReportToolbar
            filters={filters}
            filterOptions={data?.filterOptions ?? { market: [], programType: [] }}
            onFilterChange={(next) => {
              setActionError('');
              setFilters(next);
            }}
            source={source}
            onSourceChange={setSource}
            uploadedName={uploaded?.name}
            onUpload={(file) => void handleUpload(file)}
            onClearUpload={() => setUploaded(null)}
            onRefresh={handleRefresh}
            onExport={handleExport}
            loading={reportLoading}
          />

          {(error || actionError) && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {actionError || error}
            </Alert>
          )}

          <Stack spacing={4} sx={{ mt: 4 }}>
            <KpiCards kpis={data?.kpis ?? []} loading={reportLoading} title={`${months || 24} Months Savings Invoice - Summary`} />
            <SavingsTable
              rows={rows}
              loading={reportLoading}
              title={`${months || 24} Months Savings Invoice - Summary by Month`}
              orderBy={orderBy}
              order={order}
              onSort={sortBy}
            />
          </Stack>

          {!reportLoading && !error && (
            <Typography variant="caption" color="text.secondary" component="p" align="center" sx={{ mt: 2 }}>
              {caption}
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
