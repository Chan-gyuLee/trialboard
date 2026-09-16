import { useEffect, useRef, useState } from "react";
import { Alert, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, InputAdornment, Tab, Tabs, TextField } from "@mui/material";
import { ArrowRight, ArrowUpRight, Check, Download, FileSearch, History, Scale, X } from "lucide-react";
import { readAgentRecord, type AgentRecord } from "./agent-briefing";
import { downloadText, executeReview, percent } from "./review";
import { bindStressResult, INITIAL_STRESS, stressError, stressInput, stressQuestions, type StressComparison } from "./scenario-briefing";
import { currentDecision, decisionInsight, decisionMarkdown, decisionSessionJson, restoreDecisionSession, DECISION_SESSION_BYTES, repairEvidence, type DecisionNote, type DecisionSession } from "./decision-briefing";
import { MocBadge } from "./MocDemo";
import { guardSessionExit } from "./session-exit";
import "./decision-briefing.css";

export default function DecisionBriefing({ onAgent, onIntake, active }: { onAgent: () => void; onIntake: () => void; active: boolean }) {
  const [step, setStep] = useState(0), [record, setRecord] = useState<AgentRecord | null>(null);
  const [recordError, setRecordError] = useState(""), [retry, setRetry] = useState(0);
  const [repaired, setRepaired] = useState(false), [sourceOpen, setSourceOpen] = useState(false);
  const [draft, setDraft] = useState({ ...INITIAL_STRESS });
  const [history, setHistory] = useState<StressComparison[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notes, setNotes] = useState<Record<string, DecisionNote>>({});
  const [candidate, setCandidate] = useState<DecisionSession | null>(null), [importing, setImporting] = useState(false), [fileError, setFileError] = useState("");
  const importTicket = useRef(0), restoredRecord = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController(); setRecordError("");
    fetch("/data/agent/synthetic-repair.json", {signal:c.signal}).then(async r => {
      if (!r.ok) throw new Error("합성 실행 기록을 읽지 못했습니다.");
      const raw = await r.text(); if (raw.length > 2_000_000) throw new Error("지원 크기를 넘는 실행 기록입니다.");
      const parsed = await readAgentRecord(raw); repairEvidence(parsed); if (!c.signal.aborted && !restoredRecord.current) setRecord(parsed);
    }).catch(e => { if (!c.signal.aborted && !restoredRecord.current) setRecordError(e instanceof Error ? e.message : "기록을 읽지 못했습니다."); });
    return () => c.abort();
  }, [retry]);
  useEffect(() => { if (!active) request.current?.abort(); return () => request.current?.abort(); }, [active]);
  useEffect(() => () => { importTicket.current++; }, []);
  const hasWork = history.length > 0 || draft.aeA !== INITIAL_STRESS.aeA || draft.aeB !== INITIAL_STRESS.aeB;
  useEffect(() => { if (hasWork) return guardSessionExit(window); }, [hasWork]);
  const proof = record ? repairEvidence(record) : null, result = history.at(-1) ?? null;
  const current = currentDecision(result, draft) && !busy && !error;
  const note = result ? notes[result.execution.execution_id] ?? {owner:"",action:""} : {owner:"",action:""};
  const insight = result ? decisionInsight(result) : null;
  const invalid = stressError(draft);
  async function run() {
    if (invalid || request.current || importing || candidate) return;
    const c = new AbortController(); request.current = c; setBusy(true); setError("");
    const input = stressInput(draft), timer = setTimeout(() => c.abort(), 30000);
    try { const execution = await executeReview(input, c.signal); const next = bindStressResult(execution, input);
      if (!c.signal.aborted) { const nextHistory = [...history.slice(-3), next]; setHistory(nextHistory); setNotes(n => Object.fromEntries(Object.entries(n).filter(([id]) => nextHistory.some(r => r.execution.execution_id === id)))); }
    } catch (e) { setError(c.signal.aborted ? "계산 대기를 중단했습니다. 새 결과를 채택하지 않았습니다." : e instanceof Error ? e.message : "계산하지 못했습니다."); }
    finally { clearTimeout(timer); if (request.current === c) { request.current = null; setBusy(false); } }
  }
  function updateNote(key: keyof DecisionNote, value: string) { if (result && current) setNotes(n => ({...n,[result.execution.execution_id]:{...note,[key]:value}})); }
  function save() {
    if (!record || !result || !current) return;
    try { downloadText("trialboard-decision-briefing.md", decisionMarkdown(record, result, draft, note), "text/markdown;charset=utf-8"); }
    catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했습니다."); }
  }
  function saveSession() {
    if (!record || busy || importing) return;
    try { downloadText("trialboard-decision-session.json",decisionSessionJson({record,history,draft,notes}),"application/json"); setFileError(""); }
    catch (e) { setFileError(e instanceof Error ? e.message : "작업을 저장하지 못했습니다."); }
  }
  async function loadSession(file?: File) {
    if (!file || busy || importing) return;
    const id = ++importTicket.current; setImporting(true); setFileError("");
    try {
      if (file.size > DECISION_SESSION_BYTES) throw new Error("작업 JSON은 2 MB 이하만 지원합니다.");
      const next = await restoreDecisionSession(new TextDecoder("utf-8",{fatal:true}).decode(await file.arrayBuffer()));
      if (id === importTicket.current) setCandidate(next);
    } catch (e) { if (id === importTicket.current) setFileError((e instanceof Error ? e.message : "복구하지 못했습니다.") + " 현재 작업은 유지됩니다."); }
    finally { if (id === importTicket.current) setImporting(false); }
  }
  function restore() {
    if (!candidate || busy) return;
    restoredRecord.current = true; setRecord(candidate.record); setHistory(candidate.history); setDraft(candidate.draft); setNotes(candidate.notes);
    setRepaired(false); setRecordError(""); setError(""); setStep(candidate.history.length ? 2 : 0); setCandidate(null);
  }
  return <section className="db" aria-label="의사결정 브리핑">
    <MocBadge detail="합성 시연 · 근거 점검은 스크립트 기록 · 설계는 별도 가정의 실제 계산 · 임상 권고 아님" />
    <header className="db-header"><div><span className="db-eyebrow">DEMO-01 / 용량 비교 검토</span><h1>증원할까요, 용량부터 다시 볼까요?</h1><p>근거의 오류를 짚고, 설계의 차이를 확인하고, 다음 회의의 의제로 남깁니다.</p></div><Button variant="outlined" onClick={onAgent} endIcon={<ArrowUpRight size={16} />}>실제 AI 실행·작업 기록</Button></header>
    <Tabs className="db-tabs" value={step} onChange={(_, value) => setStep(value)} aria-label="의사결정 시연 단계" variant="scrollable" scrollButtons="auto"><Tab label="01  근거를 의심하다" /><Tab label="02  설계를 비교하다" /><Tab label="03  회의를 준비하다" /></Tabs>
    <div className="db-session-tools"><span>가정·최근 계산·메모를 한 파일로 이어갑니다</span><Button disabled={!record || busy || importing} onClick={saveSession}>작업 JSON 저장</Button><Button component="label" disabled={busy || importing}>{importing ? "작업 검사 중…" : "저장한 작업 열기"}<input type="file" accept=".json,application/json" hidden onChange={e => {void loadSession(e.target.files?.[0]); e.target.value="";}} /></Button></div>
    {fileError && <Alert severity="error">{fileError}</Alert>}
    <div className="db-body">
    {step === 0 && <>
      <div className="db-stage-heading"><div><span className="db-eyebrow">EVIDENCE CHECK</span><h2>숫자 하나가 바뀌면, 해석도 달라집니다.</h2></div><Chip label="저장된 스크립트 기록" variant="outlined" /></div>
      {recordError ? <Alert severity="error" action={<Button onClick={() => setRetry(n => n + 1)}>다시 읽기</Button>}>{recordError}</Alert> : !proof ? <div className="db-loading"><CircularProgress size={24} /> 검증 기록 읽는 중</div> : <div className="db-evidence-grid">
        <article className="db-evidence-card"><div className="db-card-top"><span>용량 B · 반응 관측값</span><span className={repaired ? "db-status-ok" : "db-status-issue"}>{repaired ? "수정 기록 확인" : "인용과 불일치"}</span></div>
          <div className="db-number"><span>{proof.events}</span><span className="db-number-divider">/</span><strong>{repaired ? proof.after : proof.before}</strong></div>
          <p className="db-rate">단순 사건 비율 <strong>{percent(repaired ? proof.afterRate : proof.beforeRate)}</strong><span>임상 효과 추정치 아님</span></p>
          <div className="db-quote"><FileSearch size={20} /><div><span>연결된 원문 인용 · 합성 발췌</span><blockquote>{proof.change.after.quote}</blockquote></div><Button onClick={() => setSourceOpen(true)} aria-label="분모 수정의 인용 원문 열기">원문 <ArrowUpRight size={16} /></Button></div>
          {repaired && <div className="db-diff"><span>분모 <del>{proof.before}</del> → <strong>{proof.after}</strong></span><span>비율 {percent(proof.beforeRate)} → {percent(proof.afterRate)}</span></div>}
        </article>
        <article className="db-reason"><span className="db-eyebrow">검토에서 놓치면 안 되는 것</span><h3>{repaired ? "수정값에도 근거가 남아야 합니다." : "원문에 없는 분모를 그대로 믿을 수 있나요?"}</h3><p>{repaired ? "오류를 감추지 않고 이전 값·수정값·인용을 함께 보여줍니다. 이 기록이 실제 사람의 원문 확인을 대신하지는 않습니다." : "추출값과 연결 인용이 다릅니다. 검증 기록은 해당 관측값을 문제로 표시하고, 다음 시도에서 분모를 수정했습니다."}</p>
          <ol className="db-trace"><li><FileSearch size={17} /><span>추출 기록 <strong>분모 {proof.before}</strong></span></li><li><Scale size={17} /><span>규칙 검사 <strong>인용과 불일치</strong></span></li><li><History size={17} /><span>수정 기록 <strong>{repaired ? `분모 ${proof.after}` : "다음 시도와 대조"}</strong></span></li></ol>
          <Button variant="contained" onClick={() => setRepaired(v => !v)} endIcon={<ArrowRight size={17} />}>{repaired ? "수정 전과 다시 비교" : "수정 전후 대조"}</Button><small>새 모델 실행이 아닌 저장 기록 보기</small>
        </article>
      </div>}
      <div className="db-next"><p>다음은 <strong>별도의 가정 실험</strong>입니다. 위 관측 비율을 계산 확률로 넘기지 않습니다.</p><Button onClick={() => setStep(1)} variant="outlined" endIcon={<ArrowRight size={17} />}>두 설계 비교하기</Button></div>
    </>}
    {step === 1 && <>
      <div className="db-stage-heading"><div><span className="db-eyebrow">DESIGN COMPARISON</span><h2>추가 60명이 무엇을 바꾸나요?</h2></div><Chip label="별도 합성 가정 · 실제 계산" variant="outlined" /></div>
      <div className="db-design-grid"><form className="db-assumptions" onSubmit={e => {e.preventDefault(); void run();}}><h3>회의에서 제기된 독성 우려</h3><p>기준 A 12% / B 25%에서 가정을 바꿔봅니다.</p>
        <div className="db-presets"><Button disabled={busy} variant={draft.aeA === "55" && draft.aeB === "65" ? "contained" : "outlined"} onClick={() => setDraft({...INITIAL_STRESS})}>두 용량 모두 우려</Button><Button disabled={busy} variant={draft.aeA === "12" && draft.aeB === "45" ? "contained" : "outlined"} onClick={() => setDraft({aeA:"12",aeB:"45"})}>B만 우려</Button></div>
        <div className="db-inputs">{(["aeA","aeB"] as const).map((k,i) => <TextField key={k} label={`용량 ${i ? "B" : "A"} 이상반응 가정`} value={draft[k]} disabled={busy} onChange={e => setDraft(d => ({...d,[k]:e.target.value}))} slotProps={{htmlInput:{inputMode:"decimal",maxLength:12},input:{endAdornment:<InputAdornment position="end">%</InputAdornment>}}} />)}</div>
        <dl className="db-fixed"><div><dt>반응 가정</dt><dd>A 30% / B 32%</dd></div><div><dt>이상반응 한계</dt><dd>35%</dd></div><div><dt>독성 가중치</dt><dd>0.7</dd></div><div><dt>반복 수 / seed</dt><dd>10,000 / 42</dd></div></dl>
        {invalid && <Alert severity="warning">{invalid}</Alert>}<Button fullWidth type="submit" variant="contained" disabled={busy || !!invalid || !import.meta.env.DEV} startIcon={busy ? <CircularProgress size={17} color="inherit" /> : <Scale size={17} />}>{busy ? "두 가정 × 두 설계 계산 중" : "가정을 반영해 비교"}</Button>
        {busy && <Button onClick={() => request.current?.abort()}>계산 중단</Button>}<small>{import.meta.env.DEV ? "로컬 엔진 · 임상 자료 전송·새 AI 호출 없음" : "재계산은 로컬 개발 화면에서만 지원합니다."}</small>
      </form><div className="db-comparison" aria-busy={busy}><div aria-live="polite">{error && <Alert severity="error">{error}</Alert>}{result && !current && <Alert severity="warning">이전 계산입니다. 현재 가정으로 재계산하기 전에는 회의 자료를 저장할 수 없습니다.</Alert>}</div>
        {!result ? <div className="db-uncomputed"><span>60명 <ArrowRight size={22} /> 120명</span><h3>환자를 늘리기 전에,<br />어떤 불확실성인지 확인하세요.</h3><p>왼쪽 가정으로 두 설계를 계산하면 보류 빈도와 한계 초과 군 선택을 비교할 수 있습니다.</p><small>아직 계산 결과 없음</small></div> : <>
          <div className="db-plan-grid">{result.plans.map(({before,after}) => <article className="db-plan" key={after.design.id}><span>고정 1:1 배정 · 각 군 {after.design.per_arm}명</span><h3>{after.total_sample_size}<small>명</small></h3><div className="db-plan-metric"><span>변경 가정의 선택 보류</span><strong>{percent(after.no_selection_probability)}</strong><small>기준 가정 {percent(before.no_selection_probability)}</small></div><div className="db-bar" role="img" aria-label={`선택 보류 ${percent(after.no_selection_probability)}`}><span style={{width:`${after.no_selection_probability * 100}%`}} /></div><p>한계 초과 군 선택 <strong>{percent(after.selects_true_unsafe_probability)}</strong></p><small>보류 빈도 MC 오차 ±{(after.monte_carlo_se.no_selection * 100).toFixed(2)}%p</small></article>)}</div>
          <div className="db-insight"><span>회의 의제 초안 · 규칙 기반 {current ? "" : "/ 이전 계산"}</span><h3>{insight!.title}</h3><p>{insight!.action}</p></div>
        </>}
      </div></div>
      <div className="db-next"><p>선택 빈도는 성공·허가 확률이 아닙니다. 표본수 증가는 가정한 독성을 낮추지 않습니다.</p><Button disabled={!current} onClick={() => setStep(2)} variant="outlined" endIcon={<ArrowRight size={17} />}>계산에서 회의 의제로</Button></div>
    </>}
    {step === 2 && <>
      <div className="db-stage-heading"><div><span className="db-eyebrow">MEETING BRIEF</span><h2>결과만 보여주지 않고, 다음 질문을 남깁니다.</h2></div><Button variant="contained" startIcon={<Download size={17} />} disabled={!current || !record} onClick={save}>회의 브리핑 저장</Button></div>
      {!result ? <div className="db-uncomputed"><h3>아직 회의에 연결할 계산이 없습니다.</h3><Button onClick={() => setStep(1)}>설계 비교로 이동</Button></div> : <>
        {!current && <Alert severity="warning" action={<Button onClick={() => setStep(1)}>재계산하기</Button>}>이전 계산의 질문·메모입니다. 가정 변경은 아직 반영되지 않았습니다.</Alert>}
        <div className="db-meeting-summary"><span>검토할 결정 · {current ? "현재 계산" : "이전 계산"}</span><h3>{insight!.title}</h3><p>{insight!.detail}</p></div>
        <div className="db-question-grid">{stressQuestions(result).map((q,i) => <article key={q.title}><span>0{i+1} / {q.owner}</span><h3>{q.title}</h3><p>{q.text}</p><small>{q.trigger}</small></article>)}</div>
        <div className="db-followup"><TextField label="후속 검토 담당자 · 사용자 기재" value={note.owner} disabled={!current} onChange={e => updateNote("owner",e.target.value)} slotProps={{htmlInput:{maxLength:200}}}/><TextField label="다음 행동·확인할 자료" value={note.action} disabled={!current} onChange={e => updateNote("action",e.target.value)} slotProps={{htmlInput:{maxLength:2000}}}/></div>
        <p className="db-note">메모는 이 계산 실행에만 연결됩니다. 새 계산에 이전 답변을 자동으로 옮기지 않습니다. 브라우저 메모리만 사용하므로 종료 전 저장하세요.</p>
        {history.length > 1 && <details className="db-details"><summary>최근 계산 조건 대조 · 최대 4회 / 팀 버전 관리 아님</summary><ul>{history.map((r,i) => <li key={r.execution.execution_id}>실행 {i+1} · 이상반응 A/B {r.execution.input.scenarios[1].adverse_event.map(percent).join(" / ")} · 120명 설계 보류 {percent(r.plans[1].after.no_selection_probability)} {i === history.length - 1 ? "(가장 최근)" : "(이전)"}</li>)}</ul></details>}
      </>}
    </>}
    </div>
    <footer className="db-footer"><span><Check size={15} /> 근거·가정·계산·사람의 검토를 구분합니다</span><Button onClick={onIntake}>내 PDF 검토 작업공간 <ArrowUpRight size={16} /></Button></footer>
    <Dialog open={!!candidate} onClose={() => setCandidate(null)} aria-labelledby="decision-restore-title"><DialogTitle id="decision-restore-title">저장한 검토로 이어갈까요?</DialogTitle><DialogContent>현재 가정·계산·메모를 선택한 파일의 내용으로 바꿉니다. 필요한 작업은 먼저 JSON으로 저장하세요. 파일의 내부 연결만 검사했으며 작성자·임상적 타당성은 인증하지 않습니다. 새 계산·AI 실행은 하지 않습니다.</DialogContent><DialogActions><Button onClick={() => setCandidate(null)}>현재 작업 유지</Button><Button variant="contained" disabled={busy} onClick={restore}>선택한 작업으로 복구</Button></DialogActions></Dialog>
    <details className="db-details"><summary>시연 범위와 계산의 한계</summary><p>근거 단계는 합성 발췌의 저장된 스크립트 기록입니다. 원본 PDF 확인·새 AI 실행·전문가 승인 아님. 설계 단계는 별도 합성 확률을 사용하며 위 사건 비율에서 추정하지 않습니다. 독립 Bernoulli·고정 표본수·고정 관찰기간, 결측·탈락·중간중단 미포함. 효용 = 반응률 − 0.7 × 이상반응률. 관측 이상반응이 35% 이하인 군 중 효용 최대 군을 선택하고 모두 초과하면 보류합니다. 같은 seed도 입력별 별도 난수열을 사용하며, %p 차이는 유의성 검정이 아닙니다. 질문/의제는 규칙 기반이고 임상 권고·검정력·운영 비용 계산이 아닙니다.</p>{result && <p>계산 실행: {result.execution.execution_id} · {result.execution.started_at} · 서버 영구 저장 없음</p>}</details>
    <Drawer anchor="right" open={sourceOpen} onClose={() => setSourceOpen(false)} slotProps={{paper:{className:"db-source-drawer"}}}><div role="dialog" aria-modal="true" aria-label="분모 수정의 인용 원문"><div className="db-card-top"><h2>수정값의 근거</h2><Button aria-label="인용 원문 닫기" onClick={() => setSourceOpen(false)}><X size={20} /></Button></div>{proof && <><Chip label="합성 발췌 · PDF 원본 아님" variant="outlined" /><h3>{proof.span.id} · 기록상 p.{proof.span.page ?? "미상"}</h3><blockquote>{proof.span.text.split(proof.change.after.quote!).map((part,i) => <span key={i}>{i > 0 && <mark>{proof.change.after.quote}</mark>}{part}</span>)}</blockquote><p>이 인용의 분모는 {proof.after}입니다. 최초 추출의 {proof.before}와 일치하지 않아 오류로 기록됐습니다.</p><small>발췌 식별 SHA-256<br />{proof.span.source_digest}</small></>}</div></Drawer>
  </section>;
}
