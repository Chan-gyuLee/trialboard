import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Chip, FormControlLabel, MenuItem, TextField } from "@mui/material";
import { ArrowDownToLine, Check, FileInput, Link2, Plus } from "lucide-react";
import type { PdfSource, PdfSpan } from "./pdf-contract";
import { downloadText } from "./review";
import { addRow, decide, FIELD_LABELS, FIELD_NAMES, importAgentReport, locate, newReview,
  REVIEW_LIMITS, reviewMarkdown, type FieldName, type FieldReview, type ReviewRow, type Value } from "./field-review";
import "./field-review.css";
import RevalidationPanel from "./RevalidationPanel";
import RecritiquePanel from "./RecritiquePanel";
import { restoreReview, reviewBackup } from "./field-review-restore";

const STATUS = { unreviewed: "미확인", confirmed: "사용자 확인", corrected: "사용자 수정", held: "보류" } as const;
export default function FieldReviewPanel({ source, selected, readyPage, disabled, onChoose, onText }: {
  source: PdfSource; selected: PdfSpan | null; readyPage: number | null; disabled: boolean;
  onChoose: (span: PdfSpan) => void; onText: () => void;
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
  const generation = useRef(0);
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => { generation.current++; setReview(newReview(source)); setRowId(""); setError(""); setNotice(""); setLoading(false); setRestored(false); return () => { generation.current++; }; }, [source]);
  const row = review.rows.find(r => r.id === rowId), field = row?.fields[name];
  useEffect(() => { setProposed(field ? structuredClone(field.current) : { value: null, citation: null }); setReason(""); setChecked(false); }, [field]);
  useEffect(() => { setChecked(false); }, [selected, readyPage, disabled]);
  const locked = disabled || loading;
  const targetSpan = locate(source, proposed.citation);
  const shown = targetSpan?.box && selected?.id === targetSpan.id && readyPage === targetSpan.page;
  const touched = field && JSON.stringify(proposed) !== JSON.stringify(field.current);
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
  async function load(file?: File, recover = false) {
    if (!file || locked) return;
    if (review.rows.length && !window.confirm("현재 필드 검토를 바꿉니다. 필요한 기록은 먼저 내려받아 주세요.")) return;
    const ticket = ++generation.current; setLoading(true); setError(""); setNotice("");
    try {
      if (file.size > REVIEW_LIMITS.bytes) throw new Error("결과 JSON은 2 MB 이하만 지원합니다.");
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const next = recover ? restoreReview(raw, source) : await importAgentReport(raw, source);
      if (ticket !== generation.current) return;
      setReview(next); setRowId(next.rows[0]?.id ?? ""); setName("dose"); setRestored(recover);
      setProposed(next.rows[0] ? structuredClone(next.rows[0].fields.dose.current) : { value: null, citation: null }); setReason(""); setChecked(false);
      setNotice(recover ? "저장된 필드 검토를 복구했습니다. 확인·수정·보류와 사유를 그대로 유지하며, 새로운 확인이나 재검증을 수행한 것은 아닙니다."
        : "같은 PDF의 결과를 불러왔습니다. 모델의 채택 여부와 관계없이 모든 필드를 미확인으로 시작합니다.");
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
    try { downloadText(json ? "trialboard-field-review.json" : "trialboard-field-review.md",
      json ? reviewBackup(review, source) : reviewMarkdown(review, source), json ? "application/json" : "text/markdown;charset=utf-8"); }
    catch (e) { setError(e instanceof Error ? e.message : "내보내지 못했습니다."); }
  }
  return <section className="field-review" aria-label="임상 필드 확인">
    <div className="field-title"><div><h2>필드 검토</h2><p>원문 값과 사용자 판단을 구분해서 남깁니다.</p></div><Chip size="small" label={`${reviewed} / ${review.rows.length * FIELD_NAMES.length} 검토 기록`} /></div>
    <div className="field-toolbar"><Button component="label" variant="outlined" startIcon={<FileInput size={16} />} disabled={locked}>추출 결과 불러오기<input className="file-input" type="file" accept=".json,application/json" onChange={e => { void load(e.target.files?.[0]); e.target.value = ""; }} /></Button>
      <Button component="label" variant="outlined" startIcon={<FileInput size={16} />} disabled={locked}>저장한 검토 이어하기<input className="file-input" type="file" accept=".json,application/json" onChange={e => { void load(e.target.files?.[0], true); e.target.value = ""; }} /></Button>
      <Button disabled={!review.rows.length || locked} onClick={() => download(false)} startIcon={<ArrowDownToLine size={16} />}>검토 메모</Button><Button disabled={!review.rows.length || locked} onClick={() => download(true)}>이력 JSON</Button></div>
    <p className="field-origin">자동 저장하지 않습니다. 마치기 전에 ‘이력 JSON’을 내려받고, 다음에는 같은 PDF를 연 뒤 ‘저장한 검토 이어하기’를 누르세요.</p>
    <details className="field-help"><summary>추출 결과와 저장한 검토는 어떻게 다른가요?</summary><p>‘추출 결과 불러오기’는 같은 PDF의 에이전트 3.2 결과로 새 검토를 시작하며 모든 필드는 미확인입니다. 결과가 없어도 아래에서 직접 관측값을 만들 수 있습니다. 웹에서 AI를 호출하지 않습니다.</p><p>‘저장한 검토 이어하기’는 내려받은 이력 JSON의 원래 값·수정값·사유·상태를 복구합니다. 원문 메모, 미기록 편집, AI 원본 파일, 재검증 결과는 복구하지 않습니다. 재검증 결과는 아래에서 별도로 불러오세요.</p><p>에이전트 실행에는 ‘원문 문구’에서 내려받은 추출 원문 포함 JSON이 필요합니다. AI 결과를 가져온 검토는 로컬 재검증 시 원래 에이전트 결과 파일도 필요하므로 함께 보관하세요.</p></details>
    <div aria-live="polite">{loading && <p role="status">PDF와 결과의 출처를 대조하는 중…</p>}{error && <Alert severity="error">{error}</Alert>}{notice && <Alert severity="info">{notice}</Alert>}</div>
    {restored && <Alert severity="warning">복구한 사용자 기록 · 작성자와 실행 진위 미인증. PDF hash·인용 위치·이력의 내부 일관성만 확인했습니다. 기록을 일관되게 바꾼 위조나 실제 원문 대조 여부는 판별하지 못합니다. 모델 원래 값은 로컬 재검증 시 원본 결과 파일과 대조해야 합니다.</Alert>}
    {review.origin.kind === "imported_agent_report" && <p className="field-origin">{review.origin.mode === "SCRIPTED_TEST_DOUBLE" ? "스크립트 테스트 결과 · 실제 AI 실행 아님" : "가져온 에이전트 결과 · 실행 진위 미인증"}<br />원문 파일·추출 문구 일치만 확인했습니다.</p>}
    <div className="field-add"><TextField select size="small" label="새 관측값의 자료 유형" value={kind} disabled={locked} onChange={e => setKind(e.target.value as ReviewRow["valueKind"])}><MenuItem value="event_count">사건 수와 분모</MenuItem><MenuItem value="reported_percentage">보고된 비율 · 건수 미보고</MenuItem></TextField><Button onClick={create} disabled={locked || review.rows.length >= 12} startIcon={<Plus size={16} />}>관측값 추가</Button></div>
    {!review.rows.length && <div className="field-empty"><h3>검토할 관측값부터 만드세요</h3><p>예: 한 용량·한 환자군의 반응률. 서로 다른 환자군이나 시점은 별도의 관측값으로 남깁니다.</p><p>필드를 선택한 뒤 ‘원문 문구’에서 근거를 찾아 연결하거나, 같은 PDF의 추출 결과를 불러오세요.</p></div>}
    {review.rows.length > 0 && <>
      <TextField select fullWidth size="small" label="검토할 관측값" value={rowId} disabled={locked} onChange={e => selectField(e.target.value, name)}>{review.rows.map((r, i) => <MenuItem key={r.id} value={r.id}>{i + 1}. {r.fields.dose.current.value ?? "용량 미보고"} · {r.fields.metric.current.value ?? "지표 미입력"} · {r.fields.population.current.value ?? "집단 미입력"}</MenuItem>)}</TextField>
      {row && <p className="field-origin">이 관측값: {row.origin === "manual" ? "사용자 직접 추가" : "에이전트 결과에서 가져옴"}</p>}
      <div className="field-list" aria-label="필드 목록">{row && FIELD_NAMES.map(key => { const f = row.fields[key]; return <button type="button" key={key} disabled={locked} aria-pressed={name === key} onClick={() => selectField(row.id, key)}><span>{FIELD_LABELS[key]}<small>{STATUS[f.decision]}</small></span><strong>{f.current.value ?? "미보고"}</strong></button>; })}</div>
      {field && <div className="field-editor" ref={editor} tabIndex={-1}><h3>{FIELD_LABELS[name]} 확인</h3><p className="field-original-value">원래 값: {field.original.value ?? "미보고"}</p>
        <TextField fullWidth multiline maxRows={4} label="검토할 원문 값" value={proposed.value ?? ""} disabled={locked} onChange={e => { setProposed({ ...proposed, value: e.target.value || null }); setChecked(false); }} slotProps={{ htmlInput: { maxLength: 2000 } }} />
        <div className="field-citation">{proposed.citation ? <><p>연결 근거 · PDF p.{proposed.citation.page}</p><blockquote>{proposed.citation.quote}</blockquote><Button disabled={!targetSpan || locked} onClick={() => { if (targetSpan) onChoose(targetSpan); }}>원문 위치 열기</Button></> : <p>연결된 근거가 없습니다. 원문 문구에서 이 값을 뒷받침하는 문구를 선택하세요.</p>}</div>
        <div className="field-toolbar"><Button onClick={onText} disabled={locked}>원문 문구 찾기</Button><Button startIcon={<Link2 size={16} />} disabled={!selected?.box || locked} onClick={() => { if (selected) { setProposed({ value: proposed.value ?? selected.text, citation: { spanId: selected.id, page: selected.page, quote: selected.text } }); setChecked(false); } }}>선택 문구를 근거로 연결</Button></div>
        <p className="field-selected">현재 선택: {selected?.text ?? "없음"}</p>
        <TextField fullWidth multiline minRows={2} label="확인·수정·보류 사유" value={reason} disabled={locked} onChange={e => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 2000 } }} />
        <FormControlLabel control={<Checkbox checked={checked} disabled={!shown || locked} onChange={e => setChecked(e.target.checked)} />} label="원문에서 이 값과 필드의 관계를 직접 대조했습니다." />
        <div className="field-toolbar"><Button variant="contained" startIcon={<Check size={16} />} disabled={!shown || !checked || !reason.trim() || locked} onClick={() => save()}>{touched ? "수정값 기록" : "확인 기록"}</Button><Button color="warning" disabled={!reason.trim() || locked} onClick={() => save(true)}>보류 기록</Button></div>
        {(touched || reason.trim()) && <><p role="status">아직 기록하지 않은 변경이 있습니다. 내보내기에는 마지막으로 기록한 값만 포함됩니다.</p><Button onClick={() => { setProposed(structuredClone(field.current)); setReason(""); setChecked(false); }} disabled={locked}>편집 취소</Button></>}
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
  </section>;
}
