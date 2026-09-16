/** Validate imported output consistency; this is not a Python rerun or an authenticity check. */
import { canonical, digest, strictJson, type FieldReview } from "./field-review.ts";
import type { PdfSource } from "./pdf-contract.ts";
import { readResult, reviewKey, RESULT_BYTES, type RevalidationResult } from "./revalidation-result.ts";
import { readRecritique, type RecritiqueResult } from "./recritique-result.ts";
import { arr, bindBrief, exact, fail, hash, id, num, obj, same, str, unique, type DesignBrief, type Plan } from "./design-brief.ts";

export type Blocker = { code: string; arm_id: string | null; observation_id: string | null; detail: string };
export type KolQuestion = { id: string; category: string; priority: "BEFORE_COMPARISON" | "BEFORE_PROTOCOL"; trigger: Record<string, unknown>; question: string; answer_status: "UNANSWERED" };
export type Simulation = { scenarioId: string; planId: string; total: number; correct: number; unsafe: number; noSelection: number;
  selection: Record<string, number>; se: Record<string, number>; bestArms: string[] };
export type Tradeoff = { scenario_id: string; reference_plan_id: string; alternative_plan_id: string; additional_participants: number;
  correct_selection_or_abstention_delta: number; unsafe_selection_delta: number; no_selection_delta: number; delta_monte_carlo_se: Record<string, number> };
export type DesignResult = { raw: Record<string, unknown>; reportKey: string; runId: string; reviewKey: string; brief: DesignBrief; briefDigest: string;
  status: "BLOCKED_EVIDENCE_LINK" | "HYPOTHETICAL_COMPARISON_ONLY"; rules: RevalidationResult; ai: RecritiqueResult | null;
  blockers: Blocker[]; questions: KolQuestion[]; simulations: Simulation[]; tradeoffs: Tradeoff[]; plans: (Plan & { total_sample_size: number })[]; limitations: string[] };
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-10;
const probability = (v: unknown, repetitions: number) => {
  const p = num(v, 0, 1); if (!close(p * repetitions, Math.round(p * repetitions))) fail("선택 빈도가 반복 수와 일치하지 않습니다."); return p;
};

export async function readDesignResult(raw: string, review: FieldReview, source: PdfSource, expectedBrief?: DesignBrief): Promise<DesignResult> {
  const r = obj(strictJson(raw, RESULT_BYTES * 2, 900000));
  if (r.schema_version !== "design-comparison/1" || r.clinical_approval !== false || r.recommended_plan_id !== null || r.model_calls !== 0) fail();
  const b = await bindBrief(r.brief, review, source);
  if (expectedBrief && !same(b, expectedBrief)) fail("입력한 설계안·가정과 다른 결과입니다. 현재 입력으로 다시 계산하세요.");
  const material = str(r.brief_canonical, 100000);
  if (!same(strictJson(material, 100000), b) || hash(r.brief_digest) !== await digest(material) || r.review_content_digest !== b.review_content_digest) fail("설계 입력 hash가 일치하지 않습니다.");
  hash(r.engine_digest); const runtime = obj(r.runtime); str(runtime.python, 100); str(runtime.numpy, 100);
  const nested = obj(r.revalidation), rules = readResult(JSON.stringify(nested), review, source);
  if (rules.question !== b.question) fail("설계 질문과 재검증 질문이 다릅니다.");
  let ai: RecritiqueResult | null = null;
  if (r.ai_review !== null) {
    ai = await readRecritique(JSON.stringify(r.ai_review), review, source);
    if (ai.status !== "COMPLETED" || r.ai_status !== "CURRENT_REPORT_SUPPLIED_UNAUTHENTICATED") fail();
    const other = obj(obj(r.ai_review).revalidation);
    for (const key of ["review", "input", "accepted", "effective_extraction", "findings", "excluded_observation_ids", "rules_digest"]) if (!same(other[key], nested[key])) fail();
  } else if (r.ai_status !== "NOT_SUPPLIED") fail();
  const armIds = b.arms.map(a => a.id), observationIds = review.rows.map(r => r.id);
  const blockers: Blocker[] = arr(r.blockers, 0, 2000).map(v => {
    const q = obj(v); exact(q, ["code", "arm_id", "observation_id", "detail"]);
    if (q.arm_id !== null && !armIds.includes(id(q.arm_id))) fail();
    if (q.observation_id !== null && !observationIds.includes(id(q.observation_id))) fail();
    if (typeof q.detail !== "string" || q.detail.length > 10000) fail();
    return { code: str(q.code, 100), arm_id: q.arm_id as string | null, observation_id: q.observation_id as string | null, detail: q.detail };
  });
  if (r.status !== (blockers.length ? "BLOCKED_EVIDENCE_LINK" : "HYPOTHETICAL_COMPARISON_ONLY")) fail();
  const accepted = arr(nested.accepted, 0, 12).map(obj), withheld = new Set(ai?.withheldIds ?? []);
  const expectedRows = b.arms.flatMap(a => a.observation_ids.flatMap(oid => {
    const row = accepted.find(v => v.id === oid);
    const eligible = row && !withheld.has(oid) && obj(obj(row.fields).dose).value === a.source_dose;
    if (!eligible && !blockers.some(q => q.arm_id === a.id && q.observation_id === oid && ["OBSERVATION_WITHHELD", "SOURCE_DOSE_MISMATCH"].includes(q.code))) fail("제외된 관측값의 계산 차단 사유가 없습니다.");
    return eligible ? [row] : [];
  }));
  if (!same(r.evidence_rows, expectedRows)) fail("설계 근거가 현재 재검증의 관측값과 다릅니다.");
  if(!ai && nested.previous_model_review) {
    const previous=obj(nested.previous_model_review);
    if(previous.critique) for(const value of arr(obj(previous.critique).concerns,0,12)) {
      const c=obj(value);
      if(c.scope==='comparison_limitation' && arr(c.observation_ids,1,12).some(i=>expectedRows.some(r=>r.id===i)) && !blockers.some(b=>b.code==='PREVIOUS_AI_LIMITATION_UNRESOLVED' && b.detail===c.reason)) fail('최초 AI 비교 한계의 미해결 상태가 차단에서 누락되었습니다.');
    }
  }
  for (const c of ai?.concerns ?? []) if (c.scope === "comparison_limitation" && c.observation_ids.some(i => expectedRows.some(r => r.id === i)) && !blockers.some(b => b.code === "AI_COMPARISON_LIMITATION" && b.detail === c.reason)) fail("AI 비교 한계가 계산 차단에서 누락되었습니다.");
  const plans = b.plans.map(p => ({ ...p, allocation: "FIXED_EQUAL", total_sample_size: p.per_arm * b.arms.length }));
  if (!same(r.plans, plans)) fail("설계별 총 표본수가 입력과 다릅니다.");
  const simulations: Simulation[] = arr(r.simulations, blockers.length ? 0 : b.plans.length * b.scenarios.length, blockers.length ? 0 : b.plans.length * b.scenarios.length).map(v => {
    const s = obj(v), scenario = obj(s.scenario), design = obj(s.design);
    const assumed = b.scenarios.find(a => a.id === scenario.id), p = b.plans.find(a => a.id === design.id);
    if (!assumed || !p || !same(design, { id: p.id, label: p.label, per_arm: p.per_arm })
      || !same(scenario, { ...assumed, arms: armIds, provenance: "synthetic_assumption" })
      || s.seed !== b.seed || s.repetitions !== b.repetitions || s.total_sample_size !== p.per_arm * armIds.length) fail("계산에 사용한 가정·표본수·난수 설정이 입력과 다릅니다.");
    arr(s.assumptions, 1, 30).forEach(v => str(v));
    const selection = obj(s.selection_probability), se = obj(s.monte_carlo_se);
    exact(selection, armIds); exact(se, [...armIds, "no_selection", "true_utility_best", "true_unsafe"]);
    const rates = Object.fromEntries(armIds.map(a => [a, probability(selection[a], b.repetitions)]));
    const noSelection = probability(s.no_selection_probability, b.repetitions), unsafe = probability(s.selects_true_unsafe_probability, b.repetitions), correct = probability(s.selects_true_utility_best_probability, b.repetitions);
    if (!close(Object.values(rates).reduce((a, p) => a + p, noSelection), 1)) fail("선택·보류 빈도의 합이 1이 아닙니다.");
    const utility = assumed.response.map((p, i) => p - assumed.adverse_event_penalty * assumed.adverse_event[i]);
    const eligible = armIds.filter((_, i) => assumed.adverse_event[i] <= assumed.maximum_adverse_event_rate);
    const best = Math.max(...eligible.map(a => utility[armIds.indexOf(a)]));
    const bestArms = eligible.filter(a => Math.abs(utility[armIds.indexOf(a)] - best) <= 1e-12);
    if (!same(s.true_utility_best_arms, bestArms) || !close(correct, bestArms.length ? bestArms.reduce((p, a) => p + rates[a], 0) : noSelection)
      || !close(unsafe, armIds.filter(a => !eligible.includes(a)).reduce((p, a) => p + rates[a], 0))) fail("가정상 올바른 선택·위험군 선택 집계가 불일치합니다.");
    for (const [key, p] of Object.entries({ ...rates, no_selection: noSelection, true_utility_best: correct, true_unsafe: unsafe })) {
      if (!close(num(se[key], 0, 1), Math.sqrt(p * (1 - p) / b.repetitions))) fail("Monte Carlo 표준오차가 선택 빈도와 다릅니다.");
    }
    return { scenarioId: assumed.id, planId: p.id, total: s.total_sample_size as number, correct, unsafe, noSelection, selection: rates, se: se as Record<string, number>, bestArms };
  });
  unique(simulations.map(s => `${s.scenarioId}/${s.planId}`));
  const tradeoffs: Tradeoff[] = [];
  if (!blockers.length) for (const scenario of b.scenarios) {
    const reference = simulations.find(s => s.scenarioId === scenario.id && s.planId === b.plans[0].id)!;
    for (const p of b.plans.slice(1)) {
      const alternative = simulations.find(s => s.scenarioId === scenario.id && s.planId === p.id)!;
      tradeoffs.push({ scenario_id: scenario.id, reference_plan_id: reference.planId, alternative_plan_id: alternative.planId,
        additional_participants: alternative.total - reference.total, correct_selection_or_abstention_delta: alternative.correct - reference.correct,
        unsafe_selection_delta: alternative.unsafe - reference.unsafe, no_selection_delta: alternative.noSelection - reference.noSelection,
        delta_monte_carlo_se: Object.fromEntries(["true_utility_best", "true_unsafe", "no_selection"].map(k => [k, Math.hypot(reference.se[k], alternative.se[k])])) });
    }
  }
  const reported = arr(r.tradeoffs, tradeoffs.length, tradeoffs.length).map(obj);
  tradeoffs.forEach((t, i) => {
    exact(reported[i], Object.keys(t));
    for (const k of ["scenario_id", "reference_plan_id", "alternative_plan_id", "additional_participants"] as const) if (reported[i][k] !== t[k]) fail();
    for (const k of ["correct_selection_or_abstention_delta", "unsafe_selection_delta", "no_selection_delta"] as const) if (!close(num(reported[i][k], -1, 1), t[k])) fail();
    const se = obj(reported[i].delta_monte_carlo_se); exact(se, Object.keys(t.delta_monte_carlo_se));
    for (const k of Object.keys(se)) if (!close(num(se[k], 0, 1), t.delta_monte_carlo_se[k])) fail();
  });
  const questions: KolQuestion[] = arr(r.kol_questions, 6, 2024).map(v => {
    const q = obj(v); exact(q, ["id", "category", "priority", "trigger", "question", "answer_status"]);
    if (!["BEFORE_COMPARISON", "BEFORE_PROTOCOL"].includes(String(q.priority)) || q.answer_status !== "UNANSWERED") fail();
    return { id: id(q.id), category: str(q.category, 100), priority: q.priority as KolQuestion["priority"], trigger: obj(q.trigger), question: str(q.question), answer_status: "UNANSWERED" };
  });
  unique(questions.map(q => q.id));
  if (questions.length !== blockers.length + 6 + tradeoffs.length) fail();
  blockers.forEach((blocker, i) => { const q = questions.find(q => q.id === `gap-${i + 1}`); if (!q || q.priority !== "BEFORE_COMPARISON" || q.category !== "evidence_gap" || !same(q.trigger, blocker)) fail(); });
  for (const category of ["dose_schedule", "endpoint", "assumptions", "decision_rule", "feasibility", "statistics"]) {
    const q = questions.find(q => q.id === category);
    if (!q || q.category !== category || q.priority !== "BEFORE_PROTOCOL" || !same(q.trigger, { plan_ids: b.plans.map(p => p.id), scenario_ids: b.scenarios.map(s => s.id) })) fail();
  }
  reported.forEach((t, i) => { const q = questions.find(q => q.id === `tradeoff-${i + 1}`); if (!q || q.category !== "sample_size_tradeoff" || q.priority !== "BEFORE_PROTOCOL" || !same(q.trigger, t)) fail(); });
  const limitations = arr(r.limitations, 1, 30).map(v => str(v));
  return { raw: r, reportKey: await digest(canonical(r)), runId: str(r.run_id, 100), reviewKey: rules.reviewKey, brief: b, briefDigest: r.brief_digest as string,
    status: r.status as DesignResult["status"], rules, ai, blockers, questions, plans, simulations, tradeoffs, limitations };
}
export function isDesignCurrent(r: DesignResult, review: FieldReview, source: PdfSource, brief: DesignBrief, hasDraft = false): boolean {
  return !hasDraft && review.sourceDigest === source.sha256 && r.reviewKey === reviewKey(review, source) && same(r.brief, brief);
}
