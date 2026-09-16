import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Chip, Dialog, DialogTitle, DialogContent, DialogActions, FormControlLabel, MenuItem, TextField } from "@mui/material";
import { ArrowDownToLine, Check, FileInput, Link2, Plus } from "lucide-react";
import type { PdfSource, PdfSpan } from "./pdf-contract";
import { downloadText } from "./review";
import { addRow, decide, FIELD_LABELS, FIELD_NAMES, importAgentReport, locate, newReview,
  REVIEW_LIMITS, reviewMarkdown, type FieldName, type FieldReview, type ReviewRow, type Value } from "./field-review";
import "./field-review.css";
import RevalidationPanel from "./RevalidationPanel";
import RecritiquePanel from "./RecritiquePanel";
import { restoreReview, reviewBackup } from "./field-review-restore";
import DesignPanel from "./DesignPanel";
import EvidenceScopePanel from "./EvidenceScopePanel";
import type {ScoutContext} from "./evidence-scout";
import { MocFileButton } from "./MocDemo";
import { isMocSource } from "./moc-data";
import { PACKET_BYTES, restoreMeetingSession, type MeetingSession } from "./meeting-packet";
import RowReview from "./RowReview";
import SupportingCitations from './SupportingCitations';
import type {Capture,DesignCheckpoint,ReviewCheckpoint,RestoredProject} from "./project-checkpoint";

const STATUS = { unreviewed: "미확인", confirmed: "사용자 확인", corrected: "사용자 수정", held: "보류" } as const;
export default function FieldReviewPanel({ source, pdf, selected, readyPage, disabled, onChoose, onText, view = "fields", onFields, onDesign, agentHandoff, initialProject, checkpoint, onCheckpointBusy, context }: {
  source: PdfSource; selected: PdfSpan | null; readyPage: number | null; disabled: boolean;
  onChoose: (span: PdfSpan) => void; onText: () => void;
  view?: "fields" | "design"; onFields?: () => void; onDesign?: () => void;
  pdf: File | null;
  agentHandoff?: {raw:string;id:string}|null;
  initialProject?: RestoredProject|null;
  checkpoint?: Capture<ReviewCheckpoint>;
  onCheckpointBusy?:(busy:boolean)=>void;
  context?:ScoutContext;
}) {
  const [review, setReview] = useState<FieldReview>(() => newReview(source));
  const [rowId, setRowId] = useState("");
  const [name, setName] = useState<FieldName>("dose");
  const [kind, setKind] = useState<ReviewRow["valueKind"]>("event_count");
  const [proposed, setProposed] = useState<Value>({ value: null, citation: null });
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [restored, setRestored] = useState(false);
  const [meetingSession, setMeetingSession] = useState<MeetingSession | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);
  const generation = useRef(0);
  const [originalAgentRaw,setOriginalAgentRaw]=useState<string|null>(null);
  const consumedHandoff=useRef("");
  const [pendingFile,setPendingFile]=useState<{file:File;recover:boolean|"meeting"}|null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const designCheckpoint=useRef<(()=>Promise<DesignCheckpoint>)|null>(null);
  const [designBusy,setDesignBusy]=useState(false);
  const [useProjectDraft,setUseProjectDraft]=useState(true);
  useEffect(()=>{onCheckpointBusy?.(loading||designBusy);return()=>onCheckpointBusy?.(false);},[loading,designBusy,onCheckpointBusy]);
  useEffect(() => { generation.current++; setPendingFile(null); setOriginalAgentRaw(initialProject?.agentRaw??null); setReview(initialProject?.review??newReview(source)); setRowId(initialProject?.review.rows[0]?.id??""); setError(""); setNotice(initialProject?"프로젝트의 검토 이력을 복구했습니다. 사용자 확인은 임상 승인이 아닙니다.":""); setLoading(false); setRestored(!!initialProject); setMeetingSession(initialProject?.session??null); setSessionVersion(v => v + 1); return () => { generation.current++; }; }, [source,initialProject]);
  useEffect(()=>{if(agentHandoff && consumedHandoff.current!==agentHandoff.id){consumedHandoff.current=agentHandoff.id;setPendingFile({file:new File([agentHandoff.raw],"trialboard-pdf-agent.json",{type:"application/json"}),recover:false});}},[agentHandoff]);
  const row = review.rows.find(r => r.id === rowId), field = row?.fields[name];
  useEffect(() => { setProposed(field ? structuredClone(field.current) : { value: null, citation: null }); setReason(""); setChecked(false); }, [field]);
  useEffect(() => { setChecked(false); }, [selected, readyPage, disabled]);
  const locked = disabled || loading;
  const targetSpan = locate(source, proposed.citation);
  const shown = targetSpan?.box && selected?.id === targetSpan.id && readyPage === targetSpan.page;
  const touched = field && JSON.stringify(proposed) !== JSON.stringify(field.current);
  useEffect(()=>{if(!checkpoint)return;checkpoint.current=async()=>{
    if(locked||touched||reason.trim()||pendingFile||!designCheckpoint.current)throw Error("필드의 미기록 변경·사유 또는 가져오기 확인을 먼저 처리하세요.");
    const design=designCheckpoint.current();
    return {...await design,reviewRaw:reviewBackup(review,source),agentRaw:originalAgentRaw};
  };return()=>{checkpoint.current=null;};});
  const reviewed = review.rows.flatMap(r => Object.values(r.fields)).filter(f => f.decision !== "unreviewed").length;
  function selectField(id: string, key: FieldName, revealSource = true) {
    if ((id !== rowId || key !== name) && (touched || reason.trim()) && !window.confirm("기록하지 않은 변경과 사유를 버리고 다른 필드로 이동할까요?")) return false;
    setRowId(id); setName(key); setError(""); setNotice("");
    const citation = review.rows.find(r => r.id === id)?.fields[key].current.citation;
    const span = locate(source, citation ?? null); if (span && revealSource) onChoose(span);
    return true;
  }
  function create() {
    if ((touched || reason.trim()) && !window.confirm("기록하지 않은 변경과 사유를 버리고 새 관측값을 만들까요?")) return;
    try { const id = `manual-${crypto.randomUUID()}`; setReview(addRow(review, id, kind)); setRowId(id); setName("dose"); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "관측값을 만들지 못했습니다."); }
  }
  async function load(file?: File,recover:boolean|"meeting"=false){if(file&&!locked)setPendingFile({file,recover});}
  async function acceptFile() {
    const pending=pendingFile;if(!pending || locked)return;
    const {file,recover}=pending;setPendingFile(null);
    if (!file || locked) return;
    const ticket = ++generation.current; setLoading(true); setError(""); setNotice("");
    try {
      if (file.size > (recover === "meeting" ? PACKET_BYTES : REVIEW_LIMITS.bytes)) throw new Error(recover === "meeting" ? "회의 JSON은 24 MiB 이하만 지원합니다." : "결과 JSON은 2 MB 이하만 지원합니다.");
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const session = recover === "meeting" ? await restoreMeetingSession(raw, source) : null;
      const next = session?.review ?? (recover ? restoreReview(raw, source) : await importAgentReport(raw, source));
      if (ticket !== generation.current) return;
      setReview(next); setRowId(next.rows[0]?.id ?? ""); setName("dose"); setRestored(Boolean(recover));
      setOriginalAgentRaw(recover ? null : raw);
      setUseProjectDraft(false);
      setMeetingSession(session); setSessionVersion(v => v + 1);
      setProposed(next.rows[0] ? structuredClone(next.rows[0].fields.dose.current) : { value: null, citation: null }); setReason(""); setChecked(false);
      setNotice(recover ? "저장된 필드 검토를 복구했습니다. 확인·수정·보류와 사유를 그대로 유지하며, 새로운 확인이나 재검증을 수행한 것은 아닙니다."
        : "같은 PDF의 결과를 불러왔습니다. 모델의 채택 여부와 관계없이 모든 필드를 미확인으로 시작합니다.");
      if (session) onDesign?.();
    } catch (e) { if (ticket === generation.current) setError((e instanceof Error ? e.message : "결과를 읽지 못했습니다.") + " 현재 검토는 바꾸지 않았습니다."); }
    finally { if (ticket === generation.current) setLoading(false); }
  }
  function save(hold = false) {
    try {
      const action = hold ? "held" : touched ? "corrected" : "confirmed";
      setReview(decide(review, source, rowId, name, action, proposed, reason, shown ? readyPage : null, checked));
      setNotice(hold ? "보류 사유를 남겼습니다. 재검증에서는 이 필드를 포함한 관측값 전체가 제외됩니다." : "사용자 검토 이력을 남겼습니다. 임상 승인 또는 AI 재검증은 아닙니다."); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "검토를 기록하지 못했습니다."); }
  }
  function download(json: boolean) {
    if (locked || touched || reason.trim()) { setError("미기록 편집은 내보내기에 포함되지 않습니다. 먼저 변경을 기록하거나 편집을 취소하세요."); return; }
    try { downloadText(json ? "trialboard-field-review.json" : "trialboard-field-review.md",
      json ? reviewBackup(review, source) : reviewMarkdown(review, source), json ? "application/json" : "text/markdown;charset=utf-8"); }
    catch (e) { setError(e instanceof Error ? e.message : "내보내지 못했습니다."); }
  }
  return <section className="field-review" aria-label="임상 필드 확인">
    <Dialog open={!!pendingFile} onClose={()=>setPendingFile(null)} maxWidth="sm" fullWidth aria-labelledby="review-replace-title"><DialogTitle id="review-replace-title">이 기록으로 검토를 시작할까요?</DialogTitle><DialogContent><p>{pendingFile?.file.name}</p><p>현재 필드 검토·미기록 편집·설계 입력·비교 결과·회의 기록이 교체됩니다. 필요한 JSON은 먼저 내려받으세요. 원본 PDF와 원문 메모는 유지합니다.</p><Alert severity="info">파일 검사를 통과한 뒤에만 교체합니다. 새 추출 결과의 모든 필드는 미확인으로 시작합니다.</Alert></DialogContent><DialogActions><Button onClick={()=>setPendingFile(null)}>기존 작업 유지</Button><Button variant="contained" disabled={locked} onClick={()=>void acceptFile()}>확인하고 검토 시작</Button></DialogActions></Dialog>
    <div hidden={view === "design"}>
    <div className="field-title"><div><h2>필드 검토</h2><p>원문 값과 사용자 판단을 구분해서 남깁니다.</p></div><Chip size="small" label={`${reviewed} / ${review.rows.length * FIELD_NAMES.length} 검토 기록`} /></div>
    <div className="field-toolbar"><Button component="label" variant="outlined" startIcon={<FileInput size={16} />} disabled={locked}>추출 결과 불러오기<input className="file-input" type="file" accept=".json,application/json" onChange={e => { void load(e.target.files?.[0]); e.target.value = ""; }} /></Button>
      <Button component="label" variant="outlined" startIcon={<FileInput size={16} />} disabled={locked}>저장한 검토 이어하기<input className="file-input" type="file" accept=".json,application/json" onChange={e => { void load(e.target.files?.[0], true); e.target.value = ""; }} /></Button>
      <Button component="label" variant="outlined" startIcon={<FileInput size={16} />} disabled={locked}>회의 파일로 전체 검토 복구<input className="file-input" type="file" accept=".json,application/json" onChange={e => { void load(e.target.files?.[0], "meeting"); e.target.value = ""; }} /></Button>
      <Button disabled={!review.rows.length || locked || Boolean(touched || reason.trim())} onClick={() => download(false)} startIcon={<ArrowDownToLine size={16} />}>검토 메모</Button><Button disabled={!review.rows.length || locked || Boolean(touched || reason.trim())} onClick={() => download(true)}>이력 JSON</Button></div>
    {Boolean(touched || reason.trim()) && <Alert severity="warning">아직 기록하지 않은 편집이 있어 내보내기를 잠갔습니다. 아래에서 변경을 기록하거나 편집을 취소하세요.</Alert>}
    <p className="field-origin">회의 JSON이 있으면 같은 PDF를 연 뒤 ‘회의 파일로 전체 검토 복구’를 선택하세요. 당시 필드 검토·설계·결과·KOL 기록을 함께 복구합니다. PDF 원문 메모·미기록 편집·로컬 계산 첨부 파일은 포함하지 않습니다.</p>
    <p className="field-origin">자동 저장하지 않습니다. 마치기 전에 ‘이력 JSON’을 내려받고, 다음에는 같은 PDF를 연 뒤 ‘저장한 검토 이어하기’를 누르세요.</p>
    {isMocSource(source) && <div className="moc-samples"><MocFileButton name="original-agent.json" disabled={locked} onFile={file => load(file)}>MOC 추출 기록 열기</MocFileButton><MocFileButton name="review.json" disabled={locked} onFile={file => load(file, true)}>MOC 검토 예제 이어가기</MocFileButton><p>추출은 스크립트 출력입니다. 검토 예제의 확인 이력은 자동 테스트 기록이며 실제 사람·전문가의 승인이 아닙니다.</p></div>}
    <details className="field-help"><summary>추출 결과와 저장한 검토는 어떻게 다른가요?</summary><p>‘추출 결과 불러오기’는 같은 PDF의 에이전트 3.2 결과로 새 검토를 시작하며 모든 필드는 미확인입니다. 파일 가져오기 자체는 AI를 호출하지 않습니다. 새 실행은 ‘02 에이전트 검토’에서 별도로 동의한 뒤 시작합니다.</p><p>‘저장한 검토 이어하기’는 내려받은 이력 JSON의 원래 값·수정값·사유·상태를 복구합니다. 원문 메모, 미기록 편집, AI 원본 파일, 재검증 결과는 복구하지 않습니다. 재검증 결과는 아래에서 별도로 불러오세요.</p><p>에이전트 화면에서 인계한 원본 실행은 현재 세션의 설계 계산에 자동 연결됩니다. 재시작 후 복구할 때도 필요하므로 원본 실행 JSON을 함께 보관하세요.</p></details>
    <div aria-live="polite">{loading && <p role="status">PDF와 결과의 출처를 대조하는 중…</p>}{error && <Alert severity="error">{error}</Alert>}{notice && <Alert severity="info">{notice}</Alert>}</div>
    {restored && <Alert severity="warning">복구한 사용자 기록 · 작성자와 실행 진위 미인증. PDF hash·인용 위치·이력의 내부 일관성만 확인했습니다. 기록을 일관되게 바꾼 위조나 실제 원문 대조 여부는 판별하지 못합니다. 모델 원래 값은 로컬 재검증 시 원본 결과 파일과 대조해야 합니다.</Alert>}
    {review.origin.kind === "imported_agent_report" && <p className="field-origin">{review.origin.mode === "SCRIPTED_TEST_DOUBLE" ? "스크립트 테스트 결과 · 실제 AI 실행 아님" : "가져온 에이전트 결과 · 실행 진위 미인증"}<br />원문 파일·추출 문구 일치만 확인했습니다.</p>}
    <div className="field-add"><TextField select size="small" label="새 관측값의 자료 유형" value={kind} disabled={locked} onChange={e => setKind(e.target.value as ReviewRow["valueKind"])}><MenuItem value="event_count">사건 수와 분모</MenuItem><MenuItem value="reported_percentage">보고된 비율 · 건수 미보고</MenuItem></TextField><Button onClick={create} disabled={locked || review.rows.length >= 12} startIcon={<Plus size={16} />}>관측값 추가</Button></div>
    {!review.rows.length && <div className="field-empty"><h3>검토할 관측값부터 만드세요</h3><p>예: 한 용량·한 환자군의 반응률. 서로 다른 환자군이나 시점은 별도의 관측값으로 남깁니다.</p><p>필드를 선택한 뒤 ‘원문 문구’에서 근거를 찾아 연결하거나, 같은 PDF의 추출 결과를 불러오세요.</p></div>}
    {review.rows.length > 0 && <>
      <EvidenceScopePanel review={review} source={source} context={context} disabled={locked||Boolean(touched||reason.trim())} onSelect={(id,key)=>{if(selectField(id,key))requestAnimationFrame(()=>editor.current?.scrollIntoView({block:"center",behavior:"smooth"}));}}/>
      <TextField select fullWidth size="small" label="검토할 관측값" value={rowId} disabled={locked} onChange={e => selectField(e.target.value, name)}>{review.rows.map((r, i) => <MenuItem key={r.id} value={r.id}>{i + 1}. {r.fields.dose.current.value ?? "용량 미보고"} · {r.fields.metric.current.value ?? "지표 미입력"} · {r.fields.population.current.value ?? "집단 미입력"}</MenuItem>)}</TextField>
      {row && <p className="field-origin">이 관측값: {row.origin === "manual" ? "사용자 직접 추가" : "에이전트 결과에서 가져옴"}</p>}
      {row && <RowReview key={JSON.stringify({row,readyPage})} review={review} source={source} rowId={row.id} readyPage={readyPage} disabled={locked || Boolean(touched || reason.trim())} onReview={next=>{setReview(next);setNotice("보고된 필드에 사용자 확인 이력을 기록했습니다. 미보고는 유지하며 계산 전 재검증이 필요합니다.");}}/>}
      <div className="field-list" aria-label="필드 목록">{row && FIELD_NAMES.map(key => { const f = row.fields[key]; return <button type="button" key={key} disabled={locked} aria-pressed={name === key} onClick={() => selectField(row.id, key)}><span>{FIELD_LABELS[key]}<small>{STATUS[f.decision]}</small></span><strong>{f.current.value ?? "미보고"}</strong></button>; })}</div>
      {field && <div className="field-editor" ref={editor} tabIndex={-1}><h3>{FIELD_LABELS[name]} 확인</h3><p className="field-original-value">원래 값: {field.original.value ?? "미보고"}</p>
        <TextField fullWidth multiline maxRows={4} label="검토할 원문 값" value={proposed.value ?? ""} disabled={locked} onChange={e => { setProposed({ ...proposed, value: e.target.value || null }); setChecked(false); }} slotProps={{ htmlInput: { maxLength: 2000 } }} />
        <div className="field-citation">{proposed.citation ? <><p>연결 근거 · PDF p.{proposed.citation.page}</p><blockquote>{proposed.citation.quote}</blockquote><Button disabled={!targetSpan || locked} onClick={() => { if (targetSpan) onChoose(targetSpan); }}>원문 위치 열기</Button></> : <p>연결된 근거가 없습니다. 원문 문구에서 이 값을 뒷받침하는 문구를 선택하세요.</p>}</div>
        <div className="field-toolbar"><Button onClick={onText} disabled={locked}>원문 문구 찾기</Button><Button startIcon={<Link2 size={16} />} disabled={!selected?.box || locked} onClick={() => { if (proposed.supporting?.length) {setError('기본 근거를 바꾸려면 보조 근거 연결을 먼저 제거하세요.');return;} if (selected) { setProposed({ value: proposed.value ?? selected.text, citation: { spanId: selected.id, page: selected.page, quote: selected.text } }); setChecked(false); } }}>선택 문구를 근거로 연결</Button></div>
        <SupportingCitations key={`${rowId}-${name}`} source={source} value={proposed} selected={selected} disabled={locked} onChange={value=>{setProposed(value);setChecked(false);}} onChoose={onChoose} onText={onText}/>
        <p className="field-selected">현재 선택: {selected?.text ?? "없음"}</p>
        <TextField fullWidth multiline minRows={2} label="확인·수정·보류 사유" value={reason} disabled={locked} onChange={e => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 2000 } }} />
        <FormControlLabel control={<Checkbox checked={checked} disabled={!shown || locked} onChange={e => setChecked(e.target.checked)} />} label={proposed.supporting?.length ? "원문에서 값·필드와 모든 보조 근거의 관계를 직접 대조했습니다." : "원문에서 이 값과 필드의 관계를 직접 대조했습니다."} />
        <div className="field-toolbar"><Button variant="contained" startIcon={<Check size={16} />} disabled={!shown || !checked || !reason.trim() || locked} onClick={() => save()}>{touched ? "수정값 기록" : "확인 기록"}</Button><Button color="warning" disabled={!reason.trim() || locked} onClick={() => save(true)}>보류 기록</Button></div>
        {(touched || reason.trim()) && <><p role="status">아직 기록하지 않은 변경이 있습니다. 기록하거나 편집을 취소해야 내보낼 수 있습니다.</p><Button onClick={() => { setProposed(structuredClone(field.current)); setReason(""); setChecked(false); }} disabled={locked}>편집 취소</Button></>}
        {field.history.length > 0 && <details><summary>이 필드의 검토 이력 {field.history.length}개</summary><ol>{field.history.map(h => <li key={h.revision}><strong>{STATUS[h.decision]}</strong> · {h.before.value ?? "미보고"} → {h.after.value ?? "미보고"}<p>{h.reason}</p></li>)}</ol></details>}
      </div>}
      <RevalidationPanel review={review} source={source} disabled={locked} hasDraft={Boolean(touched || reason.trim())} onSelect={(id, key) => {
        if (selectField(id, key ?? "dose", key !== null)) requestAnimationFrame(() => { editor.current?.focus(); editor.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); });
      }} />
      <RecritiquePanel review={review} source={source} disabled={locked} hasDraft={Boolean(touched || reason.trim())} onChoose={onChoose} onSelectRow={id => {
        if (selectField(id, "dose", false)) requestAnimationFrame(() => { editor.current?.focus(); editor.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); });
      }} />
      {review.modelFindings.length > 0 && <details className="field-help"><summary>최초 모델 실행 당시의 쟁점 {review.modelFindings.length}개 · 과거 기록</summary><ul>{review.modelFindings.map((f, i) => <li key={i}>{f}</li>)}</ul></details>}
      <Alert severity="warning">이 기록은 사용자 확인 초안입니다. 결과 가져오기는 AI 실행·설계 계산·임상 승인이 아닙니다.</Alert>
    </>}
    </div>
    <div hidden={view !== "design"}><DesignPanel context={context} key={sessionVersion} initialSession={meetingSession} initialDraft={useProjectDraft?initialProject?.draft:undefined} checkpoint={designCheckpoint} onCheckpointBusy={setDesignBusy} originalAgentRaw={originalAgentRaw} review={review} source={source} pdf={pdf} disabled={locked} hasDraft={Boolean(touched || reason.trim())} onSelectRow={(id,key="dose") => {
      if (selectField(id, key, true)) { onFields?.(); requestAnimationFrame(() => { editor.current?.focus(); editor.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }); }
    }} /></div>
  </section>;
}
