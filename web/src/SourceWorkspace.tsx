import { Component, lazy, Suspense, useState, useCallback, useEffect, type ReactNode } from "react";
import { Alert, Button, CircularProgress } from "@mui/material";
import { Intake } from "./IntakeWorkspace";
import "./source-workspace.css";
const PdfWorkspace = lazy(() => import("./PdfWorkspace"));
class PdfBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Alert severity="error">PDF 도구를 열지 못했습니다. 내려받지 않은 메모는 새로고침 시 사라집니다. CSV 검토는 계속 사용할 수 있습니다.</Alert> : this.props.children; }
}
export function SourceWorkspace({ onEvidence,onAgentBusy,scoutContext,onResearch,reviewHandoff }: { reviewHandoff?:import('./research-handoff').ResearchHandoff;scoutContext?: import("./evidence-scout").ScoutContext; onEvidence: () => void;onAgentBusy?:(busy:boolean)=>void;onResearch?:(context:import("./evidence-scout").ScoutContext)=>void }) {
  const [mode, setMode] = useState<"csv" | "pdf">("pdf");
  const [pdfVisited, setPdfVisited] = useState(true);
  const [agentBusy,setAgentBusy]=useState(false);
  useEffect(()=>{if(reviewHandoff){setMode('pdf');setPdfVisited(true);}},[reviewHandoff]);
  const reportBusy=useCallback((busy:boolean)=>{setAgentBusy(busy);onAgentBusy?.(busy);},[onAgentBusy]);
  return <><div className="source-mode" role="group" aria-label="입력 자료 종류">
    <Button disabled={agentBusy} aria-pressed={mode === "csv"} variant={mode === "csv" ? "contained" : "outlined"} onClick={() => setMode("csv")}>CSV 집계 검토</Button>
    <Button aria-pressed={mode === "pdf"} variant={mode === "pdf" ? "contained" : "outlined"} onClick={() => { setMode("pdf"); setPdfVisited(true); }}>PDF 원문 확인</Button>
  </div><div hidden={mode !== "csv"}><Intake onEvidence={onEvidence} /></div>
    {pdfVisited && <div hidden={mode !== "pdf"}><PdfBoundary><Suspense fallback={<p role="status"><CircularProgress size={16} /> PDF 도구 준비 중…</p>}><PdfWorkspace reviewHandoff={reviewHandoff} scoutContext={scoutContext} onResearch={onResearch} onAgentBusy={reportBusy}/></Suspense></PdfBoundary></div>}
  </>;
}
