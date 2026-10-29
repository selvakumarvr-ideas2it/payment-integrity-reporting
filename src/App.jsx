import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Box, CircularProgress, Container, Typography } from '@mui/material';
import AppHeader from './components/AppHeader.jsx';
import HomePage from './pages/HomePage.jsx';
import ExplorePage from './pages/ExplorePage.jsx';
import SavingsInvoicePage from './pages/SavingsInvoicePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { brand } from './theme.js';

// HashRouter keeps deep links working on any static host without server rewrites.
export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </AuthProvider>
  );
}

/** Every page needs a signed-in user; the URL is kept, so a deep link opens after sign-in. */
function Shell() {
  const { status, user, logout } = useAuth();
  if (status === 'checking')
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label="Checking session" />
      </Box>
    );
  if (status !== 'signedIn') return <LoginPage />;

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppHeader userName={user.displayName} subtitle={`${user.username} · ${user.customer}`} onLogout={logout} />
      <Box component="main" sx={{ flexGrow: 1 }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/explore/savings-invoice" element={<SavingsInvoicePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Box>
      <Box component="footer" sx={{ borderTop: `1px solid ${brand.border}`, bgcolor: brand.headerBg }}>
        <Container maxWidth="xl" sx={{ py: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Payment Integrity Reporting · Internal use only
          </Typography>
        </Container>
      </Box>
    </Box>
  );
}
