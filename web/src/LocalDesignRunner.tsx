import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, FormControlLabel, TextField } from "@mui/material";
import { Play, FileInput } from "lucide-react";
import { digest, strictJson, type FieldReview } from "./field-review";
import type { PdfSource } from "./pdf-contract";
import { briefFromDraft, type DesignDraft } from "./design-brief";
import { executeLocalDesign, localDesignOrigin } from "./design-client";
import { readRecritique } from "./recritique-result";
import { reviewKey, RESULT_BYTES } from "./revalidation-result";
import type { DesignResult } from "./design-result";
import { MocFileButton } from "./MocDemo";
import { isMocSource } from "./moc-data";

export default function LocalDesignRunner({ draft, review, source, pdf, locked, hasDraft, onBusy, onResult, confirmReplace, suppliedAgentRaw }: {
  draft: DesignDraft; review: FieldReview; source: PdfSource; pdf: File | null; locked: boolean; hasDraft: boolean;
  onBusy: (busy: boolean) => void; onResult: (result: DesignResult) => void;
  confirmReplace: () => boolean;
  suppliedAgentRaw?: string|null;
}) {
  const [agent, setAgent] = useState<{ raw: string; name: string } | null>(null);
  const [ai, setAi] = useState<{ raw: string; name: string; key: string } | null>(null);
  const [context, setContext] = useState({ asset: "", indication: "", study: "" });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [running, setRunning] = useState(false);
  const pending = useRef<AbortController | null>(null), ticket = useRef(0);
  const key = reviewKey(review, source), draftKey = JSON.stringify(draft), contextKey = JSON.stringify(context);
  const local = localDesignOrigin(window.location.origin);
  useEffect(() => {
    ticket.current++; pending.current?.abort(); pending.current = null; setRunning(false); setConsent(false);
    return () => { ticket.current++; pending.current?.abort(); };
  }, [key, draftKey, contextKey, pdf, hasDraft]);
  // Parent disables all editable inputs during work; source switches still cancel stale responses.
  useEffect(() => { onBusy(running); }, [running, onBusy]);
  const effectiveAgent = suppliedAgentRaw ? {raw:suppliedAgentRaw,name:"현재 검토를 시작한 원본 실행 · 자동 연결"} : agent;
  const agentCurrent = !!effectiveAgent && review.origin.kind === "imported_agent_report";
  const aiCurrent = !ai || ai.key === key;
  async function attach(file: File | undefined, kind: "agent" | "ai") {
    if (!file || locked) return;
    const id = ++ticket.current; setRunning(true); setError(""); setConsent(false);
    try {
      if (file.size > RESULT_BYTES) throw new Error("결과 JSON은 8 MiB 이하만 지원합니다.");
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (kind === "agent") {
        strictJson(raw, RESULT_BYTES, 500000);
        if (await digest(raw) !== review.origin.reportDigest) throw new Error("최초 에이전트 결과의 파일 hash가 일치하지 않습니다.");
        if (id === ticket.current) setAgent({ raw, name: file.name });
      } else {
        const r = await readRecritique(raw, review, source);
        if (r.status !== "COMPLETED") throw new Error("완료된 현재 AI 결과만 연결할 수 있습니다.");
        if (id === ticket.current) setAi({ raw, name: file.name, key });
      }
    } catch (e) { if (id === ticket.current) setError(e instanceof Error ? e.message : "파일을 읽지 못했습니다."); }
    finally { if (id === ticket.current) setRunning(false); }
  }
  async function run() {
    if (locked || !pdf || !consent || !aiCurrent) return;
    if (!confirmReplace()) return;
    const controller = new AbortController(), id = ++ticket.current; pending.current = controller;
    setRunning(true); setError(""); setNotice("");
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const brief = await briefFromDraft(draft, review, source);
      const result = await executeLocalDesign({ origin: window.location.origin, consent, brief, review, source, pdf, signal: controller.signal,
        attachments: { agentRaw: agentCurrent ? effectiveAgent!.raw : null, aiRaw: ai?.raw ?? null,
          context: review.origin.kind === "manual" ? { ...context, question: draft.question } : null } });
      if (id !== ticket.current || controller.signal.aborted) return;
      onResult(result);
    } catch (e) {
      if (id === ticket.current) setError(controller.signal.aborted ? "계산 대기를 중단했습니다. 서버 계산은 잠시 계속될 수 있으나 결과를 채택하거나 저장하지 않습니다." : e instanceof Error ? e.message : "로컬 계산에 실패했습니다.");
    } finally { clearTimeout(timer); if (id === ticket.current) { pending.current = null; setRunning(false); } }
  }
  return <div className="design-card">
    <h4>내 컴퓨터에서 바로 계산 · 선택 기능</h4>
    {!local && <Alert severity="info">이 기능은 localhost:5173 개발 화면 전용입니다. 배포된 사이트에서는 자료를 전송하거나 로컬 서비스에 연결하지 않습니다. JSON 내보내기·가져오기를 이용하세요.</Alert>}
    {local && <><p className="design-help">서비스를 <code>uv run python -m trialboard.api --enable-designs</code>로 시작하세요. 기본 실행은 PDF 계산이 꺼져 있습니다. 이 연결은 사용자 인증이나 운영용 보안 경계가 아닙니다.</p>
      {review.origin.kind === "imported_agent_report" ? <div><Button component="label" startIcon={<FileInput size={16} />} disabled={locked || !!suppliedAgentRaw}>최초 에이전트 결과 연결<input className="file-input" type="file" accept=".json" onChange={e => { void attach(e.target.files?.[0], "agent"); e.target.value = ""; }} /></Button><p className="design-help">{effectiveAgent?.name ?? "원래 추출에 사용한 결과 파일 필요 · 복구 JSON과 다름"}</p></div>
        : <><p className="design-help">직접 추가한 관측값의 문맥을 지정하세요. 원문과 다르면 재검증에서 제외됩니다.</p>{([['asset', '약물'], ['indication', '적응증'], ['study', '시험']] as const).map(([key, label]) => <TextField key={key} size="small" label={label} value={context[key]} disabled={locked} onChange={e => setContext({ ...context, [key]: e.target.value })} slotProps={{ htmlInput: { maxLength: 2000 } }} />)}</>}
      <div className="design-toolbar"><Button component="label" startIcon={<FileInput size={16} />} disabled={locked}>현재 AI 재검토 결과 연결 · 선택<input className="file-input" type="file" accept=".json" onChange={e => { void attach(e.target.files?.[0], "ai"); e.target.value = ""; }} /></Button>{ai && <Button color="warning" disabled={locked} onClick={() => { setAi(null); setConsent(false); }}>AI 결과 연결 해제</Button>}</div>
      <p className="design-help">{ai ? `${ai.name} · ${aiCurrent ? "현재 검토 버전" : "과거 버전 · 새 결과를 연결하거나 명시적으로 해제해야 실행 가능"}` : "AI 결과 미제공. ‘필드 검토’에서 열어 본 AI 파일도 여기 연결하지 않으면 포함되지 않습니다."}</p>
      {isMocSource(source) && review.origin.kind === "imported_agent_report" && <MocFileButton name="original-agent.json" disabled={locked} onFile={file => attach(file, "agent")}>MOC 원본 추출 연결</MocFileButton>}
      <FormControlLabel control={<Checkbox checked={consent} disabled={locked} onChange={e => setConsent(e.target.checked)} />} label="공개·사용 허가된 PDF와 검토·가정·연결한 결과를 내 컴퓨터의 로컬 Python 서비스로 전송합니다. 외부 AI 호출·영구 저장은 없음을 이해했습니다." />
      <div className="design-toolbar"><Button variant="contained" startIcon={<Play size={16} />} disabled={locked || !consent || !pdf || !aiCurrent || (review.origin.kind === "imported_agent_report" && !agentCurrent)} onClick={() => void run()}>현재 가정으로 로컬 계산</Button>{running && <Button onClick={() => { ticket.current++; pending.current?.abort(); pending.current = null; setRunning(false); setNotice("작업 대기를 취소했습니다. 결과를 채택하지 않습니다."); }}>대기 취소</Button>}</div>
      <div aria-live="polite">{running && <p role="status">파일 검사 또는 로컬 계산 중…</p>}{error && <Alert severity="error">{error}</Alert>}{notice && <Alert severity="info">{notice}</Alert>}</div>
    </>}
  </div>;
}
