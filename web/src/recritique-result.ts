/** Validate a local AI report's internal consistency, not its authorship or clinical truth. */
import { canonical, digest, strictJson, type FieldReview } from "./field-review.ts";
import type { PdfSource, PdfSpan } from "./pdf-contract.ts";
import { readResult, reviewKey, RESULT_BYTES, type Finding, type RevalidationResult } from "./revalidation-result.ts";

export type Concern = { scope: "observation_error" | "comparison_limitation"; observation_ids: string[]; span_ids: string[]; reason: string };
export type RecritiqueResult = {
  runId: string; reviewKey: string; mode: "CODEX_CHATGPT" | "DACON_RESPONSES" | "SCRIPTED_TEST_DOUBLE"; model: string;
  status: "COMPLETED" | "NO_CANDIDATES" | "FAILED" | "BUDGET_EXCEEDED";
  rules: RevalidationResult; candidateIds: string[]; remainingIds: string[]; withheldIds: string[];
  concerns: Concern[]; questions: string[]; errors: string[];
  callCount: number; inputTokens: number | null; outputTokens: number | null;
};
function fail(message = "AI 재검토 결과의 상태·참조·검토 이력이 일치하지 않습니다."): never { throw new Error(message); }
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const arr = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : fail();
const str = (v: unknown, max = 2000): string => typeof v === "string" && v.length > 0 && v.length <= max ? v : fail();
const hash = (v: unknown) => /^[a-f0-9]{64}$/.test(str(v, 64)) ? v as string : fail();
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const sameSet = (a: string[], b: string[]) => same([...a].sort(), [...b].sort());
const exact = (v: Record<string, unknown>, keys: string[]) => { if (!same(Object.keys(v).sort(), keys.sort())) fail(); };
function integer(v: unknown, low: number, high: number): number {
  if (!Number.isSafeInteger(v) || Number(v) < low || Number(v) > high) fail(); return Number(v);
}

export async function readRecritique(raw: string, review: FieldReview, source: PdfSource): Promise<RecritiqueResult> {
  const r = obj(strictJson(raw, RESULT_BYTES, 500000));
  if (r.schema_version !== "field-recritique/1" || !["human-review-recritique/1","human-review-recritique/2"].includes(String(r.prompt_version))
      || r.clinical_approval !== false || r.comparison_status !== "NOT_APPROVED"
      || r.reviewer_identity !== "UNAUTHENTICATED_USER" || r.user_values_modified !== false
      || (r.execution_mode !== "CODEX_CHATGPT" && r.execution_mode !== "DACON_RESPONSES" && r.execution_mode !== "SCRIPTED_TEST_DOUBLE")) fail();
  const nested = obj(r.revalidation), rules = readResult(JSON.stringify(nested), review, source);
  if (r.source_digest !== source.sha256 || r.review_digest !== nested.review_digest
      || hash(r.review_content_digest) !== await digest(canonical(nested.review))) fail("현재 PDF·검토 버전과 다른 AI 결과입니다. 현재 이력으로 다시 실행하세요.");
  hash(r.prompt_digest);
  const payload:Record<string,unknown>={source:nested.input,extraction:{observations:nested.accepted},deterministic_findings:nested.findings};
  const acceptedIds=new Set(arr(nested.accepted,12).map(v=>str(obj(v).id,80)));
  const links=review.rows.filter(row=>acceptedIds.has(row.id)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).flatMap(row=>Object.entries(row.fields).sort(([a],[b])=>a<b?-1:a>b?1:0).filter(([,f])=>['confirmed','corrected'].includes(f.decision)&&f.current.supporting?.length).map(([field,f])=>({observation_id:row.id,field,citations:f.current.supporting})));
  if(links.length){if(r.prompt_version!=='human-review-recritique/2')fail();payload.field_context_citations=links;}
  const rates=Object.fromEntries(Object.entries(obj(nested.normalized_rates??{})).filter(([id])=>acceptedIds.has(id)));
  if(Object.keys(rates).length)payload.user_normalized_rates=rates;
  if (hash(r.request_digest) !== await digest(canonical(payload))) fail("AI 요청 내용의 hash가 일치하지 않습니다.");
  const candidateSet = new Set(rules.acceptedIds);
  function ids(v: unknown, allowed: Set<string>, unique = true): string[] {
    const list = arr(v, 12).map(v => str(v, 80));
    if (list.some(id => !allowed.has(id)) || (unique && new Set(list).size !== list.length)) fail();
    return list;
  }
  const candidateIds = ids(r.candidate_ids, candidateSet), remainingIds = ids(r.remaining_draft_ids, candidateSet), withheldIds = ids(r.withheld_by_model_ids, candidateSet);
  if (!sameSet(candidateIds, rules.acceptedIds)) fail();
  const budgets = obj(r.budgets);
  if (budgets.max_calls !== 1 || budgets.max_repairs !== 0 || typeof budgets.seconds !== "number" || !(budgets.seconds > 0 && budgets.seconds <= 120)) fail();
  const maxOutput = integer(budgets.max_output_tokens, 512, 8000), maxTotal = integer(budgets.max_total_tokens, 1000, 300000);
  const calls = arr(r.calls, 1).map(obj), errors = arr(r.errors, 1).map(v => str(v, 100));
  let inputTokens: number | null = null, outputTokens: number | null = null;
  const call = calls[0];
  if (call) {
    if (call.stage !== "RECRITIQUE" || !["RECEIVED", "FAILED_OR_CANCELLED"].includes(str(call.outcome, 40))) fail();
    if ((call.input_tokens === null) !== (call.output_tokens === null)) fail();
    if (call.input_tokens !== null) { inputTokens = integer(call.input_tokens, 0, Number.MAX_SAFE_INTEGER); outputTokens = integer(call.output_tokens, 0, Number.MAX_SAFE_INTEGER); }
    if (call.response_id !== null) str(call.response_id, 200);
    if (call.outcome === "RECEIVED" && (inputTokens === null || call.response_id === null)) fail();
    arr(call.notices, 30).forEach(v => str(v));
  }
  const spent = (inputTokens ?? 0) + (outputTokens ?? 0);
  let concerns: Concern[] = [], questions: string[] = [];
  if (r.status === "COMPLETED") {
    if (!candidateIds.length || !call || call.outcome !== "RECEIVED" || spent > maxTotal || errors.length || 102000 + maxOutput > maxTotal) fail();
    const critique = obj(r.critique); exact(critique, ["concerns", "next_questions"]);
    const spanIds = new Set(arr(obj(nested.input).spans, 40).map(v => str(obj(v).id, 80)));
    concerns = arr(critique.concerns, 12).map(v => {
      const c = obj(v); exact(c, ["scope", "observation_ids", "span_ids", "reason"]);
      if (c.scope !== "observation_error" && c.scope !== "comparison_limitation") fail();
      const observations = ids(c.observation_ids, candidateSet, false), spans = ids(c.span_ids, spanIds, false);
      if (!observations.length || !spans.length) fail();
      return { scope: c.scope, observation_ids: observations, span_ids: spans, reason: str(c.reason) };
    });
    questions = arr(critique.next_questions, 8).map(v => str(v));
    const expectedFindings = concerns.flatMap<Finding>(c => c.scope === "comparison_limitation"
      ? [{ code: "MODEL_COMPARISON_LIMITATION", observation_id: null, field: null, detail: c.reason }]
      : c.observation_ids.map(id => ({ code: "MODEL_CONCERN", observation_id: id, field: null, detail: c.reason })));
    if (!same(r.model_findings, expectedFindings)) fail();
    const excluded = [...new Set(concerns.filter(c => c.scope === "observation_error").flatMap(c => c.observation_ids))];
    if (!sameSet(withheldIds, excluded) || !sameSet(remainingIds, candidateIds.filter(id => !excluded.includes(id)))) fail("AI 쟁점과 남음·보류 집계가 일치하지 않습니다.");
  } else {
    if (r.critique !== null || !same(r.model_findings, []) || remainingIds.length || withheldIds.length) fail("미완료 실행에 완료된 AI 의견이 들어 있습니다.");
    if (r.status === "NO_CANDIDATES") {
      if (candidateIds.length || calls.length || errors.length) fail();
    } else if (r.status === "FAILED") {
      if (!candidateIds.length || !call || errors.length !== 1 || !["RECRITIQUE_TIMEOUT", "INVALID_CRITIQUE_SCHEMA", "INVALID_CRITIQUE_REFERENCE", "MODEL_REQUEST_FAILED"].includes(errors[0])) fail();
    } else if (r.status === "BUDGET_EXCEEDED") {
      if (!candidateIds.length || errors.length !== 1) fail();
      if (errors[0] === "REQUEST_RESERVATION_EXCEEDED") { if (calls.length || 102000 + maxOutput <= maxTotal) fail(); }
      else if (errors[0] === "REPORTED_TOKEN_BUDGET_EXCEEDED") { if (!call || call.outcome !== "RECEIVED" || spent <= maxTotal) fail(); }
      else fail();
    } else fail();
  }
  return { runId: str(r.run_id, 100), reviewKey: rules.reviewKey, mode: r.execution_mode, model: str(r.model, 200),
    status: r.status, rules, candidateIds, remainingIds, withheldIds, concerns, questions, errors,
    callCount: calls.length, inputTokens, outputTokens };
}

/** A concern names whole spans, not a field or an exact quote. Never invent either. */
export function concernSpans(concern: Concern, source: PdfSource): PdfSpan[] {
  const ids = new Set(concern.span_ids);
  return source.pages.flatMap(p => p.spans).filter(s => ids.has(s.id));
}
export function isRecritiqueCurrent(result: RecritiqueResult, review: FieldReview, source: PdfSource, draft = false): boolean {
  return !draft && source.sha256 === review.sourceDigest && result.reviewKey === reviewKey(review, source);
}
