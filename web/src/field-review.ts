import type { PdfSource, PdfSpan } from "./pdf-contract";

export const FIELD_LABELS = {
  asset: "약물", indication: "적응증", study: "시험", cohort: "코호트", dose: "용량·투여 일정",
  metric: "원문 지표명", events: "사건 수", denominator: "분모", population: "분석집단",
  window: "평가 기간", definition: "지표 정의", reported_rate: "보고 비율",
} as const;
export type FieldName = keyof typeof FIELD_LABELS;
export const FIELD_NAMES = Object.keys(FIELD_LABELS) as FieldName[];
export type Citation = { spanId: string; page: number; quote: string };
export const SUPPORT_ROLES = {header:'표 머리글',unit:'단위',footnote:'각주',context:'주변 문맥'} as const;
export type SupportingCitation = Citation & {role:keyof typeof SUPPORT_ROLES};
export type Value = { value: string | null; citation: Citation | null; supporting?:SupportingCitation[] };
export type Decision = "unreviewed" | "confirmed" | "corrected" | "held";
export type Revision = { revision: number; decision: Exclude<Decision, "unreviewed">; before: Value; after: Value; reason: string; at: string };
export type ReviewField = { original: Value; current: Value; decision: Decision; history: Revision[] };
export type ReviewRow = { id: string; origin: "manual" | "imported_agent_report"; valueKind: "event_count" | "reported_percentage"; fields: Record<FieldName, ReviewField> };
export type FieldReview = {
  schemaVersion: "pdf-field-review/1" | "pdf-field-review/2"; sourceDigest: string;
  origin: { kind: "manual" | "imported_agent_report"; runId: string | null; reportDigest: string | null; mode: string | null };
  rows: ReviewRow[]; modelFindings: string[];
  /** Preserve historical export identity (including a renamed PDF) for result matching. Not an authentication claim. */
  exportMetadata?: { sourceName: string; limitations: string[] };
};
export const REVIEW_LIMITS = { bytes: 2_000_000, rows: 12, revisions: 40 } as const;
function fail(message = "검토 결과의 형식 또는 출처를 확인할 수 없습니다."): never { throw new Error(message); }
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const string = (v: unknown, max = 2000): string => typeof v === "string" && v.length > 0 && v.length <= max ? v : fail();
const array = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : fail();
const empty = (): Value => ({ value: null, citation: null });
const clone = <T,>(v: T): T => structuredClone(v);

/** Bounded JSON parser rejects duplicate/prototype keys before interpreting report claims. */
export function strictJson(raw: string, maxBytes: number = REVIEW_LIMITS.bytes, maxNodes = 70000): unknown {
  if (new TextEncoder().encode(raw).length > maxBytes) fail("결과 JSON이 지원 크기를 초과했습니다.");
  let pos = 0, nodes = 0;
  const ws = () => { while (/[ \t\r\n]/.test(raw[pos] ?? "") && pos < raw.length) pos++; };
  function read(depth: number): unknown {
    if (depth > 30 || ++nodes > maxNodes) fail();
    ws(); const ch = raw[pos];
    if (ch === '"') {
      const match = /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(raw.slice(pos));
      if (!match) fail(); pos += match[0].length; return JSON.parse(match[0]);
    }
    if (ch === "{" || ch === "[") {
      pos++; ws(); const close = ch === "{" ? "}" : "]";
      const values: unknown[] = [], result: Record<string, unknown> = Object.create(null);
      const seen = new Set<string>();
      if (raw[pos] === close) { pos++; return ch === "{" ? result : values; }
      while (true) {
        if (ch === "{") {
          if (raw[pos] !== '"') fail();
          const key = read(depth + 1); if (typeof key !== "string" || seen.has(key) || ["__proto__", "constructor", "prototype"].includes(key)) fail();
          seen.add(key); ws(); if (raw[pos++] !== ":") fail(); result[key] = read(depth + 1);
        } else values.push(read(depth + 1));
        ws(); const sep = raw[pos++]; if (sep === close) break; if (sep !== ",") fail(); ws();
      }
      return ch === "{" ? result : values;
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(pos));
    if (!match) fail(); pos += match[0].length;
    const value = JSON.parse(match[0]); if (typeof value === "number" && !Number.isFinite(value)) fail(); return value;
  }
  const result = read(0); ws(); if (pos !== raw.length) fail(); return result;
}
export const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
};
export async function digest(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}
export function newReview(source: PdfSource): FieldReview {
  return { schemaVersion: "pdf-field-review/1", sourceDigest: source.sha256,
    origin: { kind: "manual", runId: null, reportDigest: null, mode: null }, rows: [], modelFindings: [] };
}
export function addRow(review: FieldReview, id: string, valueKind: ReviewRow["valueKind"]): FieldReview {
  if (valueKind !== "event_count" && valueKind !== "reported_percentage") fail();
  if (review.rows.length >= REVIEW_LIMITS.rows || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || review.rows.some(r => r.id === id)) fail("관측값은 중복 없이 12개까지 지원합니다.");
  const next = clone(review);
  const fields = {} as ReviewRow["fields"];
  for (const k of FIELD_NAMES) fields[k] = { original: empty(), current: empty(), decision: "unreviewed", history: [] };
  next.rows.push({ id, origin: "manual", valueKind, fields });
  return next;
}
export function locate(source: PdfSource, citation: Citation | null): PdfSpan | null {
  if (!citation || !citation.quote.trim() || !Number.isInteger(citation.page)) return null;
  const span = source.pages[citation.page - 1]?.spans.find(s => s.id === citation.spanId);
  return span && span.page === citation.page && span.text.includes(citation.quote) ? span : null;
}
/** Same-page contextual links only. They never authorize a new value or unit. */
export function validateSupporting(source:PdfSource,value:Value):void {
  if(value.supporting===undefined)return;
  if(!Array.isArray(value.supporting)||!value.supporting.length||value.supporting.length>4||!value.value||!value.citation)fail('보조 근거는 기본 근거와 함께 1–4개 연결하세요.');
  const seen=new Set([value.citation.spanId]);
  for(const c of value.supporting){
    if(!Object.hasOwn(SUPPORT_ROLES,c.role)||seen.has(c.spanId)||c.page!==value.citation.page||c.quote.length>2000||!locate(source,c)?.box)fail('보조 근거는 같은 페이지의 서로 다른 원문 문구여야 합니다.');
    seen.add(c.spanId);
  }
}
export function attachSupporting(source:PdfSource,value:Value,span:PdfSpan,role:SupportingCitation['role']):Value {
  const next={...clone(value),supporting:[...(value.supporting??[]),{spanId:span.id,page:span.page,quote:span.text,role}]};
  validateSupporting(source,next);return next;
}
export async function importAgentReport(raw: string, source: PdfSource): Promise<FieldReview> {
  const report = object(strictJson(raw)), input = object(report.input);
  if (report.engine_version !== "bounded-evidence-agent/3.2" || input.provenance !== "user_pdf_export_unverified") fail("현재 PDF와 연결된 에이전트 3.2 결과만 지원합니다. 웹 발췌·가상자료 결과는 연결할 수 없습니다.");
  if (!["DRAFT_FOR_EXPERT_REVIEW", "PARTIAL_ABSTENTION"].includes(String(report.status))) fail("실패·예산 초과 결과는 검토 초안으로 불러올 수 없습니다.");
  if (!["CODEX_CHATGPT", "DACON_RESPONSES", "OPENAI_RESPONSES", "SCRIPTED_TEST_DOUBLE"].includes(String(report.execution_mode))) fail();
  if (await digest(canonical(input)) !== report.input_digest) fail("결과의 입력 hash가 일치하지 않습니다.");
  const spans = array(input.spans, 40); if (!spans.length) fail();
  const seen = new Set<string>();
  for (const value of spans) {
    const s = object(value), id = string(s.id, 80);
    if (seen.has(id)) fail(); seen.add(id);
    if (s.source_digest !== source.sha256 || !Number.isInteger(s.page)) fail("다른 PDF 또는 버전의 결과입니다. 같은 원본 PDF를 열어 주세요.");
    const span = source.pages[Number(s.page) - 1]?.spans.find(p => p.id === id);
    if (!span || span.text !== s.text || span.page !== s.page) fail("PDF 추출 문구·페이지가 결과와 일치하지 않습니다. 원본과 추출기 버전을 확인하세요.");
  }
  const attempts = array(report.attempts, 3); if (!attempts.length) fail();
  const last = object(attempts.at(-1)), extraction = object(last.extraction);
  const rows = array(extraction.observations, 12); if (!rows.length) fail("검토할 관측값 초안이 없습니다.");
  let next = newReview(source);
  next.origin = { kind: "imported_agent_report", runId: string(report.run_id, 100), reportDigest: await digest(raw), mode: string(report.execution_mode, 40) };
  for (const value of rows) {
    const row = object(value), fields = object(row.fields), id = string(row.id, 80);
    if (row.value_kind !== "event_count" && row.value_kind !== "reported_percentage") fail();
    next = addRow(next, id, row.value_kind);
    const target = next.rows.at(-1)!;
    target.origin = "imported_agent_report";
    if (Object.keys(fields).length !== FIELD_NAMES.length) fail();
    for (const name of FIELD_NAMES) {
      const f = object(fields[name]);
      const cell: Value = f.value === null ? empty() : { value: string(f.value), citation: null };
      if (f.value === null && (f.quote !== null || f.span_id !== null)) fail();
      if (f.value !== null && f.span_id !== null && f.quote !== null) {
        const sid = string(f.span_id, 80), quote = string(f.quote);
        const s = spans.map(object).find(p => p.id === sid);
        if (s && (s.text as string).includes(quote)) cell.citation = { spanId: sid, page: Number(s.page), quote };
      }
      target.fields[name] = { original: clone(cell), current: clone(cell), decision: "unreviewed", history: [] };
    }
  }
  next.modelFindings = array(last.findings, 300).map(f => { const item = object(f); return [string(item.code, 100), item.observation_id, item.field, item.detail].filter(v => typeof v === "string" && v).map(v => string(v)).join(" · "); });
  return next;
}
export function decide(review: FieldReview, source: PdfSource, rowId: string, name: FieldName,
  action: Exclude<Decision, "unreviewed">, proposed: Value, reason: string, readyPage: number | null,
  attested: boolean, now = new Date()): FieldReview {
  if (review.sourceDigest !== source.sha256 || !FIELD_NAMES.includes(name) || !["confirmed", "corrected", "held"].includes(action)) fail();
  const next = clone(review), row = next.rows.find(r => r.id === rowId); if (!row) fail();
  const field = row.fields[name];
  if (field.history.length >= REVIEW_LIMITS.revisions) fail("필드당 수정 이력 한도에 도달했습니다. 내보내기 후 새 검토를 시작하세요.");
  if (!reason.trim() || reason.length > 2000) fail("확인·수정·보류 사유를 입력하세요.");
  const after = action === "held" ? clone(field.current) : clone(proposed);
  if (action !== "held") {
    validateCheckedValue(source, row.valueKind, name, after);
    const span = locate(source, after.citation);
    if (!span || readyPage !== span.page || !attested) fail("값이 포함된 원문 위치를 열고 직접 대조한 뒤 확인하세요.");
    if (action === "confirmed" && canonical(after) !== canonical(field.current)) fail("값이나 근거를 바꾼 경우 수정으로 기록하세요.");
    if (action === "corrected" && canonical(after) === canonical(field.current)) fail("변경 없는 값은 확인으로 기록하세요.");
  }
  field.history.push({ revision: field.history.length + 1, decision: action, before: clone(field.current), after: clone(after), reason: reason.trim(), at: now.toISOString() });
  field.current = after; field.decision = action;
  if(after.supporting?.length)next.schemaVersion='pdf-field-review/2';
  return next;
}
/** Literal source and numeric-shape checks, not clinical interpretation or reviewer authentication. */
export function validateCheckedValue(source: PdfSource, kind: ReviewRow["valueKind"], name: FieldName, after: Value): void {
  validateSupporting(source,after);
  if (!locate(source, after.citation)?.box || !after.value?.trim() || after.value.length > 2000 || !after.citation?.quote.includes(after.value)) fail("기록된 확인값과 현재 PDF 근거가 일치하지 않습니다.");
  if (after.citation.quote.length > 2000) fail("근거 인용문은 2,000자 이내만 지원합니다.");
  if (name === "events" && kind === "reported_percentage") fail("비율 자료에서 사건 수를 채우거나 역산할 수 없습니다. 미보고로 두세요.");
  if ((name === "events" || name === "denominator") && (!/^\d{1,7}$/.test(after.value) || (name === "denominator" && Number(after.value) === 0))) fail("사건 수·분모는 원문에 보고된 정수여야 합니다. 분모는 0일 수 없습니다.");
  if ((name === "events" || name === "denominator") && !new RegExp(`(?<![\\w.,+−–—-])${after.value}(?![\\w]|[.,]\\d|\\s*[%％])`, "u").test(after.citation.quote)) fail("비율·소수·다른 숫자의 일부를 사건 수나 분모로 사용할 수 없습니다.");
  if (name === "reported_rate" && (!/^\d{1,3}(?:\.\d{1,4})?\s*%$/.test(after.value) || Number(after.value.replace("%", "")) > 100)) fail("원문에 보고된 0–100% 비율만 입력하세요.");
}
export function exportReview(review: FieldReview, source: PdfSource) {
  if (review.sourceDigest !== source.sha256) fail();
  for (const row of review.rows) for (const field of Object.values(row.fields)) {
    validateSupporting(source,field.current);
    if (field.current.citation && !locate(source, field.current.citation)) fail("현재 PDF와 맞지 않는 근거가 있습니다.");
  }
  const { exportMetadata, ...content } = clone(review);
  return { ...content, sourceName: exportMetadata?.sourceName ?? source.name, persisted: false, reviewerIdentity: "UNAUTHENTICATED_USER",
    clinicalApproval: false, downstreamStatus: "REQUIRES_REVALIDATION",
    limitations: exportMetadata?.limitations ?? ["사용자 확인은 임상 승인이나 인증된 전문가 검증이 아닙니다.", "수정값으로 AI 반론·비교·계산을 다시 실행하지 않았습니다.", "단일 추출 문구의 근거만 연결합니다. 표 머리글·각주·문단 전체의 의미를 자동 검증하지 않습니다.", "검토를 이어가려면 같은 원본 PDF와 이력 JSON을 다시 여세요. 원문 메모·모델 결과·재검증 결과 파일은 별도로 보관해야 합니다."] };
}
const escape = (s: string) => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!)).replace(/([\\`*_{}\[\]()#+.!|~-])/g, "\\$1").replace(/[\r\n]+/g, " ");
export function reviewMarkdown(review: FieldReview, source: PdfSource): string {
  const packet = exportReview(review, source);
  return ["# PDF 필드 검토 기록", "", `자료: ${escape(source.name)}`, `PDF SHA-256: ${source.sha256}`,
    "사용자 확인 초안 · 임상 승인 아님 · 변경 후 재검증 필요", "",
    ...review.rows.flatMap(row => [`## ${escape(row.id)} · ${row.valueKind} · ${row.origin}`, "", ...FIELD_NAMES.flatMap(name => {
      const f = row.fields[name]; return [`- ${FIELD_LABELS[name]}: ${escape(f.current.value ?? "미보고")} · ${f.decision}`,
        `  원래 값: ${escape(f.original.value ?? "미보고")}`,
        `  근거: ${f.current.citation ? `PDF p.${f.current.citation.page} · ${escape(f.current.citation.spanId)} · ${escape(f.current.citation.quote)}` : "없음"}`,
        ...(f.current.supporting??[]).map(c=>`  보조 근거 (${SUPPORT_ROLES[c.role]}): PDF p.${c.page} · ${escape(c.spanId)} · ${escape(c.quote)} · 의미 관계 미인증`),
        ...f.history.map(h => `  이력 ${h.revision}: ${h.decision} · ${escape(h.reason)} · ${h.at}`)]; }), ""]),
    "## 한계", "", ...packet.limitations.map(l => `- ${l}`), ""].join("\n");
}
