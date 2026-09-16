import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Chip, CircularProgress, FormControlLabel, MenuItem, TextField } from "@mui/material";
import { Check, Play, Square } from "lucide-react";
import { STAGES, type AgentRecord } from "./agent-briefing";
import { isLocalDemo, runLiveAgent, type LiveCase, type LiveProgress } from "./agent-live";
import { checkDemoReadiness, elapsedSeconds, interruptionMessage, readDemoCapability, type ReadinessCheck } from "./demo-readiness";
import { LiveWorkbench } from "./LiveWorkbench";

export function LiveAgentRunner({ onResult, onBusy, showLastRun, onReplay }: { onResult: (r: AgentRecord) => void; onBusy: (busy: boolean) => void; showLastRun: boolean; onReplay: () => void }) {
  const [chosen, setChosen] = useState<LiveCase>("public");
  const [consent, setConsent] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [probe, setProbe] = useState(0);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<LiveProgress[]>([]);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [receipt, setReceipt] = useState("");
  const [checks, setChecks] = useState<ReadinessCheck[]>([]);
  const [checking, setChecking] = useState(false);
  const checkController = useRef<AbortController | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const local = isLocalDemo(window.location);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); checkController.current?.abort(); }; }, []);
  useEffect(() => {
    if (!local) return;
    const c = new AbortController(), timer = setTimeout(() => c.abort(), 4000);
    setEnabled(false);
    fetch("/api/agent-demo/capabilities", { signal: c.signal }).then(async response => response.ok ? response.json() : null).then(value => { const caps = readDemoCapability(value); if (!c.signal.aborted) setEnabled(caps.enabled); }).catch(() => { if (!c.signal.aborted) setEnabled(false); }).finally(() => clearTimeout(timer));
    return () => { c.abort(); clearTimeout(timer); };
  }, [local, probe]);
  async function checkReadiness() {
    if (checkController.current || busy) return;
    const c = new AbortController(); checkController.current = c; setChecking(true); setChecks([]);
    const timer = setTimeout(() => c.abort(), 5000);
    try { const results = await checkDemoReadiness(c.signal); if (mounted.current) { setChecks(results); setEnabled(results[0].ok); } }
    finally { clearTimeout(timer); checkController.current = null; if (mounted.current) setChecking(false); }
  }
  async function run() {
    if (!consent || !enabled || !local || controller.current || checking) return;
    const c = new AbortController(); controller.current = c;
    const timeout = setTimeout(() => c.abort("TIMEOUT"), 135000);
    const start = performance.now(); setSeconds(0); setReceipt("");
    const ticker = setInterval(() => setSeconds(elapsedSeconds(start, performance.now())), 250);
    setBusy(true); onBusy(true); setEvents([]); setError(""); setComplete(null); setConsent(false);
    try {
      const result = await runLiveAgent(chosen, c.signal, event => { if (mounted.current) setEvents(items => [...items, event]); });
      if (mounted.current && !c.signal.aborted) {
        setComplete(result.status); onResult(result);
        setReceipt(`모델 요청 ${result.calls.length}회 · 인계 관측 ${result.accepted.length}개 · 이번 대기 ${elapsedSeconds(start, performance.now())}초`);
      }
    } catch (e) {
      if (mounted.current) setError(c.signal.aborted ? interruptionMessage(c.signal.reason) : e instanceof Error ? e.message : "실행 실패");
    } finally {
      clearTimeout(timeout); clearInterval(ticker); controller.current = null;
      if (mounted.current) { setBusy(false); onBusy(false); }
    }
  }
  // Coalesce stage start/completion while retaining actual server event timing.
  const steps = events.reduce<LiveProgress[]>((items, event) => {
    const existing = items.findIndex(item => item.stage === event.stage && item.attempt === event.attempt);
    if (existing >= 0) items[existing] = event; else items.push(event);
    return items;
  }, []);
  return <section className={`ab-live ${error || (showLastRun && complete && ["FAILED", "BUDGET_EXCEEDED"].includes(complete)) ? "ab-live-attention" : ""}`} aria-label="실시간 에이전트 실행">
    <div className="ab-live-title"><h2>이번에는 직접 실행해 보기</h2><Chip size="small" label={busy ? "실제 실행 중" : "로컬 데모 · 고정 자료"} color={busy ? "primary" : "default"} /></div>
    <p>로그인한 Codex의 사용량으로 새 추출·반론을 실행합니다. 임의 PDF나 작성 중인 검토 내용은 전송하지 않습니다. 시작하면 현재 브리핑을 교체하므로, 보관할 기록은 먼저 JSON으로 저장하세요.</p>
    <div className="ab-readiness"><Button variant="outlined" size="small" disabled={busy || checking} onClick={() => void checkReadiness()}>{checking ? "시연 준비 확인 중" : "시연 준비 확인"}</Button><span>모델 호출 없음 · 저장 기록/서버 설정만 확인</span>{checks.length > 0 && <ul>{checks.map(c => <li key={c.id}><strong>{c.ok ? "확인" : "미확인"} · {c.label}</strong><span>{c.detail}</span></li>)}</ul>}</div>
    <div className="ab-live-controls"><TextField size="small" select label="실제로 보낼 자료" value={chosen} disabled={busy} onChange={e => { setChosen(e.target.value as LiveCase); setConsent(false); setEvents([]); setError(""); setComplete(null); setReceipt(""); }}><MenuItem value="public">고정 공개 발췌 · LIBRETTO-001</MenuItem><MenuItem value="synthetic">고정 합성 자료 · DEMO-STUDY</MenuItem></TextField><Button variant="contained" disabled={!enabled || !consent || busy || checking || !local} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <Play size={16} />} onClick={() => void run()}>{busy ? "실제 에이전트 실행 중" : "실제 에이전트 실행"}</Button>{busy && <Button color="warning" startIcon={<Square size={14} />} onClick={() => controller.current?.abort("USER")}>실행 중단</Button>}</div>
    {busy && <div className="ab-live-clock"><strong>{seconds}초</strong><span>이 브라우저의 실제 대기 시간 · 완료율/예상 남은 시간이 아닙니다.</span>{seconds >= 45 && <p>응답을 기다리고 있습니다. 발표를 이어가려면 중단 후 저장 기록으로 전환할 수 있습니다.</p>}</div>}
    {(busy || (showLastRun && (events.length>0 || complete || error))) && <LiveWorkbench events={events} busy={busy} error={error} complete={complete} seconds={seconds}/>}
    <FormControlLabel control={<Checkbox checked={consent} disabled={busy || !local} onChange={e => setConsent(e.target.checked)} />} label="선택한 고정 자료의 모델 전송과 계정 사용량 소비에 동의합니다." />
    {!enabled && <div className="ab-live-unavailable">{local ? "로컬 서버에서 실시간 데모를 활성화해야 합니다. 연결 가능 여부는 로그인 성공을 보장하지 않습니다." : "이 기능은 개발 컴퓨터의 로컬 화면에서만 지원합니다."}{local && <Button size="small" onClick={() => setProbe(n => n + 1)}>연결 다시 확인</Button>}</div>}
    {steps.length > 0 && (showLastRun || busy) && <details className="ab-live-log" open={busy}><summary>실제 작업 경과 · {steps.length}단계</summary><ol className="ab-live-steps" aria-live="polite">{steps.map(step => <li key={`${step.stage}-${step.attempt}`}><span>{step.state === "COMPLETED" ? <Check size={18} /> : busy ? <CircularProgress size={16} /> : <Square size={14} />}</span><div><strong>{STAGES[step.stage].label}</strong><small>시도 {step.attempt + 1} · 서버 경과 {(step.elapsed_ms / 1000).toFixed(1)}초 · {step.state === "COMPLETED" ? "단계 완료" : busy ? "응답 대기" : "완료 응답 없음"}</small>{step.observations !== undefined && <p>추출 관측값 {step.observations}개 · 검사 전</p>}{step.findings !== undefined && <p>규칙 쟁점 {step.findings}개</p>}{step.concerns !== undefined && <p>모델 반론 {step.concerns}개 · 확인 질문 {step.questions ?? 0}개</p>}</div></li>)}</ol></details>}
    {error && <Alert severity="error">{error}</Alert>}
    {!busy && (error || (showLastRun && complete && ["FAILED", "BUDGET_EXCEEDED"].includes(complete))) && <div className="ab-live-recovery"><p>사용된 계정 사용량은 반환되지 않습니다. 서버 정리가 끝나기 전에는 다음 실행이 잠시 거부될 수 있습니다.</p><Button variant="outlined" onClick={() => { setError(""); setComplete(null); setEvents([]); setReceipt(""); setConsent(false); onReplay(); }}>저장된 공개 기록으로 전환 · 새 실행 아님</Button></div>}
    {receipt && showLastRun && <p className="ab-live-receipt">{receipt} · 단일 실행 실측</p>}
    {complete && showLastRun && <Alert severity={["FAILED", "BUDGET_EXCEEDED"].includes(complete) ? "warning" : "success"}>{["FAILED", "BUDGET_EXCEEDED"].includes(complete) ? "실행이 완성되지 않았습니다. 아래에서 중단 기록을 확인하세요." : "새 실행 기록을 받았습니다. 아래 브리핑이 이번 실행 결과로 바뀌었습니다."}</Alert>}
    <small>{chosen === "public" ? "공개 자료 최대2요청·수정0회" : "합성 자료 최대4요청·수정1회"} · 서버120초/화면135초 한도 · 동시1회 · 자동 재시도/영구 저장 없음</small>
  </section>;
}
