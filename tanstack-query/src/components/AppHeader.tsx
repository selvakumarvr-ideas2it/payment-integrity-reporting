'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppBar, Avatar, Box, Divider, IconButton, Link as MuiLink, Menu, MenuItem, Stack, Toolbar, Typography } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import BrandLogo from '@/components/BrandLogo';
import { brand } from '@/theme';

const NAV = [
  { href: '/', label: 'Home', match: (path: string) => path === '/' },
  { href: '/explore', label: 'Explore', match: (path: string) => path.startsWith('/explore') },
];

export default function AppHeader({
  userName,
  subtitle,
  onLogout,
}: {
  userName: string;
  subtitle?: string;
  onLogout: () => void;
}) {
  const pathname = usePathname();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const initials = userName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <AppBar position="sticky" elevation={0} sx={{ bgcolor: brand.headerBg, color: brand.navy, borderBottom: `1px solid ${brand.border}` }}>
      <Toolbar sx={{ gap: { xs: 1.5, md: 2 }, minHeight: { xs: 64, md: 72 }, px: { xs: 2, md: 4 } }}>
        <Box sx={{ flexShrink: 0 }}>
          <BrandLogo name="optum" label="Optum" height={32} color={brand.orange} />
        </Box>
        <Divider orientation="vertical" flexItem sx={{ my: 2, borderColor: brand.border }} />
        <Typography noWrap sx={{ fontSize: { xs: 15, md: 20 }, fontWeight: 500, minWidth: 0, flexShrink: 1 }}>
          Payment Integrity Reporting
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <MuiLink component="button" type="button" underline="hover" sx={{ display: { xs: 'none', sm: 'inline' }, fontSize: 14, color: brand.navy }}>
          Get Help
        </MuiLink>
        <Divider orientation="vertical" flexItem sx={{ my: 2.5, display: { xs: 'none', sm: 'block' } }} />
        <Typography sx={{ display: { xs: 'none', md: 'block' }, fontSize: 14 }}>Welcome, {userName}</Typography>
        <IconButton onClick={(event) => setMenuAnchor(event.currentTarget)} sx={{ p: 0, flexShrink: 0 }} aria-label="Account menu" aria-haspopup="menu">
          <Avatar sx={{ width: 32, height: 32, bgcolor: brand.navy, fontSize: 13 }}>{initials}</Avatar>
        </IconButton>
        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={() => setMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <MenuItem disabled sx={{ opacity: '1 !important', flexDirection: 'column', alignItems: 'flex-start' }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{userName}</Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </MenuItem>
          <Divider />
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              onLogout();
            }}
          >
            <LogoutIcon fontSize="small" sx={{ mr: 1.5 }} />
            Sign out
          </MenuItem>
        </Menu>
      </Toolbar>
      <Stack direction="row" spacing={3} component="nav" aria-label="Main" sx={{ px: { xs: 2, md: 4 }, pb: 1 }}>
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <MuiLink
              key={item.href}
              component={Link}
              href={item.href}
              underline="none"
              aria-current={active ? 'page' : undefined}
              sx={{
                fontSize: 14,
                color: brand.navy,
                fontWeight: active ? 700 : 400,
                pb: 0.5,
                borderBottom: `2px solid ${active ? brand.navy : 'transparent'}`,
                '&:hover': { borderBottomColor: brand.border },
              }}
            >
              {item.label}
            </MuiLink>
          );
        })}
      </Stack>
    </AppBar>
  );
}
