import { canonical, digest, strictJson } from "./field-review.ts";

export type CitedField = { value: string | null; span_id: string | null; quote: string | null };
export type AgentObservation = { id: string; value_kind: "event_count" | "reported_percentage"; fields: Record<string, CitedField> };
export type AgentFinding = { code: string; observation_id: string | null; field: string | null; detail: string };
export type AgentConcern = { scope: string; observation_ids: string[]; span_ids: string[]; reason: string };
export type AgentAttempt = { number: number; extraction: { observations: AgentObservation[] } | null; findings: AgentFinding[]; critique: { concerns: AgentConcern[]; next_questions: string[] } | null };
export type AgentRecord = {
  run_id: string; started_at: string; input_digest: string; engine_version: string; execution_mode: string; model: string; status: string;
  input: { question: string; asset: string; study: string; provenance: string; spans: { id: string; text: string; page: number | null; source_digest: string; locator?: string | null }[] };
  accepted: AgentObservation[]; attempts: AgentAttempt[];
  calls: { stage: string; attempt: number; outcome: string; input_tokens: number | null; output_tokens: number | null }[];
  events: { stage: string; attempt: number; codes: string[] }[]; limitations: string[];
};
export const STAGES: Record<string, { label: string; kind: string; description: string }> = {
  HANDOFF: { label: "추가 근거를 사람에게 요청", kind: "실행 제어", description: "비교 적용 한계는 같은 문구의 재추출로 해결하지 않고 인계합니다." },
  EXTRACT: { label: "근거를 구조화", kind: "모델 작업", description: "수치에 대상군·분모·평가 시점과 인용을 연결합니다." },
  VERIFY: { label: "원문과 대조", kind: "규칙 검사", description: "인용·필수 필드·비교 문맥의 검사 결과입니다. 의미 검증을 보장하지 않습니다." },
  CRITIQUE: { label: "비교의 허점을 검토", kind: "모델 반론", description: "수치가 맞더라도 같은 조건에서 비교할 수 있는지 쟁점을 제기합니다." },
  REVISE: { label: "피드백으로 다시 추출", kind: "모델 수정", description: "앞선 검사 피드백을 받은 시도입니다. 값의 변화는 아래에서 대조합니다." },
  DRAFT_FOR_EXPERT_REVIEW: { label: "사람의 검토로 인계", kind: "실행 종료", description: "검토 초안을 남겼습니다. 설계 권고나 임상 승인이 아닙니다." },
  PARTIAL_ABSTENTION: { label: "모르는 것은 보류", kind: "실행 종료", description: "관측 초안과 미해결 쟁점을 함께 보존합니다. 비교 가능하다는 뜻이 아닙니다." },
  FAILED: { label: "실행 실패", kind: "실행 종료", description: "완성된 결과로 취급하지 않습니다. 중단 이전 기록만 확인할 수 있습니다." },
  BUDGET_EXCEEDED: { label: "예산 한도로 중단", kind: "실행 종료", description: "미완료 실행입니다. 새로운 검토가 필요합니다." },
};
export const FINDING_LABELS: Record<string, string> = {
  VALUE_NOT_IN_QUOTE: "추출한 값이 연결된 인용문에 없습니다",
  ENDPOINT_MISSING: "비교에 필요한 용량·지표 조합이 빠졌습니다",
  MISSING_FIELD: "검토에 필요한 정보가 보고되지 않았습니다",
  REPORTED_RATE_ONLY: "보고 비율로 사건 수를 역산하지 않습니다",
  SECOND_DOSE_MISSING: "서로 비교할 두 용량이 확인되지 않았습니다",
  COMPARISON_CONTEXT_MISMATCH: "대상군이나 평가 조건이 달라 직접 비교를 보류합니다",
  INVALID_EXTRACTION_SCHEMA: "추출 결과가 지원하는 형식과 맞지 않습니다",
};
const terminal = ["DRAFT_FOR_EXPERT_REVIEW", "PARTIAL_ABSTENTION", "FAILED", "BUDGET_EXCEEDED"];
const fields = ["asset", "indication", "study", "cohort", "dose", "metric", "events", "denominator", "population", "window", "definition", "reported_rate"];
const fail = (): never => { throw new Error("지원하는 에이전트 3.2 실행 기록이 아니거나 기록 연결이 손상되었습니다."); };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const text = (v: unknown, max = 2000): string => typeof v === "string" && v.length <= max && v.length > 0 ? v : fail();
const nullable = (v: unknown) => v === null ? null : text(v);
const list = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : fail();
const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER): number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max ? Number(v) : fail();
const unique = (ids: string[]) => { if (new Set(ids).size !== ids.length) fail(); };

/** Read-only replay: structural/input-hash checks are NOT signer authentication or clinical validation. */
export async function readAgentRecord(raw: string): Promise<AgentRecord> {
  const r = obj(strictJson(raw)), input = obj(r.input);
  if (r.engine_version !== "bounded-evidence-agent/3.2" || !terminal.includes(String(r.status))) fail();
  if (!["CODEX_CHATGPT", "DACON_RESPONSES", "OPENAI_RESPONSES", "SCRIPTED_TEST_DOUBLE"].includes(String(r.execution_mode))) fail();
  if (!["synthetic_fixture", "curated_public_excerpt", "user_pdf_export_unverified"].includes(String(input.provenance))) fail();
  text(r.run_id, 200); text(r.model, 200); text(r.started_at, 100);
  if (!Number.isFinite(Date.parse(String(r.started_at)))) fail();
  text(input.question); text(input.asset); text(input.study);
  if (await digest(canonical(input)) !== r.input_digest) fail();
  const spans = list(input.spans, 40).map(v => { const s = obj(v); text(s.id, 80); text(s.text); if (s.page !== null && integer(s.page, 10000) < 1) fail(); if (!/^[a-f0-9]{64}$/.test(String(s.source_digest))) fail(); if (s.locator !== undefined && s.locator !== null) text(s.locator, 4000); return s; });
  if (!spans.length) fail(); unique(spans.map(s => String(s.id)));
  function observation(v: unknown) {
    const o = obj(v); text(o.id, 80); const fs = obj(o.fields);
    if (!["event_count", "reported_percentage"].includes(String(o.value_kind)) || Object.keys(fs).length !== fields.length) fail();
    for (const key of fields) { const f = obj(fs[key]); nullable(f.value); nullable(f.quote); nullable(f.span_id); }
    return o as unknown as AgentObservation;
  }
  const attempts = list(r.attempts, 3).map((v, i) => {
    const a = obj(v); if (a.number !== i) fail();
    const observations = a.extraction === null ? [] : list(obj(a.extraction).observations, 12).map(observation);
    unique(observations.map(o => o.id));
    for (const v of list(a.findings, 300)) { const f = obj(v); text(f.code, 120); nullable(f.observation_id); nullable(f.field); if (typeof f.detail !== "string" || f.detail.length > 4000) fail(); }
    if (a.critique !== null) {
      const c = obj(a.critique);
      for (const v of list(c.concerns, 12)) { const co = obj(v); if (!["observation_error", "comparison_limitation"].includes(String(co.scope))) fail(); text(co.reason); const ids = list(co.observation_ids, 12); const ss = list(co.span_ids, 12); if (!ids.length || !ss.length) fail(); ids.forEach(id => text(id, 80)); ss.forEach(id => text(id, 80)); }
      list(c.next_questions, 8).forEach(q => text(q));
    }
    return a as unknown as AgentAttempt;
  });
  const accepted = list(r.accepted, 12).map(observation); unique(accepted.map(o => o.id));
  if (["FAILED", "BUDGET_EXCEEDED"].includes(String(r.status)) && accepted.length) fail();
  for (const row of accepted) if (!attempts.at(-1)?.extraction?.observations.some(o => canonical(o) === canonical(row))) fail();
  if (r.status === "DRAFT_FOR_EXPERT_REVIEW" && !accepted.length) fail();
  const calls = list(r.calls, 6).map(v => { const c = obj(v); if (!["EXTRACT", "REVISE", "CRITIQUE"].includes(String(c.stage)) || !["STARTED", "RECEIVED", "FAILED_OR_CANCELLED"].includes(String(c.outcome))) fail(); integer(c.attempt, 2); for (const key of ["input_tokens", "output_tokens"]) if (c[key] !== null) integer(c[key]); return c; });
  const events = list(r.events, 16).map(v => { const e = obj(v); if (!STAGES[String(e.stage)]) fail(); integer(e.attempt, 3); list(e.codes, 300).forEach(c => text(c, 200)); return e; });
  if (!events.length || events.at(-1)?.stage !== r.status || events.slice(0, -1).some(e => terminal.includes(String(e.stage)))) fail();
  for (const e of events.slice(0, -1)) {
    if (e.stage === "VERIFY" && !attempts[Number(e.attempt)]) fail();
    if (e.stage !== "VERIFY" && !calls.some(c => c.stage === e.stage && c.attempt === e.attempt)) fail();
  }
  list(r.limitations, 30).forEach(v => text(v, 4000));
  return r as unknown as AgentRecord;
}

export function changedFields(record: AgentRecord, attempt: number) {
  const previous = record.attempts[attempt - 1]?.extraction?.observations ?? [];
  return (record.attempts[attempt]?.extraction?.observations ?? []).flatMap(row => {
    const old = previous.find(o => o.id === row.id);
    return fields.flatMap(field => old && old.fields[field].value !== row.fields[field].value ? [{ id: row.id, field, before: old.fields[field], after: row.fields[field] }] : []);
  });
}

export function recordStepFromKey(key: string, current: number, count: number): number | null {
  if (count < 1) return null;
  if (key === "ArrowRight") return Math.min(count - 1, current + 1);
  if (key === "ArrowLeft") return Math.max(0, current - 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export function briefingMarkdown(r: AgentRecord): string {
  const safe = (s: string) => s.replace(/[<>]/g, "").replace(/([\\`*_{}\[\]()#+.!|~-])/g, "\\$1").replace(/[\r\n]+/g, " ");
  return ["# TrialBoard 에이전트 브리핑", "", "저장 실행 기록 · 기록 재생·내보내기에는 새 모델 호출 없음 · 임상 승인 아님",
    `실행 방식: ${safe(r.execution_mode)} / ${safe(r.model)}`, `실행 ID: ${safe(r.run_id)}`, `질문: ${safe(r.input.question)}`,
    "", "## 실행 경로", ...r.events.map(e => `- ${STAGES[e.stage].label} · 시도 ${e.attempt + 1} · ${e.codes.join(", ")}`),
    "", "## 마지막 모델 쟁점", ...(r.attempts.at(-1)?.critique?.concerns ?? []).map(c => `- ${safe(c.reason)}`),
    "", "## 다음 검토 질문 · 모델 제안, 미검증", ...(r.attempts.at(-1)?.critique?.next_questions ?? []).map(q => `- ${safe(q)}`),
    "", "## 한계", "기록의 실행 방식은 작성자 인증이 아닙니다. 내부 사고 과정이 아닌 저장된 작업 산출물입니다.",
    ...r.limitations.map(s => `- ${safe(s)}`), ""].join("\n");
}
