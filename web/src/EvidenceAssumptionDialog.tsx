import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, TextField } from "@mui/material";
import type { FieldReview } from "./field-review";
import type { PdfSource } from "./pdf-contract";
import type { DesignDraft } from "./design-brief";
import { assumptionEvidence, recordEvidenceAssumption, type AssumptionChoice } from "./evidence-assumption";

export default function EvidenceAssumptionDialog({draft,review,source,scenarioId,disabled,onChange}: {
  draft: DesignDraft; review: FieldReview; source: PdfSource; scenarioId: string; disabled: boolean; onChange: (draft: DesignDraft) => void;
}) {
  const [open,setOpen] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState("");
  const [choice,setChoice] = useState<AssumptionChoice>({armId:"",observationId:"",metric:"response",value:"",reason:"",acknowledged:false});
  const ticket = useRef(0);
  useEffect(() => () => {ticket.current++;},[]);
  useEffect(() => { if(disabled) {ticket.current++;setOpen(false);setBusy(false);} },[disabled]);
  const arm = draft.arms.find(a => a.id === choice.armId);
  const row = review.rows.find(r => r.id === choice.observationId);
  let blocked = "용량군과 연결 관측값을 선택하세요.";
  if (arm && row) {try {assumptionEvidence(draft,review,source,arm.id,row.id);blocked="";} catch(e) {blocked=e instanceof Error?e.message:"근거를 확인하세요.";}}
  const patch = (p: Partial<AssumptionChoice>) => {setChoice(c=>({...c,...p,acknowledged:false}));setError("");};
  const close = () => {ticket.current++;setOpen(false);setBusy(false);};
  async function save() {
    if(disabled || busy || blocked) return;
    const t=++ticket.current;setBusy(true);setError("");
    try {const next=await recordEvidenceAssumption(draft,review,source,scenarioId,choice);if(ticket.current===t) {onChange(next);close();}}
    catch(e) {if(ticket.current===t) setError(e instanceof Error?e.message:"가정을 기록하지 못했습니다.");}
    finally {if(ticket.current===t) setBusy(false);}
  }
  return <><Button variant="outlined" disabled={disabled || !draft.arms.length} onClick={()=>{setOpen(true);setError("");}}>근거를 보며 가정 변경</Button>
    <Dialog open={open} onClose={close} maxWidth="md" fullWidth aria-labelledby="assumption-link-title">
      <DialogTitle id="assumption-link-title">어떤 근거를 보고 가정을 바꾸나요?</DialogTitle>
      <DialogContent className="evidence-assumption-dialog">
        <Alert severity="info">원문 수치를 자동으로 확률에 넣지 않습니다. 적용할 가정값과 이유를 직접 입력하세요. 저장하면 이전 계산은 현재 결과가 아니게 됩니다.</Alert>
        {review.origin.mode === "SCRIPTED_TEST_DOUBLE" && <Alert severity="warning">MOC · 스크립트 시연 자료입니다. 실제 사람의 검토나 AI 성능 검증으로 해석하지 마세요.</Alert>}
        <div className="design-card-grid"><TextField select fullWidth label="변경할 용량군" value={choice.armId} disabled={busy} onChange={e=>patch({armId:e.target.value,observationId:""})}>{draft.arms.map(a=><MenuItem key={a.id} value={a.id}>{a.source_dose}</MenuItem>)}</TextField>
          <TextField select fullWidth label="참고할 연결 관측값" value={choice.observationId} disabled={busy || !arm} onChange={e=>patch({observationId:e.target.value})}>{review.rows.filter(r=>arm?.observation_ids.includes(r.id)).map(r=><MenuItem key={r.id} value={r.id}>{r.id} · {r.fields.metric.current.value ?? "미보고"}</MenuItem>)}</TextField></div>
        {row && <section className="assumption-source"><h3>원문에서 확인한 내용</h3><dl><dt>지표 / 정의</dt><dd>{row.fields.metric.current.value} / {row.fields.definition.current.value}</dd><dt>집단 / 기간</dt><dd>{row.fields.population.current.value} / {row.fields.window.current.value}</dd><dt>관측값</dt><dd>{row.valueKind === "event_count" ? `사건 수 ${row.fields.events.current.value} / 분모 ${row.fields.denominator.current.value} · 집계 단위는 원문 확인` : row.fields.reported_rate.current.value}</dd></dl><blockquote>{row.fields[row.valueKind === "event_count" ? "denominator" : "reported_rate"].current.citation?.quote ?? "인용 없음"}</blockquote></section>}
        {blocked && <Alert severity="warning">{blocked}</Alert>}
        <div className="design-card-grid"><TextField select fullWidth label="적용할 가정 지표 · 직접 대응 확인" value={choice.metric} disabled={busy} onChange={e=>patch({metric:e.target.value as AssumptionChoice["metric"]})}><MenuItem value="response">반응 확률</MenuItem><MenuItem value="adverse_event">이상반응 확률</MenuItem></TextField>
          <TextField fullWidth label="새 가정 확률 · 0–1" value={choice.value} disabled={busy} onChange={e=>patch({value:e.target.value})} slotProps={{htmlInput:{inputMode:"decimal",maxLength:20}}} helperText={`기존 입력: ${draft.scenarios.find(s=>s.id===scenarioId)?.[choice.metric][draft.arms.findIndex(a=>a.id===choice.armId)] || "미입력"} · 예: 30%는 0.30`} /></div>
        <TextField fullWidth multiline minRows={3} label="왜 이 값인가요? 적용 이유·불확실성·확인할 범위" value={choice.reason} disabled={busy} onChange={e=>patch({reason:e.target.value})} slotProps={{htmlInput:{maxLength:700}}} />
        <FormControlLabel control={<Checkbox checked={choice.acknowledged} disabled={busy || !!blocked} onChange={e=>setChoice(c=>({...c,acknowledged:e.target.checked}))}/>} label="원문 지표와 가정 지표의 대응을 확인했으며, 이 값은 관측 참값이 아닌 검토용 가정임을 확인합니다." />
        <p className="design-help">출처·검토 버전·변경 전후·이유를 기존 ‘가정의 근거’에 추가합니다. 이후 직접 편집할 수 있는 사용자 기록이며 불변 감사 로그가 아닙니다. 계산 때 전체 근거를 다시 검증합니다.</p>
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent><DialogActions><Button onClick={close}>변경하지 않고 닫기</Button><Button variant="contained" disabled={disabled || busy || !!blocked || !choice.acknowledged || !choice.value || choice.reason.trim().length<5} onClick={()=>void save()}>{busy?"현재 검토에 연결 중…":"출처와 이유를 남기고 변경"}</Button></DialogActions>
    </Dialog></>;
}
