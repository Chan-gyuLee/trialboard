export type Mode = "normal" | "denominator-error" | "missing-evidence";
export type Scenario = {
  id: string; label: string; response: number[]; adverse_event: number[];
  adverse_event_penalty: number; maximum_adverse_event_rate: number; rationale: string;
};
export type Simulation = {
  scenario: Scenario; design: { id: string; label: string; per_arm: number };
  total_sample_size: number; selection_probability: Record<string, number>;
  no_selection_probability: number; selects_true_unsafe_probability: number;
  selects_true_utility_best_probability: number; repetitions: number; seed: number;
  assumptions: string[]; monte_carlo_se: Record<string, number>;
};
export type Report = {
  status: string; input_digest: string;
  checked_claims: { claim: { id: string; stated: {
    arm: string; metric: string; events: number; denominator: number;
  } } }[];
  issues: { code: string; message: string; affected_decision: string; owner: string; needed: string }[];
  simulations: Simulation[]; limitations: string[]; runtime: Record<string, string>;
};
export type RunInput = {
  mode: Mode; scenarios: Scenario[]; per_arm: number[]; repetitions: number; seed: number;
};
export type Execution = {
  execution_id: string; started_at: string; elapsed_ms: number; input: RunInput;
  evidence_input: unknown; report: Report; markdown: string; persisted: false;
  execution_mode: "LIVE_COMPUTE_SYNTHETIC";
};
export type Draft = {
  responseA: string; responseB: string; aeA: string; aeB: string;
  small: string; larger: string; penalty: string; limit: string; seed: string; repetitions: string;
};
export const modes: { id: Mode; label: string }[] = [
  { id: "normal", label: "정상 자료" },
  { id: "denominator-error", label: "분모 오류" },
  { id: "missing-evidence", label: "자료 결측" },
];
export const percent = (n: number) => `${(100 * n).toFixed(1)}%`;
export const delta = (n: number) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%p`;

export function draftFrom(sims: Simulation[]): Draft {
  const s = sims[0];
  const pct = (n: number) => String(Number((n * 100).toFixed(8)));
  return {
    responseA: pct(s.scenario.response[0]), responseB: pct(s.scenario.response[1]),
    aeA: pct(s.scenario.adverse_event[0]), aeB: pct(s.scenario.adverse_event[1]),
    small: String(sims[0].design.per_arm), larger: String(sims[1].design.per_arm),
    penalty: String(s.scenario.adverse_event_penalty), limit: pct(s.scenario.maximum_adverse_event_rate),
    seed: String(s.seed), repetitions: String(s.repetitions),
  };
}

export function validateDraft(draft: Draft): Partial<Record<keyof Draft, string>> {
  const errors: Partial<Record<keyof Draft, string>> = {};
  const check = (key: keyof Draft, min: number, max: number, integer = false) => {
    const raw = draft[key].trim();
    const n = Number(raw);
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(raw) || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n)))
      errors[key] = `${min.toLocaleString()}–${max.toLocaleString()}${integer ? " 정수" : ""}`;
  };
  for (const k of ["responseA", "responseB", "aeA", "aeB", "limit"] as const) check(k, 0, 100);
  check("penalty", 0, 10); check("small", 2, 500, true); check("larger", 2, 500, true);
  check("seed", 0, 4294967295, true); check("repetitions", 100, 100000, true);
  if (!errors.small && !errors.larger && Number(draft.small) >= Number(draft.larger))
    errors.larger = "설계 1보다 크게 입력";
  return errors;
}

export function makeInput(draft: Draft, preset: Scenario, mode: Mode): RunInput {
  if (Object.keys(validateDraft(draft)).length) throw new Error("입력 조건을 확인해 주세요.");
  return {
    mode, per_arm: [Number(draft.small), Number(draft.larger)], seed: Number(draft.seed),
    repetitions: Number(draft.repetitions), scenarios: [{
      id: preset.id, label: preset.label,
      response: [Number(draft.responseA) / 100, Number(draft.responseB) / 100],
      adverse_event: [Number(draft.aeA) / 100, Number(draft.aeB) / 100],
      adverse_event_penalty: Number(draft.penalty), maximum_adverse_event_rate: Number(draft.limit) / 100,
      rationale: preset.rationale,
    }],
  };
}

export async function executeReview(input: RunInput, signal: AbortSignal): Promise<Execution> {
  let response: Response;
  try {
    response = await fetch("/api/reviews", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input), signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("검토 서버에 연결하지 못했습니다. 기존 결과는 유지됩니다.");
  }
  if (!response.ok) {
    if (response.status === 429) throw new Error("다른 검토가 실행 중입니다. 잠시 후 다시 실행해 주세요.");
    if (response.status === 422) throw new Error("서버가 입력을 거부했습니다. 값과 계산량을 확인해 주세요.");
    throw new Error("검토 서버에 연결하지 못했습니다. 기존 결과는 유지됩니다.");
  }
  const data = await response.json();
  if (data.execution_mode !== "LIVE_COMPUTE_SYNTHETIC" || !data.report?.simulations?.length)
    throw new Error("검토 서버의 응답 형식이 올바르지 않습니다.");
  return data;
}

export function downloadText(name: string, value: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
