import { useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
} from '@mui/material';
import { brand } from '../theme.js';
import { formatValue } from '../format.js';

export default function SavingsTable({ columns, rows, loading, title }) {
  const [orderBy, setOrderBy] = useState('month');
  const [order, setOrder] = useState('desc');

  const sorted = useMemo(() => {
    const dir = order === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a[orderBy];
      const y = b[orderBy];
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
    });
  }, [rows, orderBy, order]);

  const totals = useMemo(
    () =>
      columns.reduce((acc, c) => {
        if (c.format !== 'month') acc[c.field] = rows.reduce((s, r) => s + (r[c.field] || 0), 0);
        return acc;
      }, {}),
    [columns, rows],
  );

  const sortBy = (field) => {
    if (orderBy === field) setOrder(order === 'asc' ? 'desc' : 'asc');
    else {
      setOrderBy(field);
      setOrder(field === 'month' ? 'desc' : 'desc');
    }
  };

  const headSx = {
    bgcolor: brand.gold,
    color: brand.goldInk,
    borderRight: '1px solid rgba(255,255,255,0.5)',
    '& .MuiTableSortLabel-root, & .MuiTableSortLabel-root.Mui-active, & .MuiTableSortLabel-icon': {
      color: `${brand.goldInk} !important`,
    },
  };

  return (
    <Box component="section" aria-label={title}>
      <Typography variant="h3" component="h2" align="center" sx={{ mb: 1.5, fontSize: 18 }}>
        {title}
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ maxWidth: 960, mx: 'auto', maxHeight: 560, borderRadius: 0 }}>
        <Table stickyHeader size="small" aria-label={title}>
          <TableHead>
            <TableRow>
              {columns.map((c) => (
                <TableCell key={c.field} align={c.format === 'month' ? 'left' : 'center'} sx={headSx} sortDirection={orderBy === c.field ? order : false}>
                  <TableSortLabel active={orderBy === c.field} direction={orderBy === c.field ? order : 'desc'} onClick={() => sortBy(c.field)}>
                    {c.label}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {columns.map((c) => (
                      <TableCell key={c.field}>
                        <Skeleton />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : sorted.map((r, i) => (
                  <TableRow key={r.month} hover sx={{ bgcolor: i % 2 ? brand.rowAlt : '#fff' }}>
                    {columns.map((c) => (
                      <TableCell
                        key={c.field}
                        align={c.format === 'month' ? 'left' : 'center'}
                        sx={{
                          fontVariantNumeric: 'tabular-nums',
                          ...(c.format === 'month' && { color: brand.link, fontWeight: 700 }),
                        }}
                      >
                        {formatValue(r[c.field], c.format)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No rows match the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {!loading && rows.length > 0 && (
            <TableFooter sx={{ position: 'sticky', bottom: 0 }}>
              <TableRow sx={{ bgcolor: '#FFF6DD' }}>
                {columns.map((c) => (
                  <TableCell key={c.field} align={c.format === 'month' ? 'left' : 'center'} sx={{ fontWeight: 700, color: '#222', fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums' }}>
                    {c.format === 'month' ? `Total (${rows.length} months)` : formatValue(totals[c.field], c.format)}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </TableContainer>
    </Box>
  );
}
