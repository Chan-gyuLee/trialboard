import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "@mui/material";
import { loadMocFile, type MocFile } from "./moc-data";
import "./moc-demo.css";

export function MocBadge({ detail = "합성 데이터 · 실제 임상 근거 아님" }: { detail?: string }) {
  return <aside className="moc-badge" aria-label="MOC 데이터 안내"><strong>MOC</strong><span>{detail}</span></aside>;
}
/** Same normal import callbacks and validators as user-selected files; no state injection. */
export function MocFileButton({ name, children, onFile, disabled = false }: {
  name: MocFile; children: string; onFile: (file: File) => Promise<void>; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); }, []);
  async function open() {
    if (disabled || pending.current) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError("");
    const timeout = setTimeout(() => controller.abort(), 15000);
    try { const file = await loadMocFile(name, controller.signal); if (!controller.signal.aborted) await onFile(file); }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "예제를 읽지 못했습니다."); }
    finally { clearTimeout(timeout); if (pending.current === controller) { pending.current = null; setBusy(false); } }
  }
  return <span className="moc-file-action"><Button variant="outlined" disabled={disabled || busy} onClick={() => void open()}>{busy ? "MOC 읽는 중…" : children}</Button>{error && <Alert severity="error">{error}</Alert>}</span>;
}
