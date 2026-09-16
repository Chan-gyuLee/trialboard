import { delta, percent, type Execution, type RunInput, type Scenario, type Simulation } from "./review.ts";

export const stressDelta = (n: number) => n !== 0 && Math.abs(n) < 0.0005 ? `0.1%p 미만 ${n > 0 ? "증가" : "감소"}` : delta(n);

// Deliberately independent of the evidence briefing. These are software demo assumptions.
export const BASELINE: Scenario = {
  id: "briefing_baseline", label: "기준 가정", response: [0.3, 0.32], adverse_event: [0.12, 0.25],
  adverse_event_penalty: 0.7, maximum_adverse_event_rate: 0.35,
  rationale: "발표용 합성 가정. 공개 발췌에서 추정하거나 가져온 값이 아님",
};
export type StressDraft = { aeA: string; aeB: string };
export const INITIAL_STRESS: StressDraft = { aeA: "55", aeB: "65" };
export function stressError(draft: StressDraft): string | null {
  if (Object.values(draft).some(v => !/^\d+(\.\d+)?$/.test(v) || Number(v) < 0 || Number(v) > 100)) return "이상반응 확률은 0~100 사이 숫자로 입력하세요.";
  if (Number(draft.aeA) === 12 && Number(draft.aeB) === 25) return "기준 가정과 다른 값을 입력하세요.";
  return null;
}
export function stressInput(draft: StressDraft): RunInput {
  const error = stressError(draft); if (error) throw new Error(error);
  return { mode: "normal", scenarios: [structuredClone(BASELINE), { ...structuredClone(BASELINE), id: "briefing_changed", label: "변경 가정", adverse_event: [Number(draft.aeA) / 100, Number(draft.aeB) / 100] }], per_arm: [30, 60], repetitions: 10000, seed: 42 };
}
const sameScenario = (a: Scenario, b: Scenario) => a.id === b.id && a.label === b.label && a.rationale === b.rationale && a.adverse_event_penalty === b.adverse_event_penalty && a.maximum_adverse_event_rate === b.maximum_adverse_event_rate && ["response", "adverse_event"].every(k => {
  const key = k as "response" | "adverse_event";
  return a[key]?.length === 2 && a[key].every((v, i) => v === b[key][i]);
});
export type StressComparison = { execution: Execution; plans: { before: Simulation; after: Simulation }[] };
export function bindStressResult(execution: Execution, expected: RunInput): StressComparison {
  const fail = () => { throw new Error("계산 결과가 이번 조건과 일치하지 않습니다. 결과를 표시하지 않았습니다."); };
  const input = execution?.input;
  if (!input || execution.execution_mode !== "LIVE_COMPUTE_SYNTHETIC" || execution.persisted !== false || typeof execution.execution_id !== "string" || !execution.execution_id || !Number.isFinite(execution.elapsed_ms) || execution.elapsed_ms < 0 || !execution.report || execution.report.issues?.length !== 0) fail();
  if (input.mode !== expected.mode || input.seed !== expected.seed || input.repetitions !== expected.repetitions || input.per_arm?.length !== 2 || input.per_arm.some((v, i) => v !== expected.per_arm[i]) || input.scenarios?.length !== 2 || !input.scenarios.every((s, i) => sameScenario(s, expected.scenarios[i]))) fail();
  const sims = execution.report.simulations;
  if (!Array.isArray(sims) || sims.length !== 4) fail();
  const plans = expected.per_arm.map((n, index) => {
    const pair = expected.scenarios.map(scenario => {
      const matching = sims.filter(s => s.scenario?.id === scenario.id && s.design?.id === (index === 0 ? "small" : "larger"));
      if (matching.length !== 1) fail();
      const s = matching[0];
      if (!sameScenario(s.scenario, scenario) || s.design.per_arm !== n || s.total_sample_size !== n * 2 || s.repetitions !== expected.repetitions || s.seed !== expected.seed) fail();
      const rates = [s.selection_probability?.dose_a, s.selection_probability?.dose_b, s.no_selection_probability, s.selects_true_unsafe_probability, s.selects_true_utility_best_probability];
      if (rates.some(v => !Number.isFinite(v) || v < 0 || v > 1) || Math.abs(rates[0] + rates[1] + rates[2] - 1) > 1e-8) fail();
      const rateKeys = ["dose_a", "dose_b", "no_selection", "true_unsafe", "true_utility_best"];
      if (!s.monte_carlo_se || rateKeys.some((key, i) => !Number.isFinite(s.monte_carlo_se[key]) || Math.abs(s.monte_carlo_se[key] - Math.sqrt(rates[i] * (1 - rates[i]) / s.repetitions)) > 1e-8)) fail();
      return s;
    });
    return { before: pair[0], after: pair[1] };
  });
  return { execution, plans };
}
export function stressQuestions(result: StressComparison) {
  const { before, after } = result.plans[1];
  const s = after.scenario;
  const unsafe = s.adverse_event.map((v, i) => v > s.maximum_adverse_event_rate ? ["A", "B"][i] : null).filter(Boolean);
  return [
    { title: "독성 가정의 근거", owner: "임상 · 안전성", text: `A ${percent(s.adverse_event[0])}, B ${percent(s.adverse_event[1])}라는 가정을 어떤 이상반응 등급·관찰기간·대상군 자료로 뒷받침할 수 있나요?`, trigger: `기준 A ${percent(before.scenario.adverse_event[0])} / B ${percent(before.scenario.adverse_event[1])}에서 변경` },
    { title: unsafe.length === 2 ? "증원보다 설계 재검토?" : "허용 한계와 선택 기준", owner: "임상 · 통계", text: unsafe.length === 2 ? `두 군의 가정 확률이 모두 ${percent(s.maximum_adverse_event_rate)} 한계를 넘습니다. 증원 전에 용량 범위 또는 중단 기준을 재검토해야 하나요?` : `가정상 한계 초과 군은 ${unsafe.length ? unsafe.join("·") : "없음"}입니다. ${percent(s.maximum_adverse_event_rate)} 한계와 독성 가중치 ${s.adverse_event_penalty}는 이 검토 목적에 적절한가요?`, trigger: `각 군 60명에서 선택 보류 ${percent(before.no_selection_probability)} → ${percent(after.no_selection_probability)}` },
    { title: "추가 60명의 가치", owner: "통계 · 임상 운영", text: `총 60명에서 120명으로 늘릴 때 보류 빈도 변화는 ${stressDelta(after.no_selection_probability - result.plans[0].after.no_selection_probability)}, 한계 초과 군 선택 변화는 ${stressDelta(after.selects_true_unsafe_probability - result.plans[0].after.selects_true_unsafe_probability)}입니다. 추가 환자 부담과 이 차이를 어떻게 평가하나요?`, trigger: "변경 가정의 설계 1 ↔ 설계 2 비교 · 기간·비용·탈락은 계산하지 않음" },
  ];
}
export function stressMarkdown(result: StressComparison) {
  return ["# TrialBoard · 설계 스트레스 테스트", "", "합성 가정의 실제 계산. 공개 임상 근거에서 도출하지 않음. 임상 권고·성공/승인 확률이 아님.", `실행 ${result.execution.execution_id} · ${result.execution.started_at}`, "", ...result.plans.flatMap(({ before, after }) => [`## 각 군 ${after.design.per_arm}명`, `- 선택 보류: ${percent(before.no_selection_probability)} → ${percent(after.no_selection_probability)}`, `- 한계 초과 군 선택: ${percent(before.selects_true_unsafe_probability)} → ${percent(after.selects_true_unsafe_probability)}`]), "", "## KOL 검토 질문 · 규칙 기반 초안 / 새 AI 호출 없음", ...stressQuestions(result).map(q => `- [${q.owner}] ${q.text}\n  - 연결: ${q.trigger}`), "", "조건: 반응 A 30% / B 32%, 이상반응 한계 35%, 가중치 0.7, 각 군 30/60명, 10,000회, seed 42.", `변경 이상반응: ${result.execution.input.scenarios[1].adverse_event.map(percent).join(" / ")}`, "독립 Bernoulli·고정 관찰기간·결측/탈락/중간중단 없음. %p 차이는 유의성 검정이 아니며 Monte Carlo 오차를 포함. 같은 seed도 입력별 별도 난수열 사용.", "서버 영구 저장 및 전문가 검증 없음."].join("\n");
}
