import { useEffect, useRef, useState } from "react";
import { Alert, Button, Chip, CircularProgress, LinearProgress, MenuItem, TextField } from "@mui/material";
import { ArrowDownToLine, ArrowRight, Check, ChevronLeft, FileSearch, GitCompareArrows, Maximize2, Minimize2, Pause, Play, RotateCcw, ShieldCheck, Upload } from "lucide-react";
import { briefingMarkdown, changedFields, readAgentRecord, recordStepFromKey, STAGES, FINDING_LABELS, type AgentRecord, type CitedField } from "./agent-briefing";
import { FIELD_LABELS, type FieldName } from "./field-review";
import { downloadText } from "./review";
import "./agent-briefing.css";
import { LiveAgentRunner } from "./LiveAgentRunner";
import { ScenarioBriefing } from "./ScenarioBriefing";
import { MocBadge } from "./MocDemo";

const cases = [
  { id: "public-record", label: "실제 모델 기록 · 두 수치는 비교 가능한가?" },
  { id: "synthetic-repair", label: "합성 테스트 · 잘못 읽은 분모를 수정" },
];
export function AgentBriefing({ onIntake, onSimulation,onAgentBusy }: { onIntake: () => void; onSimulation: () => void;onAgentBusy?:(busy:boolean)=>void }) {
  const [record, setRecord] = useState<AgentRecord | null>(null);
  const [caseId, setCaseId] = useState("public-record");
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);
  useEffect(()=>{onAgentBusy?.(liveBusy);},[liveBusy,onAgentBusy]);
  useEffect(()=>()=>onAgentBusy?.(false),[onAgentBusy]);
  const [presenting, setPresenting] = useState(false);
  const [demoStage, setDemoStage] = useState<"evidence" | "design">("evidence");
  const [error, setError] = useState("");
  const [spanId, setSpanId] = useState<string | null>(null);
  const [quote, setQuote] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    if (caseId === "imported" || caseId === "live") return;
    const request = ++sequence.current, controller = new AbortController();
    setBusy(true); setError(""); setPlaying(false); setRecord(null); setIndex(0); setSpanId(null); setQuote(null);
    fetch(`/data/agent/${caseId}.json`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("데모 실행 기록을 불러오지 못했습니다.");
      return readAgentRecord(await response.text());
    }).then(r => { if (sequence.current === request) setRecord(r); }).catch(e => {
      if (!controller.signal.aborted && sequence.current === request) setError(e instanceof Error ? e.message : "기록을 읽지 못했습니다.");
    }).finally(() => { if (sequence.current === request) setBusy(false); });
    return () => controller.abort();
  }, [caseId, reload]);
  useEffect(() => {
    if (!playing || !record || demoStage !== "evidence") return;
    if (index >= record.events.length - 1) { setPlaying(false); return; }
    const timer = setTimeout(() => setIndex(i => i + 1), 4500);
    return () => clearTimeout(timer);
  }, [playing, index, record, demoStage]);
  useEffect(() => { setSpanId(null); setQuote(null); }, [index]);
  useEffect(() => () => { sequence.current++; }, []);
  async function importFile(file: File) {
    const request = ++sequence.current; setBusy(true); setPlaying(false); setError("");
    try {
      if (file.size > 2_000_000) throw new Error("실행 기록은 2 MB 이하 JSON만 지원합니다.");
      const result = await readAgentRecord(await file.text());
      if (sequence.current !== request) return;
      setCaseId("imported"); setRecord(result); setIndex(0); setSpanId(null); setQuote(null);
    } catch (e) { if (sequence.current === request) setError(e instanceof Error ? e.message : "기록을 읽지 못했습니다. 기존 기록은 유지됩니다."); }
    finally { if (sequence.current === request) setBusy(false); }
  }
  function openCitation(field: CitedField) { setSpanId(field.span_id ?? "출처 없음"); setQuote(field.quote); }
  const event = record?.events[index];
  const stage = event ? STAGES[event.stage] : null;
  const attempt = record?.attempts.find(a => a.number === event?.attempt);
  const isFinal = record ? index === record.events.length - 1 : false;
  const observations = isFinal ? record?.accepted ?? [] : attempt?.extraction?.observations ?? [];
  const selectedSpan = record?.input.spans.find(s => s.id === spanId);
  const call = record?.calls.find(c => c.stage === event?.stage && c.attempt === event?.attempt);
  const scripted = record?.execution_mode === "SCRIPTED_TEST_DOUBLE";
  const finalAttempt = record?.attempts.at(-1);
  const concernList = isFinal ? finalAttempt?.critique?.concerns : event?.stage === "CRITIQUE" ? attempt?.critique?.concerns : undefined;
  const questions = isFinal ? finalAttempt?.critique?.next_questions ?? [] : [];
  const label = (name: string) => FIELD_LABELS[name as FieldName] ?? name;
  return <section className={`agent-briefing ${presenting ? "ab-presenting" : ""} ${liveBusy ? "ab-live-running" : ""}`} aria-label="에이전트 브리핑">
    <nav className="ab-demo-nav" aria-label="발표 시연 순서"><Button variant={demoStage === "evidence" ? "contained" : "outlined"} aria-current={demoStage === "evidence" ? "step" : undefined} onClick={() => setDemoStage("evidence")}>01 근거 검토</Button><Button variant={demoStage === "design" ? "contained" : "outlined"} aria-current={demoStage === "design" ? "step" : undefined} disabled={liveBusy || busy} onClick={() => { setPlaying(false); setDemoStage("design"); }}>02 합성 설계 비교</Button>{demoStage === "design" && <Button onClick={() => setPresenting(v => !v)}>{presenting ? "일반 화면으로" : "발표 집중 모드"}</Button>}</nav>
    <div hidden={demoStage !== "design"}><ScenarioBriefing active={demoStage === "design"} onBack={() => setDemoStage("evidence")} onAdvanced={onSimulation} /></div>
    <div hidden={demoStage !== "evidence"}>
    {record?.input.provenance === "synthetic_fixture" && <MocBadge detail={scripted ? "합성 자료 · 스크립트 테스트 기록 재생 · 새 AI 호출 없음" : "합성 자료 · 모델 실행 기록 보기 · 임상 성능 평가 아님"} />}
    <div className="ab-heading"><div><span className="ab-eyebrow">AGENT BRIEFING / 근거에서 검토 질문까지</span><h1>{presenting ? `${record?.input.study ?? "실제 실행"} · 에이전트 브리핑` : "답보다 중요한 건, 판단의 근거."}</h1><p>에이전트가 추출하고, 반론하고, 보류한 이유를 확인하세요.</p></div><div className="ab-heading-actions"><Chip label={liveBusy ? "새 모델 실행 중" : caseId === "live" ? record ? "직접 실행한 기록 보기" : "완료 결과 없음" : "저장 기록 보기"} variant="outlined" /><Button variant={presenting ? "contained" : "outlined"} aria-pressed={presenting} startIcon={presenting ? <Minimize2 size={16} /> : <Maximize2 size={16} />} onClick={() => setPresenting(value => !value)}>{presenting ? "일반 화면으로" : "발표 집중 모드"}</Button></div></div>
    <div className="ab-toolbar"><TextField select label="시연 사례" value={caseId} onChange={e => setCaseId(e.target.value)} disabled={busy || liveBusy} size="small">{cases.map(c => <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>)}{caseId === "imported" && <MenuItem value="imported">가져온 실행 기록 · 작성자 미인증</MenuItem>}{caseId === "live" && <MenuItem value="live">이번에 직접 실행한 기록</MenuItem>}</TextField>
      <Button component="label" variant="outlined" startIcon={<Upload size={16} />} disabled={busy || liveBusy}>실행 JSON 열기<input type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importFile(f); }} /></Button>
      <Button startIcon={<ArrowDownToLine size={16} />} disabled={!record || busy || liveBusy} onClick={() => record && downloadText("trialboard-agent-briefing.md", briefingMarkdown(record), "text/markdown;charset=utf-8")}>브리핑 저장</Button>
      <Button disabled={!record || busy || liveBusy} onClick={() => record && downloadText("trialboard-agent-record.json", JSON.stringify(record, null, 2), "application/json")}>실행 JSON 저장</Button>
    </div>
    <LiveAgentRunner showLastRun={caseId === "live"} onReplay={() => { setPlaying(false); setCaseId("public-record"); setReload(n => n + 1); setIndex(0); }} onBusy={value => { setLiveBusy(value); if (value) { sequence.current++; setBusy(false); setCaseId("live"); setRecord(null); setPlaying(false); } }} onResult={result => {
      sequence.current++; setBusy(false); setError(""); setCaseId("live"); setRecord(result); setIndex(result.events.length - 1); setPlaying(false); setSpanId(null); setQuote(null);
    }} />
    {error && <Alert severity="error" action={caseId !== "imported" ? <Button onClick={() => setReload(n => n + 1)}>다시 읽기</Button> : undefined}>{error}</Alert>}
    {busy && <div className="ab-loading" role="status"><CircularProgress size={22} /> 실행 기록을 읽는 중</div>}
    {liveBusy && <Alert severity="info">새 실행이 진행 중입니다. 이전 브리핑은 숨겼으며, 이번 실행 결과를 받은 뒤 표시합니다.</Alert>}
    {record && event && stage && !liveBusy && <>
      <div className={`ab-provenance ${scripted ? "scripted" : ""}`}><ShieldCheck size={18} /><span>{scripted ? "스크립트 테스트 · 실제 AI 호출 없음" : caseId === "imported" ? "파일에 기록된 모델 실행 · 작성자 미인증" : caseId === "live" ? "이번에 직접 실행한 Codex 모델 결과" : "실제 Codex 모델 실행의 저장 기록 · 공개 발췌 개발 사례"} · {record.started_at.slice(0, 10)}<small>{caseId === "live" ? "아래는 방금 받은 결과의 단계별 보기" : "아래는 기존 기록 재생 · 새 모델 호출 없음"} · {record.input.provenance === "synthetic_fixture" ? "합성 자료" : record.input.provenance === "curated_public_excerpt" ? "선별된 공개 발췌" : "사용자 PDF 발췌 · 원본 미대조"} · 단일 사례이며 임상 정확도 평가가 아닙니다.</small></span></div>
      <div className="ab-question"><FileSearch size={22} /><div><span>검토 질문 · {record.input.study}</span><h2>{record.input.question}</h2></div></div>
      <div className="ab-layout">
        <aside className="ab-track" tabIndex={0} aria-label="저장된 실행 경로" onKeyDown={e => {
          const next = recordStepFromKey(e.key, index, record.events.length);
          if (next !== null) { e.preventDefault(); setPlaying(false); setIndex(next); }
        }}><div className="ab-track-title"><strong>작업 기록</strong><span>{index + 1} / {record.events.length}</span></div><LinearProgress variant="determinate" value={((index + 1) / record.events.length) * 100} aria-label="기록 재생 위치" />
          <ol>{record.events.map((e, i) => <li key={`${e.stage}-${i}`}><button onClick={() => { setPlaying(false); setIndex(i); }} aria-current={index === i ? "step" : undefined} className={index === i ? "selected" : ""}><span className="ab-step-number">{i < index ? <Check size={15} /> : i + 1}</span><span><strong>{STAGES[e.stage].label}</strong><small>{STAGES[e.stage].kind} · 시도 {e.attempt + 1}</small></span></button></li>)}</ol>
          <div className="ab-player"><Button variant="contained" disabled={busy} startIcon={playing ? <Pause size={16} /> : <Play size={16} />} onClick={() => { if (isFinal) setIndex(0); setPlaying(p => !p); }}>{playing ? "재생 멈춤" : "기록 자동 재생"}</Button><div><Button aria-label="이전 기록" disabled={index === 0} onClick={() => { setPlaying(false); setIndex(i => i - 1); }}><ChevronLeft size={18} /></Button><Button startIcon={<RotateCcw size={14} />} onClick={() => { setPlaying(false); setIndex(0); }}>처음</Button><Button aria-label="다음 기록" disabled={isFinal} onClick={() => { setPlaying(false); setIndex(i => i + 1); }}><ArrowRight size={18} /></Button></div><p>4.5초 간격 재생 · 실행 소요 시간 아님</p></div>
        </aside>
        <div className="ab-detail" aria-live="polite" aria-atomic="false">
          <div className="ab-detail-heading"><div><span className="ab-eyebrow">{stage.kind} / {String(index + 1).padStart(2, "0")}</span><h2>{stage.label}</h2><p>{stage.description}</p></div><Chip size="small" label={call ? call.outcome === "RECEIVED" ? "응답 수신 기록" : "응답 미완료 기록" : "저장된 산출물"} /></div>
          {event.codes.length > 0 && <div className="ab-codes">{event.codes.map(code => <Chip key={code} label={code} size="small" variant="outlined" />)}</div>}
          {(event.stage === "EXTRACT" || event.stage === "REVISE" || isFinal) && <>
            {event.stage === "REVISE" && <div className="ab-changes"><h3><GitCompareArrows size={18} /> 이전 시도와 달라진 값</h3>{changedFields(record, event.attempt).map(change => <div className="ab-change" key={`${change.id}-${change.field}`}><span>{change.id} · {label(change.field)}</span><del>{change.before.value ?? "미보고"}</del><ArrowRight size={17} /><strong>{change.after.value ?? "미보고"}</strong><Button size="small" onClick={() => openCitation(change.after)}>수정 근거</Button></div>)}{!changedFields(record, event.attempt).length && <p>같은 관측값 ID에서 변경된 값이 없습니다. 새 관측값은 아래에서 확인하세요.</p>}</div>}
            <h3 className="ab-section-title">{isFinal ? "인계된 관측 초안" : "이 시도가 추출한 관측값"} <span>{observations.length}개 · 사람의 확인 전</span></h3>
            <div className="ab-observations">{observations.map(row => <article key={row.id}><div className="ab-observation-title"><strong>{row.fields.cohort.value ?? row.id}</strong><span>{row.fields.metric.value ?? "지표 미보고"}</span></div><div className="ab-rate">{row.value_kind === "reported_percentage" ? row.fields.reported_rate.value ?? "미보고" : `${row.fields.events.value ?? "?"} / ${row.fields.denominator.value ?? "?"}`}<small>{row.value_kind === "reported_percentage" ? `보고 분모 ${row.fields.denominator.value ?? "미보고"} · 사건 수 역산 안 함` : "사건 수 / 분모 · 참확률 아님"}</small></div><dl>{["dose", "population", "window"].map(name => <div key={name}><dt>{label(name)}</dt><dd>{row.fields[name].value ?? "미보고"}</dd></div>)}</dl><Button size="small" onClick={() => openCitation(row.fields[row.value_kind === "reported_percentage" ? "reported_rate" : "events"])}>연결된 원문 확인</Button></article>)}</div>
            {!observations.length && <Alert severity="warning">이 단계에서 인계할 관측 초안이 없습니다.</Alert>}
          </>}
          {event.stage === "VERIFY" && <div className="ab-findings"><h3>규칙 검사 쟁점 {attempt?.findings.filter(f => !f.code.startsWith("MODEL_")).length ?? 0}개</h3>{attempt?.findings.filter(f => !f.code.startsWith("MODEL_")).map((f, i) => <article key={i}><strong>{FINDING_LABELS[f.code] ?? f.code}</strong><p>{f.observation_id ?? "관측값 간 비교"}{f.field ? ` · ${label(f.field)}` : ""}</p>{f.detail && <p>{f.detail}</p>}<small>{f.code}</small>{f.observation_id && f.field && attempt.extraction?.observations.find(o => o.id === f.observation_id)?.fields[f.field] && <Button size="small" onClick={() => openCitation(attempt.extraction!.observations.find(o => o.id === f.observation_id)!.fields[f.field!])}>해당 필드의 인용 확인</Button>}</article>)}{!attempt?.findings.filter(f => !f.code.startsWith("MODEL_")).length && <Alert severity="info">기록된 규칙 쟁점이 없습니다. 원문 의미의 정확성·비교 타당성이 검증되었다는 뜻은 아닙니다.</Alert>}</div>}
          {concernList && <div className="ab-concerns"><h3>모델이 제기한 반론 <span>독립 전문가 검증 아님</span></h3>{concernList.map((c, i) => <article key={i}><span className="ab-concern-number">{i + 1}</span><div><strong>{c.scope === "comparison_limitation" ? "비교 적용 범위" : "관측값 오류 의심"}</strong><p>{c.reason}</p><div className="ab-citation-buttons">{c.span_ids.map(id => <Button size="small" key={id} onClick={() => { setSpanId(id); setQuote(null); }}>근거 {id}</Button>)}</div></div></article>)}{!concernList.length && <p>이 시도의 반론 기록이 비어 있습니다. 문제가 없다는 보장은 아닙니다.</p>}</div>}
          {event.stage === "CRITIQUE" && !attempt?.critique && <Alert severity="warning">완료된 반론 산출물이 없습니다. 호출 상태를 확인하세요.</Alert>}
          {spanId && <section className="ab-source" aria-label="연결된 원문"><div><strong>원문 · {spanId}{selectedSpan?.page ? ` · p.${selectedSpan.page}` : ""}</strong><Button size="small" onClick={() => { setSpanId(null); setQuote(null); }}>닫기</Button></div>{selectedSpan ? <><p>{selectedSpan.text}</p>{quote && <blockquote>{quote}<small>{selectedSpan.text.includes(quote) ? "이 발췌에 포함된 인용 · 값의 의미는 별도 확인" : "주의: 이 인용은 연결된 발췌와 일치하지 않습니다."}</small></blockquote>}</> : <Alert severity="warning">기록에 연결된 원문이 없습니다. 근거를 확인할 수 없습니다.</Alert>}</section>}
          {isFinal && <div className="ab-handoff"><h3>다음 회의에서 확인할 질문</h3>{questions.length ? <ol>{questions.map(q => <li key={q}>{q}</li>)}</ol> : <p>생성된 질문이 없습니다. 검토자가 추가해야 합니다.</p>}<Alert severity="info">AI가 남긴 검토 초안입니다. 질문의 적절성과 설계 적용 여부는 사람이 판단합니다.</Alert><div className="ab-next"><Button variant="outlined" onClick={onIntake}>내 PDF 검토로 이동</Button><Button variant="contained" onClick={() => { setPlaying(false); setDemoStage("design"); window.scrollTo({ top: 0 }); }}>다음: 합성 설계 비교 <ArrowRight size={16} /></Button></div><p>합성 설계 실험은 별도 예제입니다. 위 공개 자료의 수치를 계산 가정으로 넘기지 않습니다.</p></div>}
        </div>
      </div>
      <details className="ab-audit"><summary>실행 출처와 데모의 한계</summary><p>내부 사고 과정이 아닌, 엔진이 저장한 도구·모델 작업 산출물을 재생합니다. 역할별 단계는 독립된 여러 전문가가 아닙니다.</p><p>입력 hash 일치 검사는 작성자 인증이나 원본 PDF 대조를 대신하지 않습니다. 가져온 파일은 이 브라우저 메모리에서만 읽으며 새로고침하면 사라집니다.</p><p>{record.engine_version} · {record.execution_mode} · {record.model}</p><p>실행 {record.run_id} · 호출 기록 {record.calls.length}개 / 응답 수신 {record.calls.filter(c => c.outcome === "RECEIVED").length}개</p><p className="hash">입력 SHA-256 {record.input_digest}</p><ul>{record.limitations.map(l => <li key={l}>{l}</li>)}</ul></details>
    </>}
    </div>
  </section>;
}
