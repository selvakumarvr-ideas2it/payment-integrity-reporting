'use client';

import Link from 'next/link';
import { Box, Card, CardActionArea, CardContent, Chip, Container, Stack, Typography } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { REPORT } from '@/model';
import { useAuth } from '@/auth/AuthContext';
import { brand } from '@/theme';

export default function ExplorePage() {
  const { user } = useAuth();
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h1" component="h1" sx={{ fontSize: '1.75rem' }}>
        Explore
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
        Reports available to you
      </Typography>

      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" component="h2" sx={{ mb: 1.5 }}>
          {REPORT.category}
        </Typography>
        <Stack spacing={1.5}>
          <Card variant="outlined">
            <CardActionArea component={Link} href={REPORT.path}>
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ flexGrow: 1 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography sx={{ fontWeight: 700, color: brand.link }}>{REPORT.title}</Typography>
                    <Chip label={user?.customer || 'Centene'} size="small" variant="outlined" />
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {REPORT.description}
                  </Typography>
                </Box>
                <ChevronRightIcon color="primary" />
              </CardContent>
            </CardActionArea>
          </Card>
        </Stack>
      </Box>
    </Container>
  );
}
