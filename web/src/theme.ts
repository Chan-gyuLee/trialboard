import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    primary: { main: "#245bea" }, secondary: { main: "#62718b" },
    background: { default: "#f6f8fc", paper: "#ffffff" },
    text: { primary: "#172a48", secondary: "#62718b" },
    divider: "#e3e9f2", success: { main: "#147966" }, warning: { main: "#946000" },
  },
  typography: {
    fontFamily: '"DM Sans", "Noto Sans KR", Arial, sans-serif',
    button: { textTransform: "none", fontWeight: 600, fontSize: "0.875rem" },
    body1: { fontSize: "1rem" }, body2: { fontSize: "0.875rem" },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { minHeight: 44, paddingInline:18, borderRadius:10, gap:4, lineHeight:1.6 }, outlined:{borderColor:'#d4dfef',backgroundColor:'#fff'}, contained:{boxShadow:'0 3px 8px #245bea18'} } },
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
    MuiOutlinedInput: { styleOverrides: { root: { background: "#fff", fontSize: "0.875rem", minHeight:44 }, notchedOutline:{borderColor:'#d7e0ed'} } },
    MuiChip: { styleOverrides: { root: { fontSize: "0.8125rem", fontWeight: 500 } } },
    MuiAccordion: { defaultProps: { disableGutters: true, elevation: 0 },
      styleOverrides: { root: { background: "transparent", "&:before": { display: "none" } } } },
    MuiTab: { styleOverrides: { root: { textTransform: "none", fontSize: "0.875rem", minHeight:50, fontWeight:500 } } },
    MuiTabs: { styleOverrides: { indicator: { height:3, borderRadius:'3px 3px 0 0' } } },
  },
});
