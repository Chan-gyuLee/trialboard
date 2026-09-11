import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    primary: { main: "#195bd7" }, secondary: { main: "#566477" },
    background: { default: "#f7f9fc", paper: "#ffffff" },
    text: { primary: "#202733", secondary: "#626d7c" },
    divider: "#e4e8ee", success: { main: "#237753" }, warning: { main: "#946000" },
  },
  typography: {
    fontFamily: '"Noto Sans KR", Arial, sans-serif',
    button: { textTransform: "none", fontWeight: 600, fontSize: "0.875rem" },
    body1: { fontSize: "1rem" }, body2: { fontSize: "0.875rem" },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { minHeight: 40 } } },
    MuiTextField: { defaultProps: { size: "small", variant: "outlined" } },
    MuiOutlinedInput: { styleOverrides: { root: { background: "#fff", fontSize: "0.875rem" } } },
    MuiChip: { styleOverrides: { root: { fontSize: "0.8125rem", fontWeight: 500 } } },
    MuiAccordion: { defaultProps: { disableGutters: true, elevation: 0 },
      styleOverrides: { root: { background: "transparent", "&:before": { display: "none" } } } },
    MuiTab: { styleOverrides: { root: { textTransform: "none", fontSize: "0.875rem" } } },
  },
});
