import { createTheme } from '@mui/material/styles';

// Palette taken from the Health Plan Manager shell and the Savings Invoice report
// screenshots: Optum orange, deep navy text/buttons, warm off-white header,
// pale-blue hero band and the gold report table headers.
export const brand = {
  orange: '#FF612B',
  navy: '#002677',
  navyDark: '#001D5B',
  ink: '#4B4D4F',
  headerBg: '#FBF9F4',
  heroBg: '#DDF2F7',
  gold: '#F2B411',
  goldInk: '#FFFFFF',
  border: '#D9D9D6',
  rowAlt: '#F6F7F9',
  link: '#196ECF',
};

export const theme = createTheme({
  palette: {
    primary: { main: brand.navy, dark: brand.navyDark, contrastText: '#fff' },
    secondary: { main: brand.orange, contrastText: '#fff' },
    text: { primary: brand.navy, secondary: brand.ink },
    background: { default: '#FFFFFF', paper: '#FFFFFF' },
    divider: brand.border,
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"Optum Sans", "Enterprise Sans VF", "Segoe UI", Arial, sans-serif',
    h1: { fontWeight: 700, fontSize: '2rem' },
    h2: { fontWeight: 700, fontSize: '1.5rem' },
    h3: { fontWeight: 600, fontSize: '1.25rem' },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 999, paddingInline: 18 } },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 700, fontSize: '0.8rem' },
        body: { fontSize: '0.85rem' },
      },
    },
  },
});
