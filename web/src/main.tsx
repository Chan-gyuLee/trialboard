import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Accordion, AccordionDetails, AccordionSummary, Alert, Button, Checkbox, Chip, CircularProgress, CssBaseline, FormControlLabel, InputAdornment, MenuItem, TextField, ThemeProvider } from "@mui/material";
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronRight, FileCheck2, FlaskConical, History, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { Evidence, type Packet } from "./Evidence";
import { AgentBriefing } from "./AgentBriefing";
import { theme } from "./theme";
import { SourceWorkspace as Intake } from "./SourceWorkspace";
import { delta, downloadText, draftFrom, executeReview, makeInput, modes, percent, validateDraft, type Draft, type Execution, type Mode, type Report, type Simulation } from "./review";
import { installEvidenceTools, type ModelContext } from "./webmcp";
import "./style.css";
import { MocBadge } from "./MocDemo";
import { DemoRecorder } from "./DemoRecorder";
import DecisionBriefing from "./DecisionBriefing";
import EvidenceScout, {type ScoutContext} from "./EvidenceScout";
import AutoReview from "./AutoReview";
import DecisionCaseWorkspace from './DecisionCaseWorkspace';
import BrandLogo from './BrandLogo';
import './product-polish.css';

type Tab = "start" | "case" | "manual" | "decision" | "agent" | "intake" | "simulation" | "evidence" | "report";
const navigation = [
  { id: "start" as const, label: "에이전트 검토", icon: BookOpen },
  { id: "case" as const, label: "설계 검토", icon: SlidersHorizontal },
  { id: "manual" as const, label: "상세 근거 검색", icon: Search },
  { id: "decision" as const, label: "의사결정 브리핑", icon: FlaskConical },
  { id: "agent" as const, label: "에이전트 브리핑", icon: History },
  { id: "intake" as const, label: "자료 검토", icon: FileCheck2 },
  { id: "simulation" as const, label: "가정 실험", icon: SlidersHorizontal },
  { id: "evidence" as const, label: "공개 근거", icon: BookOpen },
  { id: "report" as const, label: "실험 기록", icon: FileCheck2 },
];
async function load<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error("검토 자료를 불러오지 못했습니다.");
  return response.json();
}
function App() {
  const [packet, setPacket] = useState<Packet | null>(null);
  const [reports, setReports] = useState<Record<Mode, Report> | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState<Tab>("start");
  const [researchBusy,setResearchBusy]=useState(false);
  const [autoBusy,setAutoBusy]=useState(false);
  const [scoutContext, setScoutContext] = useState<ScoutContext | undefined>();
  const [reviewHandoff,setReviewHandoff]=useState<import('./research-handoff').ResearchHandoff>();
  const [researchResume,setResearchResume]=useState<import("./research-resume").ResearchResume>();
  const [selected, setSelected] = useState("dose_comparison");
  const [mode, setMode] = useState<Mode>("normal");
  const [scenario, setScenario] = useState("plateau");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [lastDraft, setLastDraft] = useState<Draft | null>(null);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [previous, setPrevious] = useState<Simulation[] | null>(null);
  const [compare, setCompare] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pdfAgentBusy,setPdfAgentBusy]=useState(false),[fixedAgentBusy,setFixedAgentBusy]=useState(false);
  const [runError, setRunError] = useState("");
  const [connection, setConnection] = useState<"checking" | "ready" | "offline" | "preview">(import.meta.env.DEV ? "checking" : "preview");
  const [probe, setProbe] = useState(0);
  const activeRun = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController(); setLoadError("");
    Promise.all([load<Packet>("/data/evidence.json", c.signal), ...modes.map(m => load<Report>(`/data/${m.id}.json`, c.signal))]).then(([p, normal, fault, missing]) => {
      setPacket(p as Packet); const normalReport = normal as Report;
      setReports({ normal: normalReport, "denominator-error": fault as Report, "missing-evidence": missing as Report });
      const initial = draftFrom(normalReport.simulations.filter(s => s.scenario.id === "plateau")); setDraft(initial); setLastDraft(initial);
    }).catch(e => { if (e.name !== "AbortError") setLoadError(e.message); });
    return () => c.abort();
  }, [reload]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let disposed = false;
    const c = new AbortController(); const timer = setTimeout(() => c.abort(), 4000); setConnection("checking");
    load<{ input?: unknown }>("/api/reviews/defaults", c.signal).then(data => { if (!disposed) setConnection(data.input ? "ready" : "offline"); }).catch(() => { if (!disposed) setConnection("offline"); }).finally(() => clearTimeout(timer));
    return () => { disposed = true; clearTimeout(timer); c.abort(); };
  }, [probe]);
  useEffect(() => () => activeRun.current?.abort(), []);
  useEffect(() => {
    if (!packet) return;
    return installEvidenceTools((document as Document & { modelContext?: ModelContext }).modelContext, packet.facts.map(f => f.id), id => { const f = packet.facts.find(f => f.id === id)!; return { ...f, source: packet.sources[f.source_id] }; }, id => flushSync(() => { setSelected(id); setTab("evidence"); }));
  }, [packet]);
  if (loadError) return <main className="loading"><h1>자료를 불러오지 못했습니다</h1><Alert severity="error">{loadError}</Alert><Button onClick={() => setReload(n => n + 1)}>다시 불러오기</Button></main>;
  if (!packet || !reports || !draft) return <main className="loading" aria-busy="true"><span className="wordmark">TrialBoard</span><CircularProgress size={24} /><p>검토 작업을 불러오는 중</p></main>;
  const report = execution?.report ?? reports[mode];
  const sims = report.simulations.filter(s => s.scenario.id === scenario);
  const presets = reports.normal.simulations.filter(s => s.design.id === "small").map(s => s.scenario);
  const errors = validateDraft(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(lastDraft);
  const change = (key: keyof Draft, value: string) => setDraft(d => d ? { ...d, [key]: value } : d);
  function switchContext(nextMode: Mode, nextScenario: string) {
    if (busy || !reports) return;
    const next = draftFrom(reports[nextMode].simulations.filter(s => s.scenario.id === nextScenario));
    setMode(nextMode); setScenario(nextScenario); setDraft(next); setLastDraft(next); setExecution(null); setPrevious(null); setRunError("");
  }
  async function run() {
    if (!draft || busy || activeRun.current || connection !== "ready" || Object.keys(errors).length) return;
    const controller = new AbortController(); activeRun.current = controller;
    const submitted = { ...draft }; const timeout = setTimeout(() => controller.abort(), 30000); setBusy(true); setRunError("");
    try {
      const result = await executeReview(makeInput(submitted, presets.find(s => s.id === scenario)!, mode), controller.signal);
      setPrevious(sims); setExecution(result); setLastDraft(submitted); setCompare(true);
    } catch (e) { setRunError(e instanceof Error && e.name !== "AbortError" ? e.message : "응답 시간이 초과되었습니다. 서버 계산은 계속될 수 있으며 기존 결과는 유지됩니다."); }
    finally { clearTimeout(timeout); setBusy(false); activeRun.current = null; }
  }
  function exportReport() {
    if (execution) downloadText(`trialboard-${execution.execution_id}.md`, execution.markdown, "text/markdown;charset=utf-8");
    else { const a = document.createElement("a"); a.href = `/data/${mode}.md`; a.download = `trialboard-${mode}.md`; a.click(); }
  }
  const numberField = (key: keyof Draft, label: string, unit?: string) => <TextField fullWidth label={label} value={draft[key]} error={!!errors[key]} helperText={errors[key]} onChange={e => change(key, e.target.value)} disabled={busy} slotProps={{ htmlInput: { inputMode: "decimal" }, input: { endAdornment: unit ? <InputAdornment position="end">{unit}</InputAdornment> : undefined } }} />;
  return <div className="app-shell" data-workspace={tab}><a className="skip-link" href="#workspace">본문으로 건너뛰기</a>
    <aside className="sidebar"><a className="brand" href="/" aria-label="TrialBoard 홈"><BrandLogo/></a><div className="workspace-label">검토 작업공간</div>
      <nav aria-label="검토 작업">{navigation.filter(n=>n.id==='start'||n.id==='case'||n.id==='intake').map(({id,label,icon:Icon})=><button key={id} aria-label={label} onClick={()=>setTab(id)} className={`nav-item ${tab===id?'active':''}`} aria-current={tab===id?'page':undefined}><Icon size={19}/><span>{label}</span></button>)}<details className="nav-advanced"><summary>검토 도구</summary>{navigation.filter(n=>n.id!=='start'&&n.id!=='case'&&n.id!=='intake').map(({ id, label, icon: Icon }) => <button key={id} aria-label={label} onClick={() => setTab(id)} className={`nav-item ${tab === id ? "active" : ""}`} aria-current={tab === id ? "page" : undefined}><Icon size={19} /><span>{label}</span></button>)}</details></nav>
      </aside>
    <div className="workspace-shell"><header className="topbar"><div className="breadcrumbs">작업공간 <ChevronRight size={14} /><span>{tab === "start" ? "에이전트 검토" : tab === "manual" ? "상세 근거 검색" : tab === "decision" ? "의사결정 브리핑" : tab === "agent" ? "에이전트 브리핑" : "용량 비교 검토"}</span></div><span className={`connection ${tab !== "agent" && connection === "ready" ? "connected" : ""}`}><i />{tab === "start" ? "공개 근거 · 대회 API · 로컬 기록" : tab === "agent" ? "실제 실행과 저장 기록을 구분합니다" : tab === "intake" ? "이 탭에서 검토 · 로컬 전송은 별도 동의" : tab === "evidence" ? "공개 참고 자료" : connection === "ready" ? "로컬 계산 서버 연결됨" : connection === "checking" ? "서버 확인 중" : connection === "preview" ? "저장 결과 미리보기" : "계산 서버 연결 안 됨"}</span></header>
      <main id="workspace" className="workspace">
        {((researchBusy&&tab!=='manual')||(autoBusy&&tab!=='start'))&&<Alert severity="info" action={<Button onClick={()=>setTab(autoBusy?"start":"manual")}>조사 화면 열기</Button>}>공개 근거 조사 진행 중입니다. AI 작업은 설정된 실행 모델의 사용량을 소비합니다. 조사 화면에서 상태 확인·중단할 수 있습니다.</Alert>}
        {(pdfAgentBusy || fixedAgentBusy)&&<Alert severity="info" className="global-agent-status" action={<Button onClick={()=>setTab(pdfAgentBusy?'intake':'agent')}>작업 화면 열기</Button>}>{pdfAgentBusy?'PDF 문구':'고정 사례'} 에이전트가 실행 중입니다. 다른 메뉴를 보더라도 계정 사용량을 소비할 수 있습니다. 작업 화면에서 상태를 확인하거나 중단하세요.</Alert>}
        <div hidden={tab !== "start"}><AutoReview locked={pdfAgentBusy||fixedAgentBusy||researchBusy} onBusy={setAutoBusy} onIntake={()=>setTab('case')} onManual={()=>setTab('manual')} onContinue={done=>{setReviewHandoff({token:crypto.randomUUID(),done});setScoutContext(undefined);setTab('intake');}} onDetails={result=>{const c=result.collection,s=c.sources[0];if(!s)return;setResearchResume({token:crypto.randomUUID(),context:{asset:c.request.asset,indication:c.request.indication,study:c.request.nct_id,question:'용량별 반응과 이상반응을 같은 조건에서 비교할 수 있는가?',receiptId:c.request.search_id,document:{runId:c.id,sourceId:s.id,title:s.title}}});setTab('manual');}}/></div>
        <div hidden={tab !== "case"}><DecisionCaseWorkspace active={tab==="case"} onBack={()=>setTab("start")} onIntake={()=>{setScoutContext(undefined);setTab("intake");}}/></div>
        <div hidden={tab !== "manual"}><EvidenceScout resume={researchResume} onResearchBusy={setResearchBusy} locked={pdfAgentBusy || fixedAgentBusy || autoBusy} onIntake={context=>{setScoutContext(context);setTab("intake");}} /></div>
        <div hidden={tab !== "decision"}><DecisionBriefing active={tab === "decision"} onAgent={() => setTab("agent")} onIntake={() => setTab("intake")} /></div>
        {(tab === "simulation" || tab === "report") && <MocBadge detail="합성 가정 · 실제 임상 근거 아님 · 저장 결과와 새 계산을 구분합니다" />}
        <div hidden={tab !== "agent"}><AgentBriefing onAgentBusy={setFixedAgentBusy} onIntake={() => setTab("intake")} onSimulation={() => setTab("simulation")} /></div>
        <div hidden={tab !== "intake"}><Intake reviewHandoff={reviewHandoff} scoutContext={scoutContext} onResearch={researchBusy?undefined:context=>{setResearchResume({token:crypto.randomUUID(),context});setTab("manual");}} onAgentBusy={setPdfAgentBusy} onEvidence={() => setTab("evidence")} /></div><div hidden={tab === "case" || tab === "start" || tab === "manual" || tab === "intake" || tab === "agent" || tab === "decision"}><div className="page-heading"><div><div className="heading-meta"><span>용량 최적화</span><span className="meta-divider" /><span>합성 사례</span></div><h1>{tab === "simulation" ? "용량 비교 검토" : tab === "evidence" ? "공개 근거 라이브러리" : "검토 보고서"}</h1><p>{tab === "simulation" ? "두 용량을 어떻게 비교할지, 가정을 바꾸며 확인하세요." : tab === "evidence" ? "판단에 앞서, 원문과 적용 범위를 확인하세요." : "확인한 항목과 아직 판단할 수 없는 항목을 구분합니다."}</p></div><Button variant="outlined" startIcon={<ArrowDownToLine size={16} />} onClick={exportReport}>보고서 내려받기</Button></div>
        {tab === "evidence" ? <Evidence packet={packet} selected={selected} onSelect={setSelected} /> : <>
          <div className="notice-line"><FlaskConical size={16} /><span>합성 데이터로 검토합니다. 실제 약물 추정치·임상 권고가 아닙니다.</span><Button size="small" onClick={() => setTab("evidence")} endIcon={<ArrowUpRight size={14} />}>공개 근거 보기</Button></div>
          {tab === "simulation" ? <div className="comparison-layout"><section className="editor-panel" aria-label="계산 조건 편집"><div className="panel-title"><div><span className="step">01</span><h2>비교 조건</h2></div><span className="meta">용량 A · B</span></div>
            <form onSubmit={e => { e.preventDefault(); void run(); }}><fieldset disabled={busy}><div className="editor-section"><TextField select fullWidth label="자료 검증 사례" value={mode} onChange={e => switchContext(e.target.value as Mode, scenario)} disabled={busy}>{modes.map(m => <MenuItem key={m.id} value={m.id}>{m.label}</MenuItem>)}</TextField><TextField select fullWidth label="시작 가정" value={scenario} onChange={e => switchContext(mode, e.target.value)} disabled={busy}>{presets.map(s => <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>)}</TextField><p className="field-note">사례·가정을 바꾸면 편집 내용과 직전 비교가 초기화됩니다.</p></div>
              <div className="editor-section"><h3>반응과 이상반응</h3><div className="dose-head"><span className="dose-a"><i />용량 A</span><span className="dose-b"><i />용량 B</span></div><div className="input-pair">{numberField("responseA", "A 반응 확률", "%")}{numberField("responseB", "B 반응 확률", "%")}</div><div className="input-pair">{numberField("aeA", "A 이상반응", "%")}{numberField("aeB", "B 이상반응", "%")}</div></div>
              <div className="editor-section"><h3>비교할 표본수 <span>각 군 기준 · 1:1 배정</span></h3><div className="input-pair">{numberField("small", "설계 1", "명")}{numberField("larger", "설계 2", "명")}</div></div>
              <Accordion className="advanced"><AccordionSummary expandIcon={<ChevronDown size={16} />}><span>선택 기준·실행 설정</span></AccordionSummary><AccordionDetails><div className="input-pair">{numberField("penalty", "이상반응 가중치")}{numberField("limit", "이상반응 한계", "%")}</div><div className="input-pair">{numberField("repetitions", "반복 횟수")}{numberField("seed", "난수 seed")}</div><p className="field-note">반응률 − 가중치 × 이상반응률이 큰 군을 선택합니다. 임상적으로 검증된 기준이 아닙니다.</p></AccordionDetails></Accordion></fieldset>
              <div className="run-area"><Button fullWidth variant="contained" type="submit" disabled={busy || connection !== "ready" || !!Object.keys(errors).length} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <RotateCcw size={16} />}>{busy ? "검증·계산 중" : "다시 검토"}</Button>{connection === "preview" ? <p>이 링크는 저장 결과 미리보기입니다.<br />조건 편집 후 재계산은 로컬 실행에서 지원합니다.</p> : connection === "offline" ? <Button fullWidth size="small" onClick={() => setProbe(n => n + 1)}>계산 서버 다시 연결</Button> : <p>조건을 수정한 뒤 실행하세요. 자동으로 계산하지 않습니다.</p>}{dirty && <Button size="small" fullWidth onClick={() => { setDraft(lastDraft); setRunError(""); }} disabled={busy}>마지막 결과의 조건으로 되돌리기</Button>}</div>
            </form></section>
            <section className="results-panel" aria-label="검토 결과" aria-busy={busy}><div className="panel-title"><div><span className="step">02</span><h2>설계 비교 결과</h2></div><Chip size="small" variant="outlined" label={execution ? "직접 실행한 결과" : "저장된 예제"} /></div><div aria-live="polite">{runError && <Alert severity="error">{runError}</Alert>}{dirty && <Alert severity="info" className="stale">조건이 수정되었습니다. 아래 결과는 아직 변경 전입니다.</Alert>}</div>
              <div className="result-intro"><h3>{sims[0].scenario.label}</h3><p>{sims[0].repetitions.toLocaleString()}회 반복 · seed {sims[0].seed}{execution && ` · ${new Date(execution.started_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 실행`}</p></div>
              <div className="design-results">{sims.map((s, i) => <DesignResult key={s.design.id} result={s} index={i} previous={compare ? previous?.[i] : undefined} />)}</div>
              {previous && <div className="comparison-note"><FormControlLabel control={<Checkbox size="small" checked={compare} onChange={e => setCompare(e.target.checked)} />} label="이전 결과와 비교" /><span>점선은 이전 결과 · %p는 빈도 차이이며 통계적 유의성이 아닙니다.</span></div>}
              <div className="selection-explainer"><strong>어떻게 읽나요?</strong><p>막대는 가정한 조건에서 각 용량을 선택한 빈도입니다. 성공 확률이나 승인 확률이 아닙니다. 두 군 모두 관측 이상반응 한계를 넘으면 선택을 보류합니다.</p></div>
              <ReviewIssues report={report} compact onReport={() => setTab("report")} />
              <Accordion className="method"><AccordionSummary expandIcon={<ChevronDown size={16} />}>계산 가정과 재현 정보</AccordionSummary><AccordionDetails><ul>{sims[0].assumptions.map(a => <li key={a}>{a}</li>)}</ul><p>용량 A/B 반응: {sims[0].scenario.response.join(" / ")} · 이상반응: {sims[0].scenario.adverse_event.join(" / ")}</p><p>가중치 {sims[0].scenario.adverse_event_penalty} · 이상반응 한계 {percent(sims[0].scenario.maximum_adverse_event_rate)}</p><p>MC 표준오차: {sims.map(s => `설계 ${s.design.id === "small" ? 1 : 2} 최선 선택 ${s.monte_carlo_se.true_utility_best.toFixed(4)}`).join(" · ")}. 시뮬레이션 오차이며 임상 신뢰구간이 아닙니다.</p><p className="hash">입력 SHA-256 {report.input_digest}</p></AccordionDetails></Accordion>
            </section></div> : <section className="report-sheet"><div className="report-title"><div><span className="overline">검토 기록</span><h2>{modes.find(m => m.id === mode)?.label} · {execution ? "직접 실행 결과" : "저장된 예제"}</h2></div><Button startIcon={<ArrowLeft size={16} />} onClick={() => setTab("simulation")}>조건으로 돌아가기</Button></div>
            {dirty && <Alert severity="info">편집 중인 조건은 반영되지 않았습니다. 마지막 결과의 보고서입니다.</Alert>}<ReviewIssues report={report} />
            <div className="table-wrap"><table><caption>구조화 원본과 일치한 항목 {report.checked_claims.length}개</caption><thead><tr><th>용량</th><th>검토 항목</th><th>사건 수 / 분모</th><th>비율</th></tr></thead><tbody>{report.checked_claims.map(c => <tr key={c.claim.id}><td>{c.claim.stated.arm === "dose_a" ? "용량 A" : "용량 B"}</td><td>{c.claim.stated.metric === "response" ? "반응" : "이상반응"}</td><td>{c.claim.stated.events} / {c.claim.stated.denominator}</td><td>{percent(c.claim.stated.events / c.claim.stated.denominator)}</td></tr>)}</tbody></table></div>
            <div className="report-downloads"><Button variant="outlined" startIcon={<ArrowDownToLine size={16} />} onClick={exportReport}>Markdown 보고서</Button>{execution ? <Button onClick={() => downloadText(`trialboard-${execution.execution_id}.json`, JSON.stringify(execution, null, 2), "application/json")}>입력·결과 전체 JSON</Button> : <Button href={`/data/${mode}.input.json`} download>예제 입력 JSON</Button>}</div><details className="report-limits" open><summary>구현 범위와 재현 정보</summary><ul>{report.limitations.map(l => <li key={l}>{l}</li>)}</ul><p>{execution ? "실행 결과는 서버에 저장되지 않습니다. 보관하려면 전체 JSON을 내려받으세요." : "저장된 예제 보고서는 세 가지 기본 가정 전체를 포함합니다."}</p><p className="hash">입력 SHA-256 {report.input_digest}</p><p className="meta">{Object.entries(report.runtime).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p></details>
          </section>}
        </>}
        </div>
      </main></div></div>;
}
function DesignResult({ result: s, index, previous }: { result: Simulation; index: number; previous?: Simulation }) {
  const rows = [
    { key: "dose_a", label: "용량 A 선택", value: s.selection_probability.dose_a, old: previous?.selection_probability.dose_a },
    { key: "dose_b", label: "용량 B 선택", value: s.selection_probability.dose_b, old: previous?.selection_probability.dose_b },
    { key: "hold", label: "선택 보류", value: s.no_selection_probability, old: previous?.no_selection_probability },
  ];
  return <article className="design-result"><div className="design-label"><span>설계 {index + 1}</span><span>1:1 배정</span></div><h4>각 군 <strong>{s.design.per_arm}</strong>명</h4><p className="sample-total">총 {s.total_sample_size}명{previous && <span> · 이전 각 군 {previous.design.per_arm}명</span>}</p><div className="frequency-label">용량 선택 빈도</div><div className="frequency-bars">{rows.map(r => <div key={r.key} className={`frequency ${r.key}`}><div className="bar-label"><span><i />{r.label}</span><strong>{percent(r.value)}</strong></div><div className="bar-track"><span style={{ width: `${r.value * 100}%` }} />{r.old !== undefined && <i title={`이전 ${percent(r.old)}`} style={{ left: `${Math.min(r.old * 100, 99.6)}%` }} />}</div></div>)}</div><div className="result-metrics"><div><span>가정상 최선의 선택</span><strong>{percent(s.selects_true_utility_best_probability)}</strong></div>{previous && <p className="difference"><History size={13} /> 이전 대비 {delta(s.selects_true_utility_best_probability - previous.selects_true_utility_best_probability)}</p>}<div><span>한계 초과 군 선택</span><strong>{percent(s.selects_true_unsafe_probability)}</strong></div></div></article>;
}
function ReviewIssues({ report, compact, onReport }: { report: Report; compact?: boolean; onReport?: () => void }) {
  return <section className={`review-status ${report.issues.length ? "has-issues" : ""}`}><div className="review-status-title"><div><span className="status-icon">{report.issues.length ? "!" : <Check size={16} />}</span><h3>{report.issues.length ? `판단을 보류한 항목 ${report.issues.length}개` : "합성 레코드 대조 완료"}</h3></div>{compact && <Button size="small" onClick={onReport} endIcon={<ChevronRight size={14} />}>검토 기록</Button>}</div>{!report.issues.length ? <p>이 예제의 수치 대조 오류는 없습니다. 실제 자료의 충분성이나 임상적 타당성은 별도 검토가 필요합니다.</p> : report.issues.map((issue, i) => <div className="issue" key={`${issue.code}-${i}`}><strong>{issue.message}</strong><p><span>다시 판단하려면</span> {issue.needed}</p>{!compact && <><p><span>보류할 판단</span> {issue.affected_decision}</p><p className="meta">{issue.owner} · {issue.code}</p></>}</div>)}</section>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider></React.StrictMode>);
