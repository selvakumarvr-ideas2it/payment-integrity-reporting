'use client';

import { Box, Skeleton, Typography } from '@mui/material';
import { formatValue } from '@/lib/format';
import { brand } from '@/theme';

export default function KpiCards({
  kpis,
  loading,
  title,
}: {
  kpis: { key: string; label: string; format: string; value: number }[];
  loading: boolean;
  title: string;
}) {
  const items = loading ? [{}, {}, {}] : kpis;
  return (
    <Box component="section" aria-label={title}>
      <Typography variant="h3" component="h2" align="center" sx={{ mb: 1.5, fontSize: 18 }}>
        {title}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: `repeat(${Math.max(items.length, 1)}, 1fr)` },
          border: `1px solid ${brand.border}`,
          maxWidth: 760,
          mx: 'auto',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >
        {items.map((kpi, index) => (
          <Box
            key={'key' in kpi ? kpi.key : index}
            sx={{
              borderLeft: { sm: index ? `1px solid ${brand.border}` : 'none' },
              borderTop: { xs: index ? `1px solid ${brand.border}` : 'none', sm: 'none' },
            }}
          >
            <Box sx={{ bgcolor: brand.gold, color: brand.goldInk, py: 1, px: 1.5, textAlign: 'center', fontWeight: 700, fontSize: 13 }}>
              {loading || !('label' in kpi) ? <Skeleton width="60%" sx={{ mx: 'auto', bgcolor: 'rgba(255,255,255,0.4)' }} /> : kpi.label}
            </Box>
            <Box sx={{ py: 2.5, textAlign: 'center' }}>
              {loading || !('value' in kpi) ? (
                <Skeleton width="70%" height={36} sx={{ mx: 'auto' }} />
              ) : (
                <Typography sx={{ fontSize: { xs: 22, md: 24 }, fontWeight: 500, color: '#222', fontVariantNumeric: 'tabular-nums' }}>
                  {formatValue(kpi.value, kpi.format)}
                </Typography>
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
