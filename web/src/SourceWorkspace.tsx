import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { Alert, Button, CircularProgress } from "@mui/material";
import { Intake } from "./IntakeWorkspace";
import "./source-workspace.css";
const PdfWorkspace = lazy(() => import("./PdfWorkspace"));
class PdfBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Alert severity="error">PDF 도구를 열지 못했습니다. 내려받지 않은 메모는 새로고침 시 사라집니다. CSV 검토는 계속 사용할 수 있습니다.</Alert> : this.props.children; }
}
export function SourceWorkspace({ onEvidence }: { onEvidence: () => void }) {
  const [mode, setMode] = useState<"csv" | "pdf">("csv");
  const [pdfVisited, setPdfVisited] = useState(false);
  return <><div className="source-mode" role="group" aria-label="입력 자료 종류">
    <Button aria-pressed={mode === "csv"} variant={mode === "csv" ? "contained" : "outlined"} onClick={() => setMode("csv")}>CSV 집계 검토</Button>
    <Button aria-pressed={mode === "pdf"} variant={mode === "pdf" ? "contained" : "outlined"} onClick={() => { setMode("pdf"); setPdfVisited(true); }}>PDF 원문 확인</Button>
  </div><div hidden={mode !== "csv"}><Intake onEvidence={onEvidence} /></div>
    {pdfVisited && <div hidden={mode !== "pdf"}><PdfBoundary><Suspense fallback={<p role="status"><CircularProgress size={16} /> PDF 도구 준비 중…</p>}><PdfWorkspace /></Suspense></PdfBoundary></div>}
  </>;
}
