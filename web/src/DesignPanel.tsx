import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Tab, Tabs, TextField } from "@mui/material";
import { ArrowDownToLine, FileInput, Plus, Trash2 } from "lucide-react";
import { canonical, type FieldReview, type FieldName } from "./field-review";
import type {ScoutContext} from "./evidence-scout";
import EvidenceScopePanel from "./EvidenceScopePanel";
import {evidenceScope,scopeMarkdown} from "./evidence-scope";
import type { PdfSource } from "./pdf-contract";
import { downloadText } from "./review";
import { readResult, reviewKey, RESULT_BYTES } from "./revalidation-result";
import { blankScenario, briefFromDraft, draftFromBrief, newDraft, type DesignDraft } from "./design-brief";
import { draftBackup, restoreDesignInput } from "./design-draft";
import { readDesignResult, type DesignResult } from "./design-result";
import { blankNote, latestNote, newMeeting, NOTE_STATUS, packetJson, packetMarkdown, PACKET_BYTES, recordNote, restorePacket,
  type MeetingNotes, type NoteInput, type MeetingSession } from "./meeting-packet";
import "./design.css";
import LocalDesignRunner from "./LocalDesignRunner";
import { MocFileButton } from "./MocDemo";
import { isMocSource } from "./moc-data";
import EvidenceAssumptionDialog from "./EvidenceAssumptionDialog";
import {designHandoff} from "./design-handoff";
import type {Capture,DesignCheckpoint} from "./project-checkpoint";
import DesignProposalPanel, { AIProposalAcknowledgement } from "./DesignProposalPanel";
import DesignOutcome from "./DesignOutcome";

type FileKind = "brief" | "result" | "packet" | "rules";
export default function DesignPanel({ review, source, pdf, disabled, hasDraft, onSelectRow, initialSession, originalAgentRaw, initialDraft, checkpoint, onCheckpointBusy, context }: {
  review: FieldReview; source: PdfSource; disabled: boolean; hasDraft: boolean; onSelectRow: (id: string,field?:FieldName) => void;
  context?:ScoutContext;
  pdf: File | null;
  initialSession?: MeetingSession | null;
  originalAgentRaw?: string|null;
  initialDraft?: DesignDraft;
  checkpoint?: Capture<DesignCheckpoint>;
  onCheckpointBusy?:(busy:boolean)=>void;
}) {
  const [draft, setDraft] = useState<DesignDraft>(() => initialDraft ?? (initialSession ? draftFromBrief(initialSession.result.brief) : newDraft()));
  const [result, setResult] = useState<DesignResult | null>(initialSession?.result ?? null);
  const [previousResult, setPreviousResult] = useState<DesignResult | null>(null);
  const [notes, setNotes] = useState<MeetingNotes | null>(initialSession?.notes ?? null);
  const [resultDraft, setResultDraft] = useState(() => initialSession ? canonical(draftFromBrief(initialSession.result.brief)) : "");
  const [tab, setTab] = useState<"input" | "comparison" | "meeting">(initialSession ? "meeting" : "input");
  const [scenarioId, setScenarioId] = useState(initialSession?.result.brief.scenarios[0].id ?? "");
  const [questionId, setQuestionId] = useState("");
  const [note, setNote] = useState<NoteInput>(blankNote);
  const [noteDirty, setNoteDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(initialSession ? "회의 파일의 필드 검토·설계·비교 결과·회의 기록을 함께 복구했습니다. 새 계산·AI 실행·전문가 인증은 수행하지 않았습니다." : "");
  const [busy, setBusy] = useState(false);
  const [pendingImport,setPendingImport]=useState<{file:File;kind:FileKind}|null>(null);
  useEffect(()=>{onCheckpointBusy?.(busy);return()=>onCheckpointBusy?.(false);},[busy,onCheckpointBusy]);
  const ticket = useRef(0);
  const meetingTop = useRef<HTMLElement|null>(null);
  const key = useMemo(() => reviewKey(review, source), [review, source]);
  const draftKey = canonical(draft);
  useEffect(() => { ticket.current++; setBusy(false); setError(""); return () => { ticket.current++; }; }, [key, source, draftKey, hasDraft]);
  const current = Boolean(result && !hasDraft && result.reviewKey === key && resultDraft === draftKey);
  useEffect(()=>{if(tab === "meeting" && current) meetingTop.current?.scrollIntoView({block:"start",behavior:"instant"});},[tab,current]);
  const locked = disabled || busy || hasDraft;
  useEffect(()=>{if(!checkpoint)return;checkpoint.current=async()=>{
    if(locked||noteDirty||pendingImport)throw Error("필드·회의 메모의 미기록 편집이나 파일 교체 확인을 먼저 처리하세요. 실행 중에는 저장할 수 없습니다.");
    if(result&&!current)throw Error("설계 입력 또는 필드가 변경되어 이전 비교 결과가 오래되었습니다. 다시 계산해 현재 결과로 만든 뒤 프로젝트를 저장하세요.");
    return {draftRaw:await draftBackup(draft,review,source),meetingRaw:result&&notes?packetJson(result,notes):null};
  };return()=>{checkpoint.current=null;};});
  const doses = [...new Set(review.rows.map(r => r.fields.dose.current.value).filter((v): v is string => !!v))];
  const nextId = (prefix: string, ids: string[]) => { let i = 1; while (ids.includes(`${prefix}-${i}`)) i++; return `${prefix}-${i}`; };
  function change(next: DesignDraft) { setDraft(next); setNotice(""); }
  async function prepareHandoff(moc=false) {
    if(locked || draft.arms.length) return;
    const task=++ticket.current;setBusy(true);setError("");
    try{const next=await designHandoff(review,source,originalAgentRaw??null,moc);if(task===ticket.current){change(next);setNotice(moc?"현재 검토에 MOC 가정을 연결했습니다. 새 모델 실행·원문 수치의 확률 변환은 하지 않았습니다.":"원본 질문과 용량군을 연결했습니다. 확률·표본수는 직접 입력하세요. 계산 전 근거를 다시 검증합니다.");}}
    catch(e){if(task===ticket.current)setError(e instanceof Error?e.message:"연결하지 못했습니다.");}
    finally{if(task===ticket.current)setBusy(false);}
  }
  function addArm(dose: string) {
    if (!dose || draft.arms.length >= 4 || draft.arms.some(a => a.source_dose === dose)) return;
    change({ ...draft, arms: [...draft.arms, { id: nextId("arm", draft.arms.map(a => a.id)), source_dose: dose, observation_ids: [] }],
      scenarios: draft.scenarios.map(s => ({ ...s, response: [...s.response, ""], adverse_event: [...s.adverse_event, ""] })) });
  }
  function removeArm(index: number) {
    change({ ...draft, arms: draft.arms.filter((_, i) => i !== index), scenarios: draft.scenarios.map(s => ({ ...s, response: s.response.filter((_, i) => i !== index), adverse_event: s.adverse_event.filter((_, i) => i !== index) })) });
  }
  async function saveBrief(editable = false) {
    if (locked) return;
    const task = ++ticket.current; setBusy(true); setError("");
    try {
      const raw = editable ? await draftBackup(draft, review, source) : JSON.stringify(await briefFromDraft(draft, review, source), null, 2);
      if (task !== ticket.current) return;
      downloadText(editable ? "design-draft.json" : "design-brief.json", raw, "application/json");
      setNotice(editable ? "작성 중 초안을 내려받았습니다. 빈칸과 입력한 문자열을 그대로 보관하며 계산용 파일은 아닙니다. 같은 PDF·필드 검토에서 ‘설계 입력 복구’로 이어가세요. 필드 검토 이력 JSON도 별도로 보관하세요." : "현재 검토 버전에 연결한 계산용 입력을 내려받았습니다. 설계 계산은 아직 실행하지 않았습니다.");
    } catch (e) { if (task === ticket.current) setError(e instanceof Error ? e.message : "입력을 확인하세요."); }
    finally { if (task === ticket.current) setBusy(false); }
  }
  async function load(file: File | undefined, kind: FileKind, confirmed=false) {
    if (!file || locked) return;
    if (!confirmed && (kind === "brief" || kind === "packet" || (kind === "result" && result))) {setPendingImport({file,kind});return;}
    const task = ++ticket.current; setBusy(true); setError(""); setNotice("");
    try {
      const max = kind === "packet" ? PACKET_BYTES : kind === "brief" ? 100000 : RESULT_BYTES * (kind === "result" ? 2 : 1);
      if (file.size > max) throw new Error("선택한 파일이 지원 크기를 초과했습니다.");
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (kind === "rules") {
        const rules = readResult(raw, review, source);
        if (task !== ticket.current) return;
        setDraft({ ...draft, question: rules.question }); setNotice("현재 재검증 결과의 질문을 연결했습니다. 확률·표본수는 채우지 않습니다.");
      } else if (kind === "brief") {
        const restored = await restoreDesignInput(raw, review, source); if (task !== ticket.current) return;
        setDraft(restored.draft); setTab("input"); setNotice(restored.incomplete ? "작성 중 초안을 복구했습니다. 빈칸·잘못 입력한 숫자도 그대로입니다. 계산 전에 입력 검사를 통과해야 합니다. 계산·회의 기록은 포함하지 않습니다." : "계산용 입력을 복구했습니다. 계산·AI 실행·임상 승인은 수행하지 않았습니다.");
      } else {
        // A nonempty form must match an imported result. Packet restore explicitly replaces it.
        const expected = kind === "result" && (draft.arms.length || draft.question) ? await briefFromDraft(draft, review, source) : undefined;
        const restored = kind === "packet" ? await restorePacket(raw, review, source) : null;
        const next = restored?.result ?? await readDesignResult(raw, review, source, expected);
        if (task !== ticket.current) return;
        const nextDraft = draftFromBrief(next.brief);
        setDraft(nextDraft); setResultDraft(canonical(nextDraft)); setPreviousResult(null); setResult(next); setNotes(restored?.notes ?? newMeeting(next));
        setScenarioId(next.brief.scenarios[0].id); setQuestionId(""); setNote(blankNote()); setNoteDirty(false); setTab(kind === "packet" ? "meeting" : "comparison");
        setNotice(kind === "packet" ? "비교 결과와 회의 기록을 복구했습니다. 작성자·실행 진위는 인증하지 않습니다." : "현재 검토·설계 입력과 결과의 내부 일관성을 확인했습니다. 계산을 재실행하거나 임상적 타당성을 인증한 것은 아닙니다.");
      }
    } catch (e) { if (task === ticket.current) setError((e instanceof Error ? e.message : "파일을 읽지 못했습니다.") + " 기존 기록은 유지됩니다."); }
    finally { if (task === ticket.current) setBusy(false); }
  }
  function selectQuestion(id: string) {
    if (noteDirty && !window.confirm("기록하지 않은 회의 메모를 버릴까요?")) return;
    const saved = notes && latestNote(notes, id);
    setQuestionId(id); setNote(saved ? { status: saved.status, answer: saved.answer, owner: saved.owner, nextAction: saved.nextAction, reason: "" } : blankNote()); setNoteDirty(false);
  }
  function openMeeting() {
    setTab("meeting");
    if (!questionId && result?.questions[0]) selectQuestion(result.questions[0].id);
  }
  function saveNote() {
    if (!current || !result || !notes || locked) return;
    try { setNotes(recordNote(notes, result, questionId, note)); setNoteDirty(false); setNote({ ...note, reason: "" }); setError(""); setNotice("회의 메모 수정 이력을 남겼습니다. 계산 차단·원문 값·가정은 바꾸지 않았습니다. 종료 전 회의 JSON을 내려받으세요."); }
    catch (e) { setError(e instanceof Error ? e.message : "회의 메모를 확인하세요."); }
  }
  function downloadMeeting(json: boolean) {
    if (!current || !result || !notes || noteDirty || locked) return;
    try { downloadText(json ? "trialboard-meeting.json" : "trialboard-meeting.md", json ? packetJson(result, notes) : packetMarkdown(result, notes)+"\n\n"+scopeMarkdown(evidenceScope(review,source,context,result.brief.arms.flatMap(a=>a.observation_ids))), json ? "application/json" : "text/markdown;charset=utf-8"); }
    catch (e) { setError(e instanceof Error ? e.message : "내보내지 못했습니다."); }
  }
  const fileButton = (kind: FileKind, label: string) => <Button component="label" variant="outlined" startIcon={<FileInput size={16} />} disabled={locked}>{label}<input className="file-input" type="file" accept=".json,application/json" onChange={e => { void load(e.target.files?.[0], kind); e.target.value = ""; }} /></Button>;
  const input = (label: string, value: string, update: (s: string) => void, numeric = false) => <TextField size="small" fullWidth label={label} value={value} disabled={locked} onChange={e => update(e.target.value)} slotProps={{ htmlInput: { maxLength: numeric ? 20 : 2000, inputMode: numeric ? "decimal" : "text" } }} />;
  const currentQuestion = result?.questions.find(q => q.id === questionId);
  return <section className="design-workspace" aria-label="근거 연결 설계 비교" data-product-scene={tab}>
    <Dialog open={!!pendingImport} onClose={()=>setPendingImport(null)} fullWidth maxWidth="sm"><DialogTitle>설계 기록을 불러올까요?</DialogTitle><DialogContent><p>{pendingImport?.file.name}</p><p>현재 설계 입력 또는 비교·회의 기록이 바뀔 수 있습니다. 필요한 기록은 먼저 저장하세요. PDF와 필드 검토는 유지하며 검사를 통과한 파일만 적용합니다.</p></DialogContent><DialogActions><Button onClick={()=>setPendingImport(null)}>현재 설계 유지</Button><Button disabled={locked} variant="contained" onClick={()=>{const next=pendingImport;setPendingImport(null);if(next)void load(next.file,next.kind,true);}}>검사하고 설계 불러오기</Button></DialogActions></Dialog>
    <header className="design-heading"><div><span className="document-kicker">DESIGN WORKSPACE</span><h2>근거에서 설계 검토로</h2>{tab === "input" && <p>고정 표본수 대안을 비교하고, 무엇을 더 확인해야 할지 회의 의제로 남깁니다.</p>}</div><Chip label="임상 권고 아님" variant="outlined" /></header>
    <details key={tab} className="design-setup"><summary>자료 처리·파일 복구 안내</summary>
    <div className="design-steps"><span>1. 원문 근거 연결</span><span>2. 가정·표본수 입력</span><span>3. 로컬 계산 결과 비교</span><span>4. KOL 회의 자료</span></div>
    <Alert severity="info">파일 열기·결과 확인은 브라우저에서 처리합니다. ‘AI 비교 초안 제안’은 별도 동의 후 설정된 외부 AI에 선택 원문을 전송합니다. ‘로컬 계산’은 AI를 호출하지 않습니다. 입력·제안·회의 JSON을 내려받아 보관하세요.</Alert>
    {review.origin.mode === "SCRIPTED_TEST_DOUBLE" && <Alert severity="warning">원본 추출·확인 이력은 스크립트 테스트 자료입니다. 아래에서 별도로 요청하는 AI 제안의 실행 여부와는 구분합니다. 합성 자료와 자동 확인 이력을 실제 임상 근거·전문가 검증으로 사용하지 마세요.</Alert>}
    {isMocSource(source) && <div className="moc-samples"><MocFileButton name="design-brief.json" disabled={locked} onFile={file => load(file, "brief")}>MOC 설계 가정 열기</MocFileButton><p>먼저 MOC 검토 예제를 불러오세요. 가정은 임의로 정한 값이며 PDF에서 추정한 확률이 아닙니다. 결과는 아래에서 새로 계산합니다.</p></div>}
    <div className="design-toolbar">{fileButton("brief", "설계 입력 복구")}{fileButton("result", "계산 결과 불러오기")}{fileButton("packet", "회의 JSON 이어하기")}</div>
    </details>
    <div className="design-status" aria-live="polite">{busy && <p role="status">현재 검토 버전과 파일을 대조하는 중…</p>}{error && <Alert severity="error">{error}</Alert>}{notice && <Alert severity="info">{notice}</Alert>}</div>
    {hasDraft && <Alert severity="warning">필드 검토에 기록하지 않은 편집이 있습니다. 먼저 기록하거나 편집을 취소해 주세요.</Alert>}
    {result && !current && <Alert severity="warning">입력 또는 검토 이력이 바뀌었습니다. 이전 계산·회의 메모는 보관 중이지만 현재 결과로 표시하거나 내보내지 않습니다. 입력을 되돌리거나 새로 계산하세요.</Alert>}
    <Tabs value={tab} onChange={(_, v) => v === "meeting" ? openMeeting() : setTab(v)} variant="scrollable" scrollButtons="auto" aria-label="설계 검토 단계"><Tab value="input" label="설계 입력" /><Tab value="comparison" label="결과 비교" /><Tab value="meeting" label="KOL 회의" /></Tabs>
    <div hidden={tab !== "input"}>
      <DesignProposalPanel review={review} source={source} pdf={pdf} agentRaw={originalAgentRaw} disabled={locked} onBusy={setBusy} onSelectRow={onSelectRow} onAdopt={next => {
        if ((draft.arms.length || draft.question) && !window.confirm("현재 설계 입력을 AI 초안으로 바꿀까요? 기존 입력이 필요하면 먼저 초안 JSON을 저장하세요. 계산은 별도 확인 후 실행합니다.")) return false;
        change(next); return true;
      }} />
      <details className="design-context"><summary>비교 근거·적용 범위 대조표</summary><EvidenceScopePanel review={review} source={source} context={context} selectedIds={draft.arms.flatMap(a=>a.observation_ids)} disabled={locked} onSelect={onSelectRow}/></details>
      <section className="design-section"><div className="design-section-heading"><h3>01 · 비교할 질문과 원문 근거</h3>{fileButton("rules", "재검증 결과에서 질문 연결")}</div>
        {!draft.arms.length && originalAgentRaw && <div className="design-toolbar"><Button variant="contained" disabled={locked} onClick={()=>void prepareHandoff()}>이 검토의 질문·용량군 연결</Button>{isMocSource(source)&&<Button variant="outlined" disabled={locked} onClick={()=>void prepareHandoff(true)}>이 검토로 MOC 설계 가정 준비</Button>}</div>}
        {input("원래 추출·재검증 때 지정한 질문과 동일하게 입력", draft.question, question => change({ ...draft, question }))}
        <p className="design-help">비교할 원문 용량을 2–4개 추가하고, 각 용량의 반응·이상반응 관측값을 하나씩 선택하세요. 보류·미확인·문맥 불일치는 로컬 재검증에서 계산을 차단합니다.</p>
        <TextField select size="small" fullWidth label="원문 용량군 추가" value="" disabled={locked || draft.arms.length >= 4} onChange={e => addArm(e.target.value)}>{doses.filter(d => !draft.arms.some(a => a.source_dose === d)).map(d => <MenuItem key={d} value={d}>{d}</MenuItem>)}{!doses.length && <MenuItem disabled value="none">먼저 원문 필드의 용량을 기록하세요</MenuItem>}</TextField>
        <div className="design-card-grid">{draft.arms.map((a, i) => <article className="design-card" key={a.id}><div className="design-section-heading"><h4>{a.source_dose}</h4><Button aria-label={`${a.source_dose} 용량군 제거`} disabled={locked} onClick={() => removeArm(i)}><Trash2 size={16} /></Button></div>
          <TextField select fullWidth size="small" label={`${a.source_dose} 연결 관측값`} value={a.observation_ids} disabled={locked} slotProps={{ select: { multiple: true } }} onChange={e => change({ ...draft, arms: draft.arms.map((arm, n) => n === i ? { ...arm, observation_ids: typeof e.target.value === "string" ? e.target.value.split(",") : e.target.value } : arm) })}>
            {review.rows.filter(r => r.fields.dose.current.value === a.source_dose).map(r => <MenuItem key={r.id} value={r.id}>{r.fields.metric.current.value ?? "지표 미보고"} · {r.id}{Object.values(r.fields).some(f => f.decision === "held") ? " · 보류 있음" : ""}</MenuItem>)}
          </TextField><div className="design-toolbar">{a.observation_ids.map(id => <Button key={id} size="small" disabled={locked} onClick={() => onSelectRow(id)}>{id} 원문 필드</Button>)}</div><p className="design-help">원문 숫자는 아래 가정 확률로 자동 전달하지 않습니다.</p>
        </article>)}</div>
      </section>
      <section className="design-section"><div className="design-section-heading"><h3>02 · 비교할 고정 표본수 설계안</h3><Button startIcon={<Plus size={16} />} disabled={locked || draft.plans.length >= 4} onClick={() => change({ ...draft, plans: [...draft.plans, { id: nextId("plan", draft.plans.map(p => p.id)), label: "", per_arm: "", rationale: "" }] })}>설계안 추가</Button></div><p className="design-help">현재는 같은 용량군에 균등 배정하는 표본수 대안만 비교합니다. 적응형 배정·중간중단·탈락 보정은 지원하지 않습니다.</p>
        <div className="design-card-grid">{draft.plans.map((p, i) => <article className="design-card" key={p.id}>
          {input("설계안 이름", p.label, label => change({ ...draft, plans: draft.plans.map((v, n) => n === i ? { ...v, label } : v) }))}
          {input("군당 참여자 수 · 2–500명", p.per_arm, per_arm => change({ ...draft, plans: draft.plans.map((v, n) => n === i ? { ...v, per_arm } : v) }), true)}
          <p className="design-total">총 {draft.arms.length >= 2 && /^\d+$/.test(p.per_arm) && +p.per_arm >= 2 && +p.per_arm <= 500 ? `${+p.per_arm * draft.arms.length}명` : "—"}<small> {draft.arms.length}개 용량군 · 고정 균등배정</small></p>
          {input("이 표본수를 비교하려는 이유", p.rationale, rationale => change({ ...draft, plans: draft.plans.map((v, n) => n === i ? { ...v, rationale } : v) }))}
          <Button size="small" disabled={locked || draft.plans.length <= 2} onClick={() => change({ ...draft, plans: draft.plans.filter((_, n) => n !== i) })}>설계안 제거</Button>
        </article>)}</div>
      </section>
      <section className="design-section"><div className="design-section-heading"><h3>03 · 실제 참값이 아닌 가정 시나리오</h3><Button startIcon={<Plus size={16} />} disabled={locked || draft.scenarios.length >= 6} onClick={() => change({ ...draft, scenarios: [...draft.scenarios, { ...blankScenario(1, draft.arms.length), id: nextId("scenario", draft.scenarios.map(s => s.id)) }] })}>가정 추가</Button></div>
        <p className="design-help">확률은 0–1로 입력합니다. 예: 30% → 0.30. 직접 입력하거나 AI 초안을 가져올 수 있습니다. 어떤 경우에도 가정의 이유·가중치·한계와 민감도 범위를 KOL과 검토해야 합니다.</p>
        {draft.scenarios.map((s, i) => { const update = (patch: Partial<typeof s>) => change({ ...draft, scenarios: draft.scenarios.map((v, n) => n === i ? { ...v, ...patch } : v) }); return <article className="design-card design-scenario" key={s.id}>
          {typeof s.provenance !== "string" && <Chip size="small" variant="outlined" label="AI가 제안한 가정 · 실제 관측 추정치 아님" />}
          {input("가정 이름", s.label, label => update({ label }))}
          <EvidenceAssumptionDialog key={`${s.id}:${key}:${draftKey}`} draft={draft} review={review} source={source} scenarioId={s.id} disabled={locked} onChange={change} />
          <div className="design-rate-grid">{draft.arms.map((a, j) => <div key={a.id}><h4>{a.source_dose}</h4>{input(`${a.source_dose} · 가정 반응확률`, s.response[j], value => update({ response: s.response.map((v, n) => n === j ? value : v) }), true)}{input(`${a.source_dose} · 가정 이상반응확률`, s.adverse_event[j], value => update({ adverse_event: s.adverse_event.map((v, n) => n === j ? value : v) }), true)}</div>)}</div>
          <div className="design-card-grid">{input("효용 가중치 · 0–10", s.adverse_event_penalty, adverse_event_penalty => update({ adverse_event_penalty }), true)}{input("가정한 이상반응 한계 · 0–1", s.maximum_adverse_event_rate, maximum_adverse_event_rate => update({ maximum_adverse_event_rate }), true)}</div>
          {input("가정의 근거·불확실성과 검토할 범위", s.rationale, rationale => update({ rationale }))}
          <Button size="small" disabled={locked || draft.scenarios.length <= 1} onClick={() => change({ ...draft, scenarios: draft.scenarios.filter((_, n) => n !== i) })}>가정 제거</Button>
        </article>; })}
      </section>
      <section className="design-section"><h3>04 · 입력 저장 후 로컬에서 계산</h3><div className="design-card-grid">{input("난수 seed · 0–4294967295", draft.seed, seed => change({ ...draft, seed }), true)}{input("반복 수 · 100–20000", draft.repetitions, repetitions => change({ ...draft, repetitions }), true)}</div>
        <AIProposalAcknowledgement draft={draft} review={review} source={source} disabled={locked} onChange={change}/>
        <p className="design-help">효용 = 반응률 − 가중치 × 이상반응률. 관측 이상반응이 가정한 한계 이하인 군 중 효용 최대 군을 선택하고, 모두 초과하면 보류합니다. 반응·이상반응 독립 가정입니다.</p>
        <div className="design-toolbar"><Button variant="outlined" startIcon={<ArrowDownToLine size={16} />} disabled={locked} onClick={() => void saveBrief(true)}>작성 중 초안 저장</Button><Button variant="contained" startIcon={<ArrowDownToLine size={16} />} disabled={locked || !review.rows.length} onClick={() => void saveBrief()}>계산용 입력 JSON 내려받기</Button></div>
        <p className="design-help">초안은 빈칸이 있어도 저장할 수 있습니다. 계산용 입력은 모든 필수 항목 검사 후 생성합니다. 둘 다 계산 결과·회의 기록·필드 검토를 포함하지 않습니다.</p>
        <LocalDesignRunner suppliedAgentRaw={originalAgentRaw} draft={draft} review={review} source={source} pdf={pdf} locked={locked} hasDraft={hasDraft} onBusy={setBusy} confirmReplace={() => !result || window.confirm("새 계산 결과가 성공하면 기존 비교 결과와 회의 메모를 새 실행으로 바꿉니다. 필요한 회의 JSON을 보관했나요?")} onResult={next => {
          const d = draftFromBrief(next.brief); setPreviousResult(result); setDraft(d); setResultDraft(canonical(d)); setResult(next); setNotes(newMeeting(next)); setScenarioId(next.brief.scenarios[0].id); setQuestionId(""); setNote(blankNote()); setNoteDirty(false); setTab("comparison"); setNotice("");
        }} />
        <details className="design-help"><summary>계산 실행 안내 · 개발용 파일 연결</summary><p>내려받은 입력·이력 JSON, 추출 원문 포함 JSON, 원본 PDF와 최초 에이전트 결과로 실행하세요. AI 의견을 반영하려면 현재 버전의 AI 재검토 결과도 명시적으로 전달해야 합니다. 자동으로 이전 AI 파일을 찾아 쓰지 않습니다.</p><pre>{`uv run python -m trialboard.agent.design_compare \\\n  --brief design-brief.json --review review.json \\\n  --source-export evidence-export.json --pdf original.pdf \\\n  --agent-report original-agent.json \\\n  --ai-review current-ai-report.json`}</pre><p>직접 추가한 검토는 --agent-report 대신 --asset, --indication, --study, --question을 사용합니다. AI 결과가 없으면 --ai-review를 생략하며 결과에 ‘미제공’으로 남습니다. 생성된 output/design-comparison/실행ID/report.json을 위 ‘계산 결과 불러오기’로 선택하세요.</p></details>
      </section>
    </div>
    {tab !== "input" && (!result || !current) && <div className="design-empty"><h3>{result ? "현재 입력으로 다시 계산할 차례입니다" : "비교할 계산 결과가 아직 없습니다"}</h3><p>설계 입력을 내려받아 로컬 계산을 실행하고, 생성된 report.json을 불러오세요.</p><Button onClick={() => setTab("input")}>설계 입력으로 이동</Button></div>}
    {tab === "comparison" && current && result && <DesignOutcome key={result.runId} result={result} previous={previousResult} scenarioId={scenarioId} onScenario={setScenarioId} onEdit={()=>setTab("input")} onMeeting={openMeeting} onSelectRow={onSelectRow} disabled={locked}/>}
    {tab === "meeting" && current && result && notes && <section ref={meetingTop} className="design-section design-meeting-section" aria-label="KOL 회의 브리핑">
      <header className="meeting-brief"><div><span>MEETING BRIEF</span><h3>검토한 근거를, 다음 회의의 의제로.</h3><p>설계의 차이와 미확인 항목에서 다음 질문으로 이어집니다.</p></div><div className="meeting-counts"><div><strong>{result.questions.length}</strong><span>검토 질문</span></div><div><strong>{result.questions.filter(q => latestNote(notes, q.id)?.answer.trim()).length}</strong><span>답변 기록</span></div></div></header>
      <div className="design-section-heading"><div><h3>KOL 검토 의제</h3><p className="design-help">규칙 기반 질문 {result.questions.length}개 · 답변 메모 {result.questions.filter(q => latestNote(notes, q.id)?.answer.trim()).length}개 · 전문가 답변을 자동 생성하지 않습니다.</p></div><div className="design-toolbar"><Button startIcon={<ArrowDownToLine size={16} />} disabled={locked || noteDirty} onClick={() => downloadMeeting(false)}>회의 자료 Markdown</Button><Button variant="outlined" disabled={locked || noteDirty} onClick={() => downloadMeeting(true)}>회의 JSON 저장</Button></div></div>
      <details className="meeting-disclosure"><summary>사용자가 기록하는 회의 메모 · 계산·승인과 구분</summary><p>회의 메모는 사용자 기재·미인증 기록입니다. 답변을 기록해도 계산 차단이 해제되거나 가정이 자동 변경되지 않습니다.</p></details>
      <div className="design-meeting-grid"><div className="design-question-list" aria-label="KOL 질문 목록">{result.questions.map(q => <button key={q.id} type="button" aria-pressed={questionId === q.id} disabled={locked} onClick={() => selectQuestion(q.id)}><small>{q.priority === "BEFORE_COMPARISON" ? "비교 전 선결" : "프로토콜 확정 전"} · {latestNote(notes, q.id) ? NOTE_STATUS[latestNote(notes, q.id)!.status] : "미답변"}</small><span>{q.question}</span></button>)}</div>
        <div className="design-note-editor">{currentQuestion ? <><h4>{currentQuestion.question}</h4><details className="design-help"><summary>질문이 생긴 근거·계산 조건</summary><pre>{JSON.stringify(currentQuestion.trigger, null, 2)}</pre></details><TextField select fullWidth size="small" label="사용자 메모 상태" value={note.status} disabled={locked} onChange={e => { setNote({ ...note, status: e.target.value as NoteInput["status"] }); setNoteDirty(true); }}>{Object.entries(NOTE_STATUS).map(([id, label]) => <MenuItem key={id} value={id}>{label}</MenuItem>)}</TextField>
          {([['answer', '답변 메모 · 누가 어떤 근거로 답했는지'], ['owner', '추가 확인 담당자 · 사용자 기재'], ['nextAction', '다음 행동·확인할 자료'], ['reason', '기록·수정 사유']] as const).map(([key, label]) => <TextField key={key} fullWidth multiline minRows={key === "answer" ? 3 : 1} size="small" label={label} value={note[key]} disabled={locked} slotProps={{ htmlInput: { maxLength: key === "owner" ? 200 : 2000 } }} onChange={e => { setNote({ ...note, [key]: e.target.value }); setNoteDirty(true); }} />)}
          <Button variant="contained" disabled={locked || !noteDirty || !note.reason.trim()} onClick={saveNote}>회의 메모 이력 기록</Button>{noteDirty && <p role="status" className="design-help">미기록 편집이 있습니다. 기록하거나 취소해야 회의 자료를 내보낼 수 있습니다.</p>}<Button disabled={locked || !noteDirty} onClick={() => { const n = latestNote(notes, questionId); setNote(n ? { status: n.status, answer: n.answer, owner: n.owner, nextAction: n.nextAction, reason: "" } : blankNote()); setNoteDirty(false); }}>편집 취소</Button>
          <details className="design-help"><summary>이 질문의 수정 이력</summary>{notes.revisions.filter(n => n.questionId === questionId).map(n => <article key={n.revision}><strong>r{n.revision} · {NOTE_STATUS[n.status]}</strong><p>{n.reason}</p><p>{n.answer}</p><small>{n.at} · 작성자 미인증</small></article>)}</details>
        </> : <div className="design-empty"><h4>회의에서 다룰 질문을 선택하세요</h4><p>답변·담당자·다음 행동을 기록하면 설계 비교 결과와 함께 내려받을 수 있습니다.</p></div>}</div>
      </div>
    </section>}
  </section>;
}
