import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Breadcrumbs,
  CircularProgress,
  Container,
  Divider,
  IconButton,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import BrandLogo from '../components/BrandLogo.jsx';
import { FilterSelect } from '../components/ReportToolbar.jsx';
import { loadSavingsDetails } from '../data/detailsService.js';
import { formatMonth } from '../data/schema.js';
import { formatValue } from '../format.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { config } from '../config.js';
import { brand } from '../theme.js';

const GOLD = '#F0B414';

const COLUMNS = [
  { key: 'transactionDate', label: 'Transaction Date' },
  { key: 'note', label: 'Note' },
  { key: 'claimId', label: 'Claim ID' },
  { key: 'lineNumber', label: 'Line Number' },
  { key: 'creditClaimId', label: 'Credit Claim ID' },
  { key: 'market', label: 'Market' },
  { key: 'productType', label: 'Product Type' },
  { key: 'lob', label: 'LOB' },
  { key: 'lineServiceToDt', label: 'Line Service To Dt' },
  { key: 'originalAnalyticIdentifier', label: 'Original Analytic Identifier' },
  { key: 'grossSavings', label: 'Gross Savings', currency: true },
  { key: 'amount', label: 'Amount', currency: true },
];

const distinct = (values) => [...new Set(values.filter(Boolean))].sort();

export default function SavingsInvoiceDetailsPage() {
  const { month } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const source = state?.source || config.defaultSource;

  const [market, setMarket] = useState(state?.filters?.market ?? []);
  const [programType, setProgramType] = useState(state?.filters?.programType ?? []);
  const [allRows, setAllRows] = useState([]);
  const [filterOptions, setFilterOptions] = useState({ market: [], programType: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    loadSavingsDetails({
      month,
      source,
      filters: { market, programType },
      user,
      uploadedRows: state?.uploadedRows,
    })
      .then((d) => {
        if (cancelled) return;
        setAllRows(d.rows);
        if (d.filterOptions?.market?.length || d.filterOptions?.programType?.length) {
          setFilterOptions({
            market: d.filterOptions.market ?? [],
            programType: d.filterOptions.programType ?? [],
          });
        }
      })
      .catch((e) => !cancelled && setError(e.message || String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [month, source, market, programType, user, state?.uploadedRows]);

  const marketOptions = useMemo(
    () => distinct([...(filterOptions.market.length ? filterOptions.market : allRows.map((r) => r.market)), ...market]),
    [allRows, filterOptions.market, market],
  );
  const programOptions = useMemo(
    () =>
      distinct([
        ...(filterOptions.programType.length ? filterOptions.programType : allRows.map((r) => r.productType)),
        ...programType,
      ]),
    [allRows, filterOptions.programType, programType],
  );
  const totals = useMemo(
    () => ({
      gross: allRows.reduce((s, r) => s + r.grossSavings, 0),
      amount: allRows.reduce((s, r) => s + r.amount, 0),
    }),
    [allRows],
  );
  const pageRows = allRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  let monthLabel = month;
  try {
    monthLabel = formatMonth(month) || month;
  } catch {
    /* keep raw */
  }

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Breadcrumbs sx={{ mb: 2, fontSize: 14 }}>
        <Link component={RouterLink} to="/" underline="hover" color="inherit">
          Home
        </Link>
        <Link component={RouterLink} to="/explore" underline="hover" color="inherit">
          Explore
        </Link>
        <Link component={RouterLink} to="/explore/savings-invoice" underline="hover" color="inherit">
          Savings Invoice
        </Link>
        <Typography color="text.primary" sx={{ fontSize: 14 }}>
          Details
        </Typography>
      </Breadcrumbs>

      <Box sx={{ border: `1px solid ${brand.border}`, bgcolor: '#fff' }}>
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: 'center', px: { xs: 2, md: 3 }, py: 1.5, borderBottom: `2px solid ${brand.ink}` }}
        >
          <IconButton onClick={() => navigate(-1)} aria-label="Back">
            <ArrowBackIcon />
          </IconButton>
          <BrandLogo name="optum" label="Optum" height={30} color={brand.orange} />
          <Divider orientation="vertical" flexItem />
          <BrandLogo name="centene" label={user?.customer || config.customerName} height={30} color={brand.navy} />
          <Typography
            variant="h2"
            component="h1"
            sx={{ flexGrow: 1, textAlign: 'center', color: '#222', fontSize: { xs: 18, md: 22 }, pr: { md: 18 } }}
          >
            Savings Invoice - Details ({monthLabel})
          </Typography>
        </Stack>

        <Box sx={{ p: { xs: 2, md: 3 } }}>
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <FilterSelect
              id="market"
              label="Market"
              value={market}
              options={marketOptions}
              onChange={(v) => {
                setMarket(v);
                setPage(0);
              }}
            />
            <FilterSelect
              id="programType"
              label="Program Type"
              value={programType}
              options={programOptions}
              onChange={(v) => {
                setProgramType(v);
                setPage(0);
              }}
            />
          </Stack>

          {!loading && !error && (
            <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
              {allRows.length.toLocaleString()} claims · Gross Savings {formatValue(totals.gross, 'currency')} · Amount{' '}
              {formatValue(totals.amount, 'currency')}
            </Typography>
          )}

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {loading ? (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Paper variant="outlined">
              <TableContainer sx={{ maxHeight: '60vh' }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      {COLUMNS.map((c) => (
                        <TableCell
                          key={c.key}
                          sx={{ bgcolor: GOLD, color: '#fff', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' }}
                        >
                          {c.label}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pageRows.map((r, i) => (
                      <TableRow key={`${r.claimId}-${i}`} sx={{ '&:nth-of-type(even)': { bgcolor: '#f7f7f7' } }}>
                        {COLUMNS.map((c) => (
                          <TableCell key={c.key} sx={{ textAlign: 'center', fontSize: 12, whiteSpace: 'nowrap' }}>
                            {c.currency ? formatValue(r[c.key], 'currency') : r[c.key] ?? 'Null'}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    {allRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={COLUMNS.length} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                          No rows match the current filters.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={allRows.length}
                page={page}
                onPageChange={(_, p) => setPage(p)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(e) => {
                  setRowsPerPage(Number(e.target.value));
                  setPage(0);
                }}
                rowsPerPageOptions={[25, 50, 100, 250]}
              />
            </Paper>
          )}
        </Box>
      </Box>
    </Container>
  );
}
