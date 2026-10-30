'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Box, CircularProgress, Container, Typography } from '@mui/material';
import AppHeader from '@/components/AppHeader';
import { useAuth } from '@/auth/AuthContext';
import { brand } from '@/theme';

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, user, logout } = useAuth();

  if (pathname === '/login') return children;

  if (status === 'checking' || (status === 'signedIn' && !user)) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label="Checking session" />
      </Box>
    );
  }

  if (status !== 'signedIn' || !user) return null;

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppHeader
        userName={user.displayName}
        subtitle={`${user.username} · ${user.customer}`}
        onLogout={() => {
          void logout().then(() => {
            router.push('/login');
            router.refresh();
          });
        }}
      />
      <Box component="main" sx={{ flexGrow: 1 }}>
        {children}
      </Box>
      <Box component="footer" sx={{ borderTop: `1px solid ${brand.border}`, bgcolor: brand.headerBg }}>
        <Container maxWidth="xl" sx={{ py: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Payment Integrity Reporting · Internal use only · Figures are synthetic
          </Typography>
        </Container>
      </Box>
    </Box>
  );
}
