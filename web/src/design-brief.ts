/** Explicit user assumptions. Evidence values are never converted into probabilities. */
import { canonical, digest, exportReview, strictJson, type FieldReview } from "./field-review.ts";
import type { PdfSource } from "./pdf-contract.ts";

export type Arm = { id: string; source_dose: string; observation_ids: string[] };
export type Plan = { id: string; label: string; per_arm: number; rationale: string };
export type Assumption = { id: string; label: string; response: number[]; adverse_event: number[];
  adverse_event_penalty: number; maximum_adverse_event_rate: number; rationale: string; provenance: "user_declared_hypothetical" };
export type DesignBrief = { schema_version: "design-brief/1"; source_digest: string; review_content_digest: string;
  question: string; arms: Arm[]; plans: Plan[]; scenarios: Assumption[]; seed: number; repetitions: number };
export const BRIEF_BYTES = 100_000;
export function fail(message = "설계 입력·결과의 형식이나 현재 검토 버전이 일치하지 않습니다."): never { throw new Error(message); }
export const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
export const arr = (v: unknown, min: number, max: number): unknown[] => Array.isArray(v) && v.length >= min && v.length <= max ? v : fail();
export const str = (v: unknown, max = 2000): string => typeof v === "string" && v.trim().length > 0 && v.length <= max ? v : fail();
export const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export function exact(v: Record<string, unknown>, keys: string[]) { if (!same(Object.keys(v).sort(), [...keys].sort())) fail(); }
export const id = (v: unknown): string => /^[a-zA-Z0-9_-]{1,80}$/.test(str(v, 80)) ? v as string : fail();
export const hash = (v: unknown): string => /^[a-f0-9]{64}$/.test(str(v, 64)) ? v as string : fail();
export function num(v: unknown, low: number, high: number, integer = false): number {
  return typeof v === "number" && Number.isFinite(v) && v >= low && v <= high && (!integer || Number.isSafeInteger(v)) ? v : fail();
}
export function unique(values: (string | number)[]) { if (new Set(values).size !== values.length) fail("용량·관측값·설계안·시나리오는 중복될 수 없습니다."); }
export function validateBrief(value: unknown): DesignBrief {
  const r = obj(value);
  exact(r, ["schema_version", "source_digest", "review_content_digest", "question", "arms", "plans", "scenarios", "seed", "repetitions"]);
  if (r.schema_version !== "design-brief/1") fail();
  hash(r.source_digest); hash(r.review_content_digest); str(r.question);
  const arms = arr(r.arms, 2, 4).map(v => {
    const a = obj(v); exact(a, ["id", "source_dose", "observation_ids"]);
    return { id: id(a.id), source_dose: str(a.source_dose), observation_ids: arr(a.observation_ids, 1, 12).map(id) };
  });
  unique(arms.map(a => a.id)); unique(arms.map(a => a.source_dose)); unique(arms.flatMap(a => a.observation_ids));
  if (arms.some(a => ["no_selection", "true_utility_best", "true_unsafe", "__proto__", "constructor", "prototype"].includes(a.id))) fail("예약된 용량군 식별자입니다.");
  const plans = arr(r.plans, 2, 4).map(v => {
    const p = obj(v); exact(p, ["id", "label", "per_arm", "rationale"]);
    return { id: id(p.id), label: str(p.label), per_arm: num(p.per_arm, 2, 500, true), rationale: str(p.rationale) };
  });
  unique(plans.map(p => p.id)); unique(plans.map(p => p.per_arm));
  const scenarios = arr(r.scenarios, 1, 6).map(v => {
    const s = obj(v); exact(s, ["id", "label", "response", "adverse_event", "adverse_event_penalty", "maximum_adverse_event_rate", "rationale", "provenance"]);
    if (s.provenance !== "user_declared_hypothetical") fail("실제 근거의 추정치로 표시된 확률은 사용할 수 없습니다.");
    return { id: id(s.id), label: str(s.label), response: arr(s.response, arms.length, arms.length).map(p => num(p, 0, 1)),
      adverse_event: arr(s.adverse_event, arms.length, arms.length).map(p => num(p, 0, 1)),
      adverse_event_penalty: num(s.adverse_event_penalty, 0, 10), maximum_adverse_event_rate: num(s.maximum_adverse_event_rate, 0, 1),
      rationale: str(s.rationale), provenance: "user_declared_hypothetical" as const };
  });
  unique(scenarios.map(s => s.id));
  const seed = num(r.seed, 0, 2 ** 32 - 1, true), repetitions = num(r.repetitions, 100, 20000, true);
  if (arms.length * plans.length * scenarios.length * repetitions > 1_000_000) fail("계산량 한도 초과: 군 × 설계안 × 가정 × 반복 수를 100만 이하로 줄이세요.");
  return { schema_version: "design-brief/1", source_digest: r.source_digest as string, review_content_digest: r.review_content_digest as string,
    question: r.question as string, arms, plans, scenarios, seed, repetitions };
}
export async function bindBrief(value: unknown, review: FieldReview, source: PdfSource): Promise<DesignBrief> {
  const b = validateBrief(value);
  if (source.sha256 !== review.sourceDigest || b.source_digest !== source.sha256 || b.review_content_digest !== await digest(canonical(exportReview(review, source)))) fail("현재 PDF·필드 검토 이력과 다른 설계 입력입니다.");
  for (const arm of b.arms) for (const oid of arm.observation_ids) {
    const row = review.rows.find(r => r.id === oid);
    if (!row || row.fields.dose.current.value !== arm.source_dose) fail("용량군에 연결한 관측값과 원문 용량이 일치하지 않습니다.");
  }
  return b;
}
export const readBrief = (raw: string, review: FieldReview, source: PdfSource) => bindBrief(strictJson(raw, BRIEF_BYTES), review, source);

export type DraftPlan = Omit<Plan, "per_arm"> & { per_arm: string };
export type DraftScenario = Omit<Assumption, "response" | "adverse_event" | "adverse_event_penalty" | "maximum_adverse_event_rate"> & {
  response: string[]; adverse_event: string[]; adverse_event_penalty: string; maximum_adverse_event_rate: string };
export type DesignDraft = { question: string; arms: Arm[]; plans: DraftPlan[]; scenarios: DraftScenario[]; seed: string; repetitions: string };
export const blankScenario = (index: number, count: number): DraftScenario => ({ id: `scenario-${index}`, label: "", response: Array(count).fill(""), adverse_event: Array(count).fill(""), adverse_event_penalty: "", maximum_adverse_event_rate: "", rationale: "", provenance: "user_declared_hypothetical" });
export const newDraft = (): DesignDraft => ({ question: "", arms: [], plans: [1, 2].map(n => ({ id: `plan-${n}`, label: `설계안 ${n}`, per_arm: "", rationale: "" })), scenarios: [blankScenario(1, 0)], seed: "42", repetitions: "1000" });
function decimal(value: number): string {
  const text = String(value); if (!text.includes("e")) return text;
  const [mantissa, exponent] = text.split("e"), [whole, fraction = ""] = mantissa.split("."), digits = whole + fraction;
  const point = whole.length + Number(exponent);
  return point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
}
export function draftFromBrief(b: DesignBrief): DesignDraft {
  return { question: b.question, arms: structuredClone(b.arms), plans: b.plans.map(p => ({ ...p, per_arm: String(p.per_arm) })),
    scenarios: b.scenarios.map(s => ({ ...s, response: s.response.map(decimal), adverse_event: s.adverse_event.map(decimal), adverse_event_penalty: decimal(s.adverse_event_penalty), maximum_adverse_event_rate: decimal(s.maximum_adverse_event_rate) })), seed: String(b.seed), repetitions: String(b.repetitions) };
}
/** Blank input is invalid, never coerced to zero. */
export function draftNumber(value: string): number {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) fail("숫자 입력을 확인하세요. 빈칸·음수·지수 표기는 허용하지 않습니다.");
  return num(Number(value), 0, Number.MAX_SAFE_INTEGER);
}
export async function briefFromDraft(d: DesignDraft, review: FieldReview, source: PdfSource): Promise<DesignBrief> {
  return bindBrief({ schema_version: "design-brief/1", source_digest: source.sha256,
    review_content_digest: await digest(canonical(exportReview(review, source))), question: d.question, arms: d.arms,
    plans: d.plans.map(p => ({ ...p, per_arm: draftNumber(p.per_arm) })), scenarios: d.scenarios.map(s => ({ ...s,
      response: s.response.map(draftNumber), adverse_event: s.adverse_event.map(draftNumber), adverse_event_penalty: draftNumber(s.adverse_event_penalty), maximum_adverse_event_rate: draftNumber(s.maximum_adverse_event_rate) })),
    seed: draftNumber(d.seed), repetitions: draftNumber(d.repetitions) }, review, source);
}
