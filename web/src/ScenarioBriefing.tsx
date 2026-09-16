import { MocBadge } from "./MocDemo";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Chip, CircularProgress, InputAdornment, TextField } from "@mui/material";
import { ArrowDownToLine, ArrowRight, FlaskConical, RotateCcw } from "lucide-react";
import { downloadText, executeReview, percent } from "./review";
import { bindStressResult, INITIAL_STRESS, stressDelta, stressError, stressInput, stressMarkdown, stressQuestions, type StressComparison } from "./scenario-briefing";
import "./scenario-briefing.css";

export function ScenarioBriefing({ active, onBack, onAdvanced }: { active: boolean; onBack: () => void; onAdvanced: () => void }) {
  const [draft, setDraft] = useState({ ...INITIAL_STRESS });
  const [result, setResult] = useState<StressComparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { if (!active) controller.current?.abort(); return () => controller.current?.abort(); }, [active]);
  const invalid = stressError(draft);
  const dirty = !!result && (!!invalid || Number(draft.aeA) / 100 !== result.execution.input.scenarios[1].adverse_event[0] || Number(draft.aeB) / 100 !== result.execution.input.scenarios[1].adverse_event[1]);
  async function run() {
    if (controller.current || invalid) return;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setError("");
    const timeout = setTimeout(() => abort.abort(), 30000);
    try {
      const input = stressInput(draft);
      const execution = await executeReview(input, abort.signal);
      if (!abort.signal.aborted) setResult(bindStressResult(execution, input));
    } catch (e) {
      setError(abort.signal.aborted ? "계산 요청이 중단되었거나 대기 시간이 초과되었습니다. 새 결과는 반영하지 않았습니다." : e instanceof Error ? e.message : "계산하지 못했습니다.");
    } finally { clearTimeout(timeout); controller.current = null; setBusy(false); }
  }
  return <section className="sb" aria-label="설계 스트레스 테스트">
    <MocBadge detail="합성 가정 · 로컬 시뮬레이션 · KOL 질문은 규칙 기반" />
    <div className="sb-boundary"><FlaskConical size={20} /><div><strong>여기부터는 별도의 합성 설계 사례입니다.</strong><p>앞에서 본 공개 근거는 계산에 넘기지 않습니다. 가정은 사람이 지정하고, 엔진은 재계산하며, 질문은 규칙으로 구성합니다.</p></div></div>
    <div className="sb-title"><div><span className="ab-eyebrow">WHAT IF / 설계 의사결정 리허설</span><h2>독성 우려가 커지면,<br /> 더 많은 환자가 답일까요?</h2></div><Chip variant="outlined" label="실제 계산 · 새 AI 호출 없음" /></div>
    <div className="sb-grid">
      <section className="sb-editor" aria-label="변경할 합성 가정"><span className="sb-step">01 · 가정 변경</span><h3>이상반응 확률을 높여보세요</h3><p>기준 A 12% · B 25%<br />반응 확률 A 30% · B 32%는 유지합니다.</p>
        <form onSubmit={e => { e.preventDefault(); void run(); }}>
          <div className="sb-inputs">{(["aeA", "aeB"] as const).map((key, i) => <TextField key={key} label={`용량 ${i ? "B" : "A"} 이상반응`} value={draft[key]} disabled={busy} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} slotProps={{ htmlInput: { inputMode: "decimal" }, input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } }} />)}</div>
          <div className="sb-presets"><Button size="small" disabled={busy} onClick={() => setDraft({ ...INITIAL_STRESS })}>두 군 모두 독성 우려</Button><Button size="small" disabled={busy} onClick={() => setDraft({ aeA: "12", aeB: "45" })}>B만 독성 우려</Button></div>
          <p className="sb-fixed">이상반응 한계 35% · 독성 가중치 0.7<br />설계 1: 총 60명 / 설계 2: 총 120명</p>
          {invalid && <Alert severity="warning">{invalid}</Alert>}
          <Button type="submit" fullWidth variant="contained" disabled={busy || !!invalid || !import.meta.env.DEV} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <RotateCcw size={17} />}>{busy ? "두 가정 × 두 설계 계산 중" : "두 설계 재계산"}</Button>
          {busy && <Button onClick={() => controller.current?.abort()}>계산 요청 중단</Button>}
          <small>{import.meta.env.DEV ? "로컬 계산 · 각 조합 10,000회 · 자동 실행 안 함" : "로컬 시연에서만 재계산할 수 있습니다."}</small>
        </form>
      </section>
      <section className="sb-results" aria-label="가정 변경 전후 결과" aria-busy={busy}>
        <div className="sb-result-heading"><span className="sb-step">02 · 설계 비교</span>{result && <Chip size="small" label={busy || dirty || error ? "이전 계산 · 새 결과 아님" : "이번 조건 계산 완료"} />}</div>
        <div aria-live="polite">{error && <Alert severity="error">{error}</Alert>}{dirty && <Alert severity="warning">조건을 수정했습니다. 아래 결과와 질문은 변경 전 계산입니다. 다시 계산하세요.</Alert>}</div>
        {!result ? <div className="sb-empty"><h3>표본수는 늘려도,<br />가정한 독성 자체는 바뀌지 않습니다.</h3><p>왼쪽에서 재계산하면 선택 보류와 한계 초과 군 선택 빈도가 두 설계에서 어떻게 달라지는지 확인할 수 있습니다.</p><span>아직 실행한 결과 없음 · 예제 성공 화면으로 대체하지 않음</span></div> : <>
          <p className="sb-result-context">기준 A 12% / B 25% → 변경 A {percent(result.execution.input.scenarios[1].adverse_event[0])} / B {percent(result.execution.input.scenarios[1].adverse_event[1])}</p>
          <div className="sb-designs">{result.plans.map(({ before, after }, i) => <article key={after.design.id}><div className="sb-design-label"><span>설계 {i + 1}</span><strong>총 {after.total_sample_size}명</strong></div><p>각 군 {after.design.per_arm}명 · 1:1 배정</p><div className="sb-hero-metric"><span>변경 후 선택 보류</span><strong>{percent(after.no_selection_probability)}</strong><small>기준 {percent(before.no_selection_probability)} <ArrowRight size={13} /> {stressDelta(after.no_selection_probability - before.no_selection_probability)}</small></div>
            <div className="sb-stacked" role="img" aria-label={`변경 후 용량 A 선택 ${percent(after.selection_probability.dose_a)}, B 선택 ${percent(after.selection_probability.dose_b)}, 보류 ${percent(after.no_selection_probability)}`}><i style={{ width: `${after.selection_probability.dose_a * 100}%` }} /><i style={{ width: `${after.selection_probability.dose_b * 100}%` }} /><i style={{ width: `${after.no_selection_probability * 100}%` }} /></div><div className="sb-legend"><span>A {percent(after.selection_probability.dose_a)}</span><span>B {percent(after.selection_probability.dose_b)}</span><span>보류 {percent(after.no_selection_probability)}</span></div>
            <div className="sb-risk"><span>한계 초과 군 선택</span><strong>{percent(before.selects_true_unsafe_probability)} → {percent(after.selects_true_unsafe_probability)}</strong></div><small>보류 빈도 MC 표준오차 {(after.monte_carlo_se.no_selection * 100).toFixed(2)}%p</small>
          </article>)}</div>
          <p className="sb-caution">선택 빈도이지 성공·허가 확률이 아닙니다. 표본수 증가는 가정한 독성을 낮추지 않습니다. %p 변화는 통계적 유의성이 아니며, 반올림된 0.0%는 위험이 없다는 뜻이 아닙니다.</p>
        </>}
      </section>
    </div>
    {result && <section className="sb-questions" aria-label="계산에 연결된 KOL 질문"><div className="sb-question-heading"><div><span className="sb-step">03 · 다음 회의</span><h3>{dirty || busy || error ? "이전 계산에 연결된 KOL 질문" : "이 결과를 전문가에게 묻는다면"}</h3></div><Chip size="small" label="규칙 기반 질문 초안 · 전문가 확인 전" /></div><div className="sb-question-grid">{stressQuestions(result).map((q, i) => <article key={q.title}><span>{String(i + 1).padStart(2, "0")} / {q.owner}</span><h4>{q.title}</h4><p>{q.text}</p><small>{q.trigger}</small></article>)}</div>
      <div className="sb-export"><Button variant="outlined" disabled={dirty || busy || !!error} startIcon={<ArrowDownToLine size={16} />} onClick={() => downloadText("trialboard-design-briefing.md", stressMarkdown(result), "text/markdown;charset=utf-8")}>회의 브리핑 저장</Button><Button disabled={dirty || busy || !!error} onClick={() => downloadText("trialboard-design-execution.json", JSON.stringify(result.execution, null, 2), "application/json")}>입력·계산 JSON 저장</Button><small>서버 영구 저장 없음 · 새로고침 시 사라짐</small></div>
      <details><summary>계산 조건과 재현 정보</summary><p>반응 A 30% / B 32% · 한계 35% · 가중치 0.7 · 각 군 30/60명 · 10,000회 · seed 42. 독립 Bernoulli, 고정 관찰기간, 결측·탈락·중간중단 없음. 반응률 − 가중치 × 이상반응률이 높은 군을 관측 한계 이내 군 중 선택합니다. 같은 seed라도 입력별 별도 난수열이며 차이에 Monte Carlo 오차가 포함됩니다.</p><p>기간·비용·임상적 유효성은 계산하지 않았습니다. 임상적 권고가 아닙니다.</p><p>실행 {result.execution.execution_id} · {result.execution.started_at} · {(result.execution.elapsed_ms / 1000).toFixed(2)}초</p></details>
    </section>}
    <div className="sb-footer"><Button onClick={onBack}>근거 검토로 돌아가기</Button><Button onClick={onAdvanced}>전체 가정 편집 <ArrowRight size={16} /></Button></div>
  </section>;
}
