'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Box, Button, Card, CardContent, Container, Stack, TextField, Typography } from '@mui/material';
import BrandLogo from '@/components/BrandLogo';
import { useAuth } from '@/auth/AuthContext';
import { brand } from '@/theme';

function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/login')) return '/';
  return value;
}

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const notice = searchParams.get('notice') === 'expired' ? 'Your session expired' : '';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username.trim(), password);
      router.push(safeNext(searchParams.get('next')));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid username or password');
      setBusy(false);
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: brand.heroBg, display: 'flex', alignItems: 'center', py: 4 }}>
      <Container maxWidth="xs">
        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
            <Stack spacing={2.5} component="form" onSubmit={handleSubmit} noValidate>
              <BrandLogo name="optum" label="Optum" height={32} color={brand.orange} />
              <Box>
                <Typography variant="h2" component="h1" sx={{ fontSize: 22 }}>
                  Payment Integrity Reporting
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Sign in to view reports and your saved datasets.
                </Typography>
              </Box>
              {notice && !error && <Alert severity="info">{notice}</Alert>}
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                label="Username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                required
                fullWidth
              />
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                fullWidth
              />
              <Button type="submit" variant="contained" size="large" disabled={busy || !username.trim() || !password}>
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
              {process.env.NODE_ENV === 'development' && (
                <Typography variant="caption" color="text.secondary">
                  Local demo users: <b>analyst</b> or <b>reviewer</b>, password <b>Password123!</b>
                </Typography>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
