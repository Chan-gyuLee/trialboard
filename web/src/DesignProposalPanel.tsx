import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Chip, CircularProgress, FormControlLabel, TextField } from "@mui/material";
import { ArrowDownToLine, Sparkles } from "lucide-react";
import type { FieldReview } from "./field-review";
import type { PdfSource } from "./pdf-contract";
import { reviewKey } from "./revalidation-result";
import { acknowledgeProposal, briefFromDraft, draftFromBrief, proposalAcknowledged, type DesignDraft } from "./design-brief";
import { PROPOSAL_STAGES, requestDesignProposal, type DesignProposal } from "./design-proposal";
import { downloadText } from "./review";
import styles from "./DesignProposalPanel.module.css";

export default function DesignProposalPanel({review, source, pdf, agentRaw, disabled, onBusy, onAdopt, onSelectRow}: {
  review: FieldReview; source: PdfSource; pdf: File | null; agentRaw?: string | null; disabled: boolean;
  onBusy: (value: boolean) => void; onAdopt: (draft: DesignDraft) => boolean; onSelectRow: (id: string) => void;
}) {
  const [objective, setObjective] = useState("모집 부담과 용량 선택의 불확실성을 비교할 표본수 대안과 민감도 가정을 검토합니다.");
  const [maximum, setMaximum] = useState("80"), [consent, setConsent] = useState(false);
  const [running, setRunning] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<DesignProposal | null>(null), [adopted, setAdopted] = useState(false);
  const [stages, setStages] = useState<(keyof typeof PROPOSAL_STAGES)[]>([]);
  const controller = useRef<AbortController | null>(null), ticket = useRef(0);
  const key = reviewKey(review, source);
  useEffect(() => {
    ticket.current++; controller.current?.abort(); setRunning(false); setResult(null); setConsent(false); setStages([]); setError("");
    return () => {ticket.current++; controller.current?.abort();};
  }, [key, pdf, agentRaw, objective, maximum]);
  useEffect(() => {onBusy(running); return () => onBusy(false);}, [running, onBusy]);
  const eligible = !!pdf && !!agentRaw && review.origin.kind === "imported_agent_report";
  async function run() {
    if (disabled || running || !consent || !pdf || !agentRaw) return;
    const task = ++ticket.current, abort = new AbortController(); controller.current = abort;
    setRunning(true); setError(""); setResult(null); setAdopted(false); setStages([]);
    const timer = setTimeout(() => abort.abort(), 135000);
    try {
      const next = await requestDesignProposal({origin: window.location.origin, consent, review, source, pdf, agentRaw,
        constraints: {objective, max_per_arm: Number(maximum)}, signal: abort.signal,
        onProgress: stage => {if (task === ticket.current) setStages(previous => [...previous, stage]);}});
      if (task === ticket.current && !abort.signal.aborted) setResult(next);
    } catch (e) {if (task === ticket.current) setError(abort.signal.aborted ? "대기를 중단했습니다. 결과는 적용하지 않으며 이미 사용한 토큰은 반환되지 않을 수 있습니다." : e instanceof Error ? e.message : "제안을 완료하지 못했습니다.");}
    finally {clearTimeout(timer); if (task === ticket.current) {controller.current=null; setRunning(false);}}
  }
  return <section className={styles.panel} aria-label="AI 설계 초안 제안">
    <header className={styles.heading}><div><span className={styles.kicker}>EVIDENCE → DESIGN</span><h3>검토한 근거로 비교 초안 만들기</h3></div><Chip size="small" label="AI 제안 · 확인 후 계산" variant="outlined" /></header>
    <p>AI가 비교 가능한 용량군을 확인하고, 표본수 2안과 민감도 가정을 제안합니다. 근거가 부족하면 필요한 자료부터 알려줍니다.</p>
    {!eligible && <Alert severity="info">PDF 자료의 에이전트 추출 결과와 필드 검토를 먼저 연결하세요. 약물 검색 결과만으로 수치 가정을 만들지는 않습니다.</Alert>}
    <div className={styles.inputs}>
      <TextField label="이번 비교에서 확인할 것" value={objective} disabled={disabled || running} onChange={e => setObjective(e.target.value)} multiline minRows={2} slotProps={{htmlInput:{maxLength:2000}}} />
      <TextField label="군당 최대 참여자 수" value={maximum} disabled={disabled || running} onChange={e => setMaximum(e.target.value)} helperText="제안 범위 제한 · 3–500명" slotProps={{htmlInput:{inputMode:"numeric", maxLength:3}}} />
    </div>
    <FormControlLabel className={styles.consent} control={<Checkbox checked={consent} disabled={disabled || running || !eligible} onChange={e => setConsent(e.target.checked)} />} label="공개·사용 허가된 자료만 사용하며, 선택 원문·검토값·비교 목표를 설정된 외부 AI에 보내 초안을 요청합니다. 최대 1회 호출합니다." />
    <div className={styles.actions}><Button variant="contained" startIcon={running ? <CircularProgress size={16} color="inherit"/> : <Sparkles size={17}/>} disabled={disabled || running || !eligible || !consent} onClick={() => void run()}>AI 비교 초안 제안</Button>
      {running && <Button onClick={() => controller.current?.abort()}>대기 중단</Button>}</div>
    {!!stages.length && <ol className={styles.progress} aria-live="polite">{stages.map((stage,i) => <li key={`${stage}-${i}`} data-active={running && i===stages.length-1}>{running && i===stages.length-1 ? PROPOSAL_STAGES[stage] : `${({REVALIDATING_EVIDENCE:"근거·비교 조건 확인",PROPOSING_HYPOTHESES:"AI 초안 요청",CHECKING_PROPOSAL:"제안 조건 검사"})[stage]} · ${i<stages.length-1 || result?.status==="AWAITING_REVIEW" ? "처리 완료" : "처리 종료 · 결과 확인"}`}</li>)}</ol>}
    {error && <Alert severity="error">{error}</Alert>}
    {result && <div className={styles.result}>
      <h4>{result.status === "AWAITING_REVIEW" ? "비교할 초안이 준비됐어요" : result.status === "NEEDS_EVIDENCE" ? "설계보다 먼저 확인할 근거가 있어요" : "제안을 검증하지 못했어요"}</h4>
      <p>{result.summary || "현재 입력에서 안전하게 사용할 초안을 만들지 못했습니다. 기존 입력은 유지됩니다."}</p>
      {result.brief && <>
        <div className={styles.plans}>{result.brief.plans.map(p => <article key={p.id}><span>{p.label}</span><strong>{p.per_arm * result.brief!.arms.length}<small>명</small></strong><span>군당 {p.per_arm}명 · 균등 배정</span><p>{p.rationale}</p></article>)}</div>
        <p className={styles.note}>아래 수치는 AI가 제안한 가정입니다. 인용 근거는 비교 맥락을 뒷받침할 뿐, 이 확률·한계의 타당성을 보증하지 않습니다.</p>
        {result.brief.scenarios.map(s => <article className={styles.scenario} key={s.id}><h4>{s.label}</h4><p>{s.rationale}</p>
          <div className={styles.table}><table><thead><tr><th>용량군</th><th>가정 반응률</th><th>가정 이상반응률</th></tr></thead><tbody>{result.brief!.arms.map((a,i) => <tr key={a.id}><th>{a.source_dose}</th><td>{(s.response[i]*100).toFixed(1)}%</td><td>{(s.adverse_event[i]*100).toFixed(1)}%</td></tr>)}</tbody></table></div>
          <p>효용 가중치 {s.adverse_event_penalty} · 이상반응 한계 {(s.maximum_adverse_event_rate*100).toFixed(1)}%</p>
          <div className={styles.actions}>{typeof s.provenance !== "string" && s.provenance.evidence_ids.map(oid => <Button size="small" key={oid} disabled={disabled} onClick={() => onSelectRow(oid)}>{oid} 근거 확인</Button>)}</div>
        </article>)}
        <Button variant="contained" disabled={disabled || adopted} onClick={() => {if (onAdopt(draftFromBrief(result.brief!))) setAdopted(true);}}>{adopted ? "설계 입력에 적용됨" : "초안을 설계 입력으로 가져오기"}</Button>
        <p className={styles.note}>기존 입력을 바꾸기 전에 확인합니다. 가져오기만으로 계산·임상 승인이 이루어지지 않습니다.</p>
      </>}
      {!!result.questions.length && <><h4>먼저 논의할 질문</h4><ul>{result.questions.map((q,i) => <li key={i}>{q}</li>)}</ul></>}
      <Button startIcon={<ArrowDownToLine size={16}/>} onClick={() => downloadText("ai-design-proposal.json", result.raw, "application/json")}>제안·실행 기록 저장</Button>
    </div>}
  </section>;
}

export function AIProposalAcknowledgement({draft, review, source, disabled, onChange}: {
  draft: DesignDraft; review: FieldReview; source: PdfSource; disabled: boolean; onChange: (draft: DesignDraft) => void;
}) {
  const [current, setCurrent] = useState(false), [error, setError] = useState("");
  const ticket = useRef(0), signature = JSON.stringify(draft), key = reviewKey(review, source);
  const hasAI = draft.scenarios.some(s => typeof s.provenance !== "string");
  useEffect(() => {const task=++ticket.current; setCurrent(false); setError("");
    if(hasAI) void briefFromDraft(draft, review, source).then(proposalAcknowledged).then(v => {if(task===ticket.current)setCurrent(v);}).catch(() => {});
    return () => {ticket.current++;};
  }, [signature, key, hasAI]);
  async function confirm() {
    if(disabled || current) return;
    const task=++ticket.current;
    try {const next=await acknowledgeProposal(await briefFromDraft(draft,review,source));
      if(task===ticket.current)onChange(draftFromBrief(next));
    } catch(e) {if(task===ticket.current)setError(e instanceof Error ? e.message : "입력을 확인하세요.");}
  }
  if(!hasAI)return null;
  return <div className={styles.acknowledgement}>
    <Alert severity={current ? "success" : "warning"}>{current ? "현재 AI 제안 입력을 확인했습니다. 계산 가능 여부는 서버에서 근거와 함께 다시 검사합니다." : "AI 제안은 확인 대기 중입니다. 표본수·확률·가중치·한계와 그 이유를 확인해야 계산할 수 있습니다. 값을 바꾸면 다시 확인해야 합니다."}</Alert>
    <FormControlLabel control={<Checkbox checked={current} disabled={disabled || current} onChange={() => void confirm()}/>} label="현재 가정과 적용 한계를 확인했으며 연구용 비교에 사용합니다. 전문가 인증·임상 승인이 아닙니다." />
    {error && <Alert severity="error">{error}</Alert>}
  </div>;
}
