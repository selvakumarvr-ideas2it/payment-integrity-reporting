import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Container, Stack, TextField, Typography } from '@mui/material';
import BrandLogo from '../components/BrandLogo.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { config } from '../config.js';
import { brand } from '../theme.js';

export default function LoginPage() {
  const { login, notice } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message);
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
                  {config.appName}
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
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
                fullWidth
              />
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                fullWidth
              />
              <Button type="submit" variant="contained" size="large" disabled={busy || !username.trim() || !password}>
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
              {import.meta.env.DEV && (
                <Typography variant="caption" color="text.secondary">
                  Local demo users: <b>analyst</b> or <b>reviewer</b>, password <b>Password123!</b> (set by npm run db:setup).
                </Typography>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
