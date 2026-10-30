'use client';

import Link from 'next/link';
import { Box, Button, Card, CardActionArea, CardContent, Container, Stack, Typography } from '@mui/material';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import { REPORT } from '@/model';
import { brand } from '@/theme';

function HeroArt() {
  return (
    <Box component="svg" viewBox="0 0 260 150" aria-hidden sx={{ width: { xs: 180, md: 260 }, height: 'auto' }}>
      <rect x="10" y="20" width="190" height="110" rx="6" fill="#fff" opacity="0.7" />
      {[40, 60, 80, 100].map((y) => (
        <line key={y} x1="20" x2="190" y1={y} y2={y} stroke={brand.border} strokeDasharray="3 4" />
      ))}
      <path d="M20 115 L55 95 L85 100 L115 70 L145 78 L175 45 L190 50 L190 120 L20 120 Z" fill={brand.gold} opacity="0.35" />
      <path d="M20 115 L55 95 L85 100 L115 70 L145 78 L175 45 L190 50" fill="none" stroke={brand.orange} strokeWidth="3" />
      <circle cx="205" cy="70" r="32" fill="none" stroke={brand.navy} strokeWidth="9" />
      <line x1="228" y1="93" x2="252" y2="122" stroke={brand.navy} strokeWidth="12" strokeLinecap="round" />
      <text x="190" y="30" fontSize="16" fontWeight="700" fill={brand.navy}>
        $
      </text>
    </Box>
  );
}

export default function HomePage() {
  return (
    <>
      <Box sx={{ bgcolor: brand.heroBg }}>
        <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="h1" component="h1" sx={{ fontSize: { xs: '1.6rem', md: '2rem' } }}>
                Welcome to Payment Integrity Reporting
              </Typography>
              <Typography sx={{ mt: 1.5, color: brand.navy, fontSize: 17 }}>Your savings, your analytics, in one place</Typography>
              <Button component={Link} href="/explore" variant="contained" sx={{ mt: 3 }}>
                View My Reports
              </Button>
            </Box>
            <HeroArt />
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: 5 }}>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Featured report
        </Typography>
        <Card variant="outlined" sx={{ maxWidth: 520 }}>
          <CardActionArea component={Link} href={REPORT.path}>
            <CardContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
                <AssessmentOutlinedIcon sx={{ color: brand.orange, fontSize: 36 }} />
                <Box>
                  <Typography variant="h3">{REPORT.title}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {REPORT.description}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>
      </Container>
    </>
  );
}
