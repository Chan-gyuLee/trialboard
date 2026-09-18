/** Restore untrusted user records locally. Consistency is not authorship or clinical approval. */
import type { PdfSource } from "./pdf-contract.ts";
import {normalizedRate,type RateNormalization} from './rate-normalization.ts';
import { canonical, exportReview, FIELD_NAMES, locate, REVIEW_LIMITS, strictJson, validateCheckedValue, validateSupporting, type SupportingCitation,
  type Decision, type FieldName, type FieldReview, type ReviewField, type ReviewRow, type Revision, type Value } from "./field-review.ts";

function fail(message = "이력 JSON의 형식이나 수정 기록이 일치하지 않습니다. 기존 검토는 유지됩니다."): never { throw new Error(message); }
function obj(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v) || canonical(Object.keys(v).sort()) !== canonical([...keys].sort())) fail();
  return v as Record<string, unknown>;
}
function str(v: unknown, max = 2000): string {
  if (typeof v !== "string" || !v.length || v.length > max || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)) fail();
  return v;
}
const arr = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : fail();
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const hash = (v: unknown): string => /^[a-f0-9]{64}$/.test(str(v, 64)) ? v as string : fail();
const id = (v: unknown): string => /^[a-zA-Z0-9_-]{1,80}$/.test(str(v, 80)) ? v as string : fail();
function timestamp(v: unknown): string {
  const text = str(v, 50);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!m || !Number.isFinite(Date.parse(text))) fail();
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!year || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) fail();
  if (m[8] !== "Z" && (Number(m[8].slice(1, 3)) > 23 || Number(m[8].slice(4)) > 59)) fail();
  return text;
}

export function restoreReview(raw: string, source: PdfSource): FieldReview {
  const r = obj(strictJson(raw), ["schemaVersion", "sourceDigest", "origin", "rows", "modelFindings", "sourceName", "persisted", "reviewerIdentity", "clinicalApproval", "downstreamStatus", "limitations"]);
  if (!["pdf-field-review/1","pdf-field-review/2","pdf-field-review/3"].includes(String(r.schemaVersion))) fail("‘이력 JSON’으로 내려받은 필드 검토 파일을 선택하세요. 에이전트·재검증 결과는 별도 버튼에서 불러옵니다.");
  if (hash(r.sourceDigest) !== source.sha256) fail("다른 PDF의 검토 이력입니다. 저장할 때 사용한 동일한 원본 PDF를 열어 주세요.");
  if (r.persisted !== false || r.reviewerIdentity !== "UNAUTHENTICATED_USER" || r.clinicalApproval !== false || r.downstreamStatus !== "REQUIRES_REVALIDATION") fail("임상 승인·검토자 인증·재검증 완료를 주장하는 이력은 복구할 수 없습니다.");
  const origin = obj(r.origin, ["kind", "runId", "reportDigest", "mode"]);
  if (origin.kind === "manual") {
    if (origin.runId !== null || origin.reportDigest !== null || origin.mode !== null) fail();
  } else if (origin.kind === "imported_agent_report") {
    str(origin.runId, 100); hash(origin.reportDigest);
    if (typeof origin.mode !== "string" || !["CODEX_CHATGPT", "DACON_RESPONSES", "OPENAI_RESPONSES", "SCRIPTED_TEST_DOUBLE"].includes(origin.mode)) fail();
  } else fail();
  function value(v: unknown): Value {
    const hasSupport=!!v && typeof v==='object' && Object.hasOwn(v,'supporting');
    const hasNormalization=!!v&&typeof v==='object'&&Object.hasOwn(v,'normalization');
    if(hasSupport && r.schemaVersion==='pdf-field-review/1'||hasNormalization&&r.schemaVersion!=='pdf-field-review/3')fail();
    const cell = obj(v, ["value","citation",...(hasSupport?['supporting']:[]),...(hasNormalization?['normalization']:[])]);
    const text = cell.value === null ? null : str(cell.value);
    if (cell.citation === null) {if(hasSupport||hasNormalization)fail();return { value: text, citation: null };}
    if (text === null) fail();
    const c = obj(cell.citation, ["spanId", "page", "quote"]);
    if (!Number.isInteger(c.page) || Number(c.page) < 1 || Number(c.page) > 40) fail();
    const citation = { spanId: id(c.spanId), page: Number(c.page), quote: str(c.quote) };
    if (!locate(source, citation)) fail("이력의 페이지·문구·인용문이 현재 PDF와 다릅니다. 원본과 추출기 버전을 확인하세요.");
    const result:Value={value:text,citation};
    if(hasSupport)result.supporting=arr(cell.supporting,4).map(v=>{const s=obj(v,['spanId','page','quote','role']);if(!Number.isInteger(s.page))fail();return {spanId:id(s.spanId),page:Number(s.page),quote:str(s.quote),role:str(s.role,20) as SupportingCitation['role']};});
    if(hasNormalization)result.normalization=cell.normalization as RateNormalization;
    validateSupporting(source,result);normalizedRate(result,source);return result;
  }
  const ids = new Set<string>();
  const rows = arr(r.rows, REVIEW_LIMITS.rows).map(v => {
    const row = obj(v, ["id", "origin", "valueKind", "fields"]), rowId = id(row.id);
    if (ids.has(rowId)) fail(); ids.add(rowId);
    if (row.origin !== "manual" && row.origin !== "imported_agent_report") fail();
    if (origin.kind === "manual" && row.origin !== "manual") fail();
    if (row.valueKind !== "event_count" && row.valueKind !== "reported_percentage") fail();
    const kind = row.valueKind;
    const input = obj(row.fields, FIELD_NAMES), fields = {} as Record<FieldName, ReviewField>;
    for (const name of FIELD_NAMES) {
      const f = obj(input[name], ["original", "current", "decision", "history"]);
      const original = value(f.original), current = value(f.current);
      for(const v of [original,current])normalizedRate(v,source,name,kind);
      if (row.origin === "manual" && (original.value !== null || original.citation !== null)) fail();
      let previous = original, decision: Decision = "unreviewed";
      const history: Revision[] = arr(f.history, REVIEW_LIMITS.revisions).map((h, index) => {
        const rev = obj(h, ["revision", "decision", "before", "after", "reason", "at"]);
        if (rev.revision !== index + 1 || typeof rev.decision !== "string" || !["confirmed", "corrected", "held"].includes(rev.decision)) fail();
        const before = value(rev.before), after = value(rev.after), reason = str(rev.reason);
        for(const v of [before,after])normalizedRate(v,source,name,kind);
        if (!reason.trim() || !same(before, previous)) fail();
        if (rev.decision === "corrected" ? same(before, after) : !same(before, after)) fail();
        if (rev.decision !== "held") validateCheckedValue(source, kind, name, after);
        decision = rev.decision as Revision["decision"]; previous = after;
        return { revision: index + 1, decision, before, after, reason, at: timestamp(rev.at) };
      });
      if (f.decision !== decision || !same(current, previous)) fail("현재 값·상태가 저장된 수정 이력의 마지막 기록과 다릅니다.");
      fields[name] = { original, current, decision, history };
    }
    return { id: rowId, origin: row.origin, valueKind: kind, fields } as ReviewRow;
  });
  const modelFindings = arr(r.modelFindings, 300).map(v => str(v, 8100));
  if (origin.kind === "manual" && modelFindings.length) fail();
  return { schemaVersion: r.schemaVersion as FieldReview['schemaVersion'], sourceDigest: source.sha256,
    origin: { kind: origin.kind, runId: origin.runId, reportDigest: origin.reportDigest, mode: origin.mode } as FieldReview["origin"], rows, modelFindings,
    exportMetadata: { sourceName: str(r.sourceName), limitations: arr(r.limitations, 20).map(v => str(v)) } };
}

/** Do not offer a backup our bounded reader cannot restore. Markdown remains separately available. */
export function reviewBackup(review: FieldReview, source: PdfSource): string {
  const raw = JSON.stringify(exportReview(review, source), null, 2);
  restoreReview(raw, source);
  return raw;
}
