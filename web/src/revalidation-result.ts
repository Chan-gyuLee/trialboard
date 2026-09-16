/** Inspect a local report, never execute or certify the Python verifier in the browser. */
import { canonical, exportReview, FIELD_NAMES, locate, strictJson, type FieldName, type FieldReview } from "./field-review.ts";
import type { PdfSource } from "./pdf-contract.ts";

export const RESULT_BYTES = 8 * 1024 * 1024;
export type Finding = { code: string; observation_id: string | null; field: FieldName | null; detail: string };
export type RevalidationResult = {
  runId: string; reviewKey: string; rulesDigest: string; question: string; study: string;
  acceptedIds: string[]; excludedIds: string[]; findings: Finding[];
  delta: { added: Finding[]; no_longer_emitted: Finding[]; unchanged: Finding[] };
};
function fail(message = "재검증 결과의 형식·참조·검토 상태가 일치하지 않습니다."): never { throw new Error(message); }
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const arr = (v: unknown, max = 2000): unknown[] => Array.isArray(v) && v.length <= max ? v : fail();
const str = (v: unknown, max = 2000, empty = false): string => typeof v === "string" && (empty || v.length > 0) && v.length <= max ? v : fail();
const hash = (v: unknown): string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v) ? v : fail();
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const sorted = (values: unknown[]) => values.map(canonical).sort();
const sameSet = (a: unknown[], b: unknown[]) => same(sorted(a), sorted(b));

export function reviewKey(review: FieldReview, source: PdfSource): string {
  return canonical(exportReview(review, source));
}
export function isCurrent(result: RevalidationResult, review: FieldReview, source: PdfSource, hasDraft = false): boolean {
  return !hasDraft && review.sourceDigest === source.sha256 && result.reviewKey === reviewKey(review, source);
}
export function readResult(raw: string, review: FieldReview, source: PdfSource): RevalidationResult {
  const r = obj(strictJson(raw, RESULT_BYTES, 500000));
  if (r.schema_version !== "field-revalidation/1" || r.execution_mode !== "LOCAL_DETERMINISTIC_REVALIDATION"
      || r.model_calls !== 0 || r.clinical_approval !== false || r.reviewer_identity !== "UNAUTHENTICATED_USER"
      || r.comparison_status !== "NOT_APPROVED" || r.critique_status !== "NOT_RERUN"
      || r.source_integrity !== "PDF_BYTES_HASH_MATCH_TEXT_AND_GEOMETRY_NOT_REEXTRACTED") fail("로컬 규칙 재검증 1 결과만 지원합니다. AI 반론 재실행·임상 승인 결과는 아닙니다.");
  const key = reviewKey(review, source);
  if (r.source_digest !== source.sha256 || !same(r.review, exportReview(review, source))) {
    fail("현재 PDF 또는 기록한 필드 검토와 다른 결과입니다. 현재 이력으로 다시 재검증해 주세요.");
  }
  hash(r.review_digest); hash(r.source_export_digest);
  if (r.agent_report_digest !== review.origin.reportDigest) fail();
  const input = obj(r.input), spans = arr(input.spans, 40);
  if (input.provenance !== "user_pdf_export_unverified" || !spans.length) fail();
  for (const name of ["asset", "indication", "study", "question"]) str(input[name]);
  const seenSpans = new Set<string>();
  for (const value of spans) {
    const s = obj(value), id = str(s.id, 80), page = s.page;
    if (seenSpans.has(id) || !Number.isInteger(page) || s.source_digest !== source.sha256) fail();
    seenSpans.add(id);
    const actual = source.pages[Number(page) - 1]?.spans.find(p => p.id === id);
    if (!actual || actual.text !== s.text || actual.page !== page) fail("재검증 입력 문구가 현재 PDF 추출 문구와 일치하지 않습니다.");
  }
  const ids = new Set(review.rows.map(row => row.id));
  function idList(value: unknown): string[] {
    const values = arr(value, 12).map(v => str(v, 80));
    if (new Set(values).size !== values.length || values.some(id => !ids.has(id))) fail();
    return values;
  }
  const heldIds = review.rows.filter(row => Object.values(row.fields).some(f => f.decision === "held")).map(row => row.id);
  const excludedIds = idList(r.excluded_observation_ids);
  if (!sameSet(excludedIds, heldIds)) fail("보류 관측값의 제외 상태가 일치하지 않습니다.");
  for (const row of review.rows) for (const f of Object.values(row.fields)) {
    for (const value of [f.original, f.current]) {
      if (value.citation && (!seenSpans.has(value.citation.spanId) || !locate(source, value.citation))) fail();
      for(const c of value.supporting??[])if(!seenSpans.has(c.spanId)||!locate(source,c))fail();
    }
  }
  const expected = review.rows.filter(row => !heldIds.includes(row.id)).map(row => ({
    id: row.id, value_kind: row.valueKind, fields: Object.fromEntries(FIELD_NAMES.map(name => {
      const f = row.fields[name], v = f.decision === "confirmed" || f.decision === "corrected" ? f.current : null;
      return [name, { value: v?.value ?? null, span_id: v?.citation?.spanId ?? null, quote: v?.citation?.quote ?? null }];
    })),
  }));
  const effective = arr(obj(r.effective_extraction).observations, 12);
  if (!sameSet(effective, expected)) fail("미확인·보류값이 재검증 입력에 섞였거나 기록한 값이 바뀌었습니다.");
  const accepted = arr(r.accepted, 12), acceptedIds = idList(accepted.map(v => obj(v).id));
  if (accepted.some(o => !expected.some(e => same(o, e)))) fail("결과 관측값이 실제 검토 입력과 다릅니다.");
  if (r.status !== (accepted.length ? "DRAFT_FOR_EXPERT_REVIEW" : "NO_REVIEWABLE_OBSERVATIONS")) fail();
  function findings(value: unknown): Finding[] {
    const list = arr(value).map(v => {
      const f = obj(v);
      if (!same(Object.keys(f).sort(), ["code", "detail", "field", "observation_id"])) fail();
      if (f.observation_id !== null && !ids.has(str(f.observation_id, 80))) fail();
      if (f.field !== null && !FIELD_NAMES.includes(f.field as FieldName)) fail();
      return { code: str(f.code, 100), observation_id: f.observation_id as string | null,
        field: f.field as FieldName | null, detail: str(f.detail, 8100, true) };
    });
    if (new Set(list.map(canonical)).size !== list.length) fail();
    return list;
  }
  const current = findings(r.findings), baseline = obj(r.baseline), delta = obj(r.finding_delta);
  if (baseline.kind !== "ORIGINAL_VALUES_SAME_DETERMINISTIC_RULES_NOT_PRIOR_AI_APPROVAL") fail();
  idList(baseline.accepted_ids);
  const before = findings(baseline.findings), oldKeys = new Set(before.map(canonical)), newKeys = new Set(current.map(canonical));
  const added = findings(delta.added), removed = findings(delta.no_longer_emitted), unchanged = findings(delta.unchanged);
  if (!sameSet(added, current.filter(f => !oldKeys.has(canonical(f))))
      || !sameSet(removed, before.filter(f => !newKeys.has(canonical(f))))
      || !sameSet(unchanged, current.filter(f => oldKeys.has(canonical(f))))) fail("수정 전후 쟁점 목록이 일치하지 않습니다.");
  return { runId: str(r.run_id, 100), reviewKey: key, rulesDigest: hash(r.rules_digest),
    question: str(input.question), study: str(input.study), acceptedIds, excludedIds, findings: current,
    delta: { added, no_longer_emitted: removed, unchanged } };
}

const LABELS: Record<string, string> = {
  FIELD_HELD: "사용자가 보류한 필드", FIELD_UNREVIEWED: "아직 확인하지 않은 필드", MISSING_FIELD: "필수 정보 미보고",
  QUOTE_NOT_IN_SOURCE: "인용문을 원문에서 찾지 못함", VALUE_NOT_IN_QUOTE: "값이 인용문에 없음",
  CONTEXT_MISMATCH: "약물·적응증·시험 문맥 불일치", INVALID_COUNT: "사건 수·분모 형식 확인 필요",
  INVALID_DENOMINATOR: "분모 또는 사건 수 범위 오류", COUNT_ROLE_UNSUPPORTED: "숫자를 사건 수로 해석할 근거 부족",
  SECOND_DOSE_MISSING: "비교할 두 번째 용량 근거 부족", ENDPOINT_MISSING: "반응·이상반응 근거 부족",
  COMPARISON_CONTEXT_MISMATCH: "환자군·기간·정의가 달라 비교 제한", DUPLICATE_DOSE_METRIC: "중복 관측값 충돌",
  UNSUPPORTED_METRIC: "지원하지 않는 지표명", REPORTED_RATE_ONLY: "비율만 보고됨 · 사건 수 역산 불가",
  NO_OBSERVATIONS: "규칙 검사 대상 관측값 없음", RATE_BINDING_UNVERIFIED: "비율과 환자군 연결 미확인",
  RATE_POPULATION_MISMATCH: "비율·분모·환자군 연결 불일치", RATE_COUNT_MISMATCH: "보고 비율과 사건 수 불일치",
  ENDPOINT_SUBTYPE_MISMATCH: "서로 다른 하위 평가변수", INVALID_REPORTED_PERCENTAGE: "보고 비율 형식 오류",
};
export const findingLabel = (code: string) => LABELS[code] ?? `검사 항목: ${code}`;
export function findingTargets(finding: Finding, review: FieldReview): { rowId: string; field: FieldName | null }[] {
  return review.rows.filter(row => finding.observation_id === null || finding.observation_id === row.id)
    .map(row => ({ rowId: row.id, field: finding.field }));
}
