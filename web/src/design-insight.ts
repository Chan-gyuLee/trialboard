/** Explanations of verified calculation output, not model opinions or clinical recommendations. */
import { same } from "./design-brief.ts";
import type { DesignResult } from "./design-result.ts";

export const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
export const percentagePoint = (value: number) => `${value >= 0 ? "+" : "−"}${(Math.abs(value) * 100).toFixed(1)}%p`;
export function designInsight(result: DesignResult, scenarioId: string, alternativeId?: string) {
  const scenario = result.brief.scenarios.find(s => s.id === scenarioId);
  if (!scenario) throw Error("현재 결과에 없는 가정입니다.");
  if (result.blockers.length) return {kind: "blocked" as const, scenario, rows: [], tradeoff: null, allUnsafe: false};
  const rows = result.plans.map(p => {
    const simulation = result.simulations.find(s => s.scenarioId === scenario.id && s.planId === p.id);
    if (!simulation) throw Error("검증된 계산 조합이 누락됐습니다.");
    return {plan: p, simulation};
  });
  const alternative = alternativeId ?? result.plans[1].id;
  const tradeoff = result.tradeoffs.find(t => t.scenario_id === scenario.id && t.alternative_plan_id === alternative);
  if (!tradeoff) throw Error("선택한 대안의 비교 결과가 없습니다.");
  return {kind: "calculated" as const, scenario, rows, tradeoff,
    allUnsafe: scenario.adverse_event.every(p => p > scenario.maximum_adverse_event_rate)};
}

export type InputChange = {label: string; before: string; after: string};
type MetricChange = {before: number; after: number; delta: number};
export type RunChange = {changes: InputChange[]; comparable: boolean; reason: string;
  effects: {scenarioId: string; planId: string; label: string; correct: MetricChange; unsafe: MetricChange; noSelection: MetricChange}[]};
/** IDs align revisions; changed source/cohort/engine never masquerades as an input-only effect. */
export function compareDesignRuns(previous: DesignResult, current: DesignResult): RunChange {
  const before = previous.brief, after = current.brief, changes: InputChange[] = [];
  const add = <T,>(label: string, a: T | undefined, b: T | undefined, format: (v: T) => string = String) => {
    if (!same(a,b)) changes.push({label, before: a === undefined ? "없음" : format(a), after: b === undefined ? "없음" : format(b)});
  };
  add("원문 식별값", before.source_digest, after.source_digest);
  add("계산 엔진 버전", previous.raw.engine_digest, current.raw.engine_digest);
  add("근거 검토 버전", before.review_content_digest, after.review_content_digest);
  add("비교 질문", before.question, after.question);
  const armSummary=(arms:typeof before.arms)=>arms.map(a=>`${a.id}: ${a.source_dose} [${a.observation_ids.join(", ")}]`).join(" · ");
  if (!same(before.arms,after.arms)) changes.push({label:"용량군·근거 연결",before:armSummary(before.arms),after:armSummary(after.arms)});
  add("설계 순서·비교 기준",before.plans.map(p=>p.id),after.plans.map(p=>p.id),v=>v.join(" → "));
  add("가정 순서",before.scenarios.map(s=>s.id),after.scenarios.map(s=>s.id),v=>v.join(" → "));
  for (const id of new Set([...before.plans,...after.plans].map(p=>p.id))) {
    const a=before.plans.find(p=>p.id===id), b=after.plans.find(p=>p.id===id);
    add(`${b?.label ?? a?.label} · 군당 인원`,a?.per_arm,b?.per_arm,v=>`${v}명`);
    add(`${id} · 이름`,a?.label,b?.label);
    add(`${id} · 설계 이유`,a?.rationale,b?.rationale);
  }
  for (const id of new Set([...before.scenarios,...after.scenarios].map(s=>s.id))) {
    const a=before.scenarios.find(s=>s.id===id), b=after.scenarios.find(s=>s.id===id), name=b?.label ?? a!.label;
    if(!a || !b){changes.push({label:"가정 추가·제거",before:a?.label??"없음",after:b?.label??"없음"});continue;}
    add(`${id} · 이름`,a.label,b.label);
    add(`${name} · 반응확률`,a.response,b.response,v=>v.map(percent).join(" / "));
    add(`${name} · 이상반응확률`,a.adverse_event,b.adverse_event,v=>v.map(percent).join(" / "));
    add(`${name} · 효용 가중치`,a.adverse_event_penalty,b.adverse_event_penalty);
    add(`${name} · 안전 한계`,a.maximum_adverse_event_rate,b.maximum_adverse_event_rate,percent);
    add(`${name} · 가정 이유`,a.rationale,b.rationale);
    // New acknowledgement hashes are not assumption edits; actual origin changes are.
    const origin=(p:typeof a.provenance)=>typeof p==="string"?p:{...p,reviewed_input_digest:null};
    if(!same(origin(a.provenance),origin(b.provenance))) changes.push({label:`${name} · 가정 출처`,before:typeof a.provenance==="string"?"사용자 지정":`AI 제안 ${a.provenance.proposal_id}`,after:typeof b.provenance==="string"?"사용자 지정":`AI 제안 ${b.provenance.proposal_id}`});
  }
  add("난수 seed",before.seed,after.seed);add("반복 수",before.repetitions,after.repetitions);
  const reason = before.source_digest!==after.source_digest ? "서로 다른 원문입니다. 결과 차이를 직접 비교하지 않습니다."
    : before.review_content_digest!==after.review_content_digest ? "근거 검토 버전이 달라졌습니다. 원문·검토를 재확인해야 하므로 수치 차이는 표시하지 않습니다."
    : !same(before.arms,after.arms) || before.question!==after.question ? "비교 질문 또는 용량군·근거 연결이 달라졌습니다. 같은 조건의 변경으로 해석할 수 없습니다."
    : previous.raw.engine_digest!==current.raw.engine_digest ? "계산 엔진 버전이 달라 수치 차이를 직접 비교하지 않습니다."
    : previous.blockers.length || current.blockers.length ? "계산이 보류된 실행이 포함되어 수치 차이를 비교하지 않습니다."
    : "같은 근거·용량군에서 입력을 바꾼 전후 결과입니다. 차이를 특정 변경의 인과효과나 임상적 개선으로 해석하지 마세요.";
  const comparable = before.source_digest===after.source_digest && before.review_content_digest===after.review_content_digest &&
    before.question===after.question && same(before.arms,after.arms) && previous.raw.engine_digest===current.raw.engine_digest && !previous.blockers.length && !current.blockers.length;
  const metric=(before:number,after:number):MetricChange=>({before,after,delta:after-before});
  const effects = comparable ? current.simulations.flatMap(s=>{
    const old=previous.simulations.find(p=>p.scenarioId===s.scenarioId && p.planId===s.planId);
    return old ? [{scenarioId:s.scenarioId,planId:s.planId,label:`${after.scenarios.find(p=>p.id===s.scenarioId)!.label} · ${after.plans.find(p=>p.id===s.planId)!.label}`,
      correct:metric(old.correct,s.correct),unsafe:metric(old.unsafe,s.unsafe),noSelection:metric(old.noSelection,s.noSelection)}] : [];
  }) : [];
  return {changes,comparable,reason,effects};
}

export function changeMarkdown(previous: DesignResult, current: DesignResult): string {
  const delta=compareDesignRuns(previous,current);
  const escape=(value:string)=>value.replace(/[&<>|`]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","|":"\\|","`":"\\`"})[c]!).replace(/\r?\n/g," ");
  return ["# TrialBoard · 계산 변경 검토", "", "연구용 가정 비교 · 임상 권고/인과효과/전문가 승인 아님", "",
    `이전 실행: ${escape(previous.runId)}`,`현재 실행: ${escape(current.runId)}`, "",
    delta.reason,"", "## 바뀐 입력", "", "| 항목 | 이전 | 현재 |", "| --- | --- | --- |",
    ...delta.changes.map(c=>`| ${escape(c.label)} | ${escape(c.before)} | ${escape(c.after)} |`),
    ...(delta.effects.length ? ["", "## 계산 빈도 변화", "", "| 가정 / 설계 | 지표 | 이전 | 현재 | 차이 |", "| --- | --- | ---: | ---: | ---: |",
      ...delta.effects.flatMap(e=>[["가정상 올바른 선택·보류",e.correct],["가정상 한계 초과군 선택",e.unsafe],["선택 보류",e.noSelection]].map(([label,value])=>{const m=value as MetricChange;return `| ${escape(e.label)} | ${label} | ${percent(m.before)} | ${percent(m.after)} | ${percentagePoint(m.delta)} |`;}))] : []),
    "", "전후 차이는 기술적 요약입니다. 각 실행의 Monte Carlo 오차를 함께 확인하세요. 유의성 검정이 아닙니다.",
    "", "이 파일은 변경 요약이며 전체 실행/회의 기록의 백업이 아닙니다. 원본 결과와 회의 JSON을 함께 보관하세요.", ""].join("\n");
}
