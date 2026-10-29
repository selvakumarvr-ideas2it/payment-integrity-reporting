import { Link as RouterLink } from 'react-router-dom';
import { Box, Card, CardActionArea, CardContent, Chip, Container, Stack, Typography } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { REPORTS } from '../reports.js';
import { brand } from '../theme.js';

export default function ExplorePage() {
  const groups = REPORTS.reduce((acc, r) => {
    (acc[r.category] ||= []).push(r);
    return acc;
  }, {});

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h1" component="h1" sx={{ fontSize: '1.75rem' }}>
        Explore
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
        Reports available to you
      </Typography>

      {Object.entries(groups).map(([category, reports]) => (
        <Box key={category} sx={{ mb: 4 }}>
          <Typography variant="h3" component="h2" sx={{ mb: 1.5 }}>
            {category}
          </Typography>
          <Stack spacing={1.5}>
            {reports.map((r) => (
              <Card key={r.id} variant="outlined">
                <CardActionArea component={RouterLink} to={r.path}>
                  <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{ flexGrow: 1 }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography sx={{ fontWeight: 700, color: brand.link }}>{r.title}</Typography>
                        <Chip label="Centene" size="small" variant="outlined" />
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {r.description}
                      </Typography>
                    </Box>
                    <ChevronRightIcon color="primary" />
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Stack>
        </Box>
      ))}
    </Container>
  );
}
