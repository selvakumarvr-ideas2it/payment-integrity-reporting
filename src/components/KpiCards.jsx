import { Box, Skeleton, Typography } from '@mui/material';
import { brand } from '../theme.js';
import { formatValue } from '../format.js';

/** KPI strip styled like the Tableau summary: gold header cells over large values. */
export default function KpiCards({ kpis, loading, title }) {
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
        {items.map((k, i) => (
          <Box key={k.key || i} sx={{ borderLeft: { sm: i ? `1px solid ${brand.border}` : 'none' }, borderTop: { xs: i ? `1px solid ${brand.border}` : 'none', sm: 'none' } }}>
            <Box sx={{ bgcolor: brand.gold, color: brand.goldInk, py: 1, px: 1.5, textAlign: 'center', fontWeight: 700, fontSize: 13 }}>
              {loading ? <Skeleton width="60%" sx={{ mx: 'auto', bgcolor: 'rgba(255,255,255,0.4)' }} /> : k.label}
            </Box>
            <Box sx={{ py: 2.5, textAlign: 'center' }}>
              {loading ? (
                <Skeleton width="70%" height={36} sx={{ mx: 'auto' }} />
              ) : (
                <Typography sx={{ fontSize: { xs: 22, md: 24 }, fontWeight: 500, color: '#222', fontVariantNumeric: 'tabular-nums' }}>
                  {formatValue(k.value, k.format)}
                </Typography>
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
