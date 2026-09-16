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
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { minHeight: 40, '@media (max-width:600px)': {minHeight:44} } } },
    MuiAlert: { styleOverrides: {
      root: {alignItems:'flex-start',columnGap:12,rowGap:12,padding:'12px 16px',fontSize:'0.875rem',lineHeight:1.7,flexWrap:'wrap'},
      icon: {marginRight:0,padding:'3px 0'},
      message: {flex:'1 1 160px',minWidth:0,padding:0,overflowWrap:'anywhere'},
      action: {marginRight:0,marginLeft:0,padding:0,alignItems:'center',gap:8,'@media (max-width:600px)':{flexBasis:'100%',paddingLeft:34,flexWrap:'wrap'}},
    } },
    MuiFormControlLabel: { styleOverrides: {root:{marginLeft:0,marginRight:0,alignItems:'flex-start',gap:4},label:{paddingTop:8,fontSize:'0.875rem',lineHeight:1.7}} },
    MuiDialogActions: {styleOverrides:{root:{padding:'16px 24px',gap:12,flexWrap:'wrap','& > :not(style) ~ :not(style)':{marginLeft:0}}}},
    MuiDialogContent: {styleOverrides:{root:{'& > p + p':{marginTop:12},'& > p + .MuiAlert-root':{marginTop:16}}}},
    MuiTextField: { defaultProps: { size: "small", variant: "outlined" } },
    MuiOutlinedInput: { styleOverrides: { root: { background: "#fff", fontSize: "0.875rem" } } },
    MuiChip: { styleOverrides: { root: { fontSize: "0.8125rem", fontWeight: 500 } } },
    MuiAccordion: { defaultProps: { disableGutters: true, elevation: 0 },
      styleOverrides: { root: { background: "transparent", "&:before": { display: "none" } } } },
    MuiTab: { styleOverrides: { root: { textTransform: "none", fontSize: "0.875rem" } } },
  },
});
