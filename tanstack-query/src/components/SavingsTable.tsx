'use client';

import { useMemo } from 'react';
import { Box, Paper, Skeleton, Table, TableBody, TableCell, TableContainer, TableFooter, TableHead, TableRow, TableSortLabel, Typography } from '@mui/material';
import { COLUMNS } from '@/model';
import type { ReportRow } from '@/model';
import { formatMonth, formatValue } from '@/lib/format';
import { brand } from '@/theme';

export function sortRows(rows: ReportRow[], orderBy: string, order: 'asc' | 'desc'): ReportRow[] {
  const direction = order === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const x = left[orderBy as keyof ReportRow];
    const y = right[orderBy as keyof ReportRow];
    if (typeof x === 'string' && typeof y === 'string') return x.localeCompare(y) * direction;
    return ((Number(x) || 0) - (Number(y) || 0)) * direction;
  });
}

export default function SavingsTable({
  rows,
  loading,
  title,
  orderBy,
  order,
  onSort,
}: {
  rows: ReportRow[];
  loading: boolean;
  title: string;
  orderBy: string;
  order: 'asc' | 'desc';
  onSort: (field: string) => void;
}) {
  const sorted = useMemo(() => sortRows(rows, orderBy, order), [rows, orderBy, order]);

  const totals = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const column of COLUMNS) {
      if (column.format === 'month') continue;
      acc[column.field] = rows.reduce((sum, row) => sum + (Number(row[column.field]) || 0), 0);
    }
    return acc;
  }, [rows]);

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
              {COLUMNS.map((column) => (
                <TableCell key={column.field} align={column.format === 'month' ? 'left' : 'center'} sx={headSx} sortDirection={orderBy === column.field ? order : false}>
                  <TableSortLabel active={orderBy === column.field} direction={orderBy === column.field ? order : 'desc'} onClick={() => onSort(column.field)}>
                    {column.label}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading
              ? Array.from({ length: 8 }).map((_, index) => (
                  <TableRow key={index}>
                    {COLUMNS.map((column) => (
                      <TableCell key={column.field}>
                        <Skeleton />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : sorted.map((row, index) => (
                  <TableRow key={row.month} hover sx={{ bgcolor: index % 2 ? brand.rowAlt : '#fff' }}>
                    {COLUMNS.map((column) => (
                      <TableCell
                        key={column.field}
                        align={column.format === 'month' ? 'left' : 'center'}
                        sx={{
                          fontVariantNumeric: 'tabular-nums',
                          ...(column.format === 'month' && { color: brand.link, fontWeight: 700 }),
                        }}
                      >
                        {column.format === 'month' ? formatMonth(row.month) : formatValue(row[column.field], column.format)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No rows match the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {!loading && rows.length > 0 && (
            <TableFooter sx={{ position: 'sticky', bottom: 0 }}>
              <TableRow sx={{ bgcolor: '#FFF6DD' }}>
                {COLUMNS.map((column) => (
                  <TableCell
                    key={column.field}
                    align={column.format === 'month' ? 'left' : 'center'}
                    sx={{ fontWeight: 700, color: '#222', fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {column.format === 'month' ? `Total (${rows.length} months)` : formatValue(totals[column.field], column.format)}
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
