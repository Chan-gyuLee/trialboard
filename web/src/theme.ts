import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    primary: { main: "#2855e8" }, secondary: { main: "#59677f" },
    background: { default: "#f5f7fc", paper: "#ffffff" },
    text: { primary: "#15223b", secondary: "#59677f" },
    divider: "#dbe2ef", success: { main: "#147966" }, warning: { main: "#946000" },
  },
  typography: {
    fontFamily: '"DM Sans", "Noto Sans KR", Arial, sans-serif',
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
    MuiCheckbox: {styleOverrides:{root:{width:44,height:44,padding:11,flexShrink:0}}},
    MuiFormControlLabel: { styleOverrides: {root:{marginLeft:0,marginRight:0,alignItems:'flex-start',gap:8},label:{paddingTop:10,paddingBottom:10,fontSize:'0.875rem',lineHeight:'24px'}} },
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
