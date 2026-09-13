import test from "node:test";
import assert from "node:assert/strict";
import { addRow, decide, exportReview, FIELD_NAMES, newReview } from "../src/field-review.ts";
import { findingLabel, findingTargets, isCurrent, readResult, RESULT_BYTES } from "../src/revalidation-result.ts";

// Synthetic envelope tests. Python's actual output is checked separately by the bridge script.
const source = { schemaVersion: "pdf-evidence/1", name: "synthetic.pdf", sha256: "a".repeat(64), byteLength: 100,
  extractor: "synthetic-test", status: "TEXT_EXTRACTED", coordinateSystem: "normalized_top_left_rotated_viewport",
  pages: [{ number: 1, width: 100, height: 100, rotation: 0, status: "TEXT_EXTRACTED",
    spans: [{ id: "p1-i0", item: 0, page: 1, text: "Dose 40 mg; denominator 20", box: { x: .1, y: .1, width: .5, height: .1 } }] }] };
const value = { value: "40 mg", citation: { spanId: "p1-i0", page: 1, quote: "Dose 40 mg" } };
function fixture() {
  const review = decide(addRow(newReview(source), "row-1", "event_count"), source, "row-1", "dose", "corrected", value, "Synthetic check", 1, true);
  const current = { code: "MISSING_FIELD", observation_id: "row-1", field: "denominator", detail: "" };
  const removed = { ...current, field: "dose" };
  const fields = Object.fromEntries(FIELD_NAMES.map(name => [name, name === "dose" ? { value: "40 mg", span_id: "p1-i0", quote: "Dose 40 mg" } : { value: null, span_id: null, quote: null }]));
  const report = { schema_version: "field-revalidation/1", run_id: "synthetic-run", rules_digest: "b".repeat(64),
    execution_mode: "LOCAL_DETERMINISTIC_REVALIDATION", model_calls: 0, clinical_approval: false,
    reviewer_identity: "UNAUTHENTICATED_USER", status: "NO_REVIEWABLE_OBSERVATIONS", comparison_status: "NOT_APPROVED",
    critique_status: "NOT_RERUN", source_integrity: "PDF_BYTES_HASH_MATCH_TEXT_AND_GEOMETRY_NOT_REEXTRACTED",
    source_digest: source.sha256, review_digest: "c".repeat(64), source_export_digest: "d".repeat(64), agent_report_digest: null,
    input: { asset: "DEMO", indication: "DEMO", study: "DEMO", question: "Synthetic question", provenance: "user_pdf_export_unverified",
      spans: [{ id: "p1-i0", source_digest: source.sha256, page: 1, text: source.pages[0].spans[0].text, locator: null }] },
    review: exportReview(review, source), effective_extraction: { observations: [{ id: "row-1", value_kind: "event_count", fields }] },
    excluded_observation_ids: [], accepted: [], findings: [current],
    baseline: { kind: "ORIGINAL_VALUES_SAME_DETERMINISTIC_RULES_NOT_PRIOR_AI_APPROVAL", accepted_ids: [], findings: [current, removed] },
    finding_delta: { added: [], no_longer_emitted: [removed], unchanged: [current] } };
  return { review, report };
}
const read = (r, review) => readResult(JSON.stringify(r), review, source);
test("same review and source can display a non-approved offline result", () => {
  const { review, report } = fixture(), result = read(report, review);
  assert.equal(result.question, "Synthetic question"); assert.equal(result.acceptedIds.length, 0);
  assert.equal(result.findings.length, 1); assert.equal(result.delta.no_longer_emitted[0].field, "dose");
  assert.ok(isCurrent(result, review, source));
});
test("key ordering and whitespace do not invalidate equivalent content", () => {
  const { review, report } = fixture(); report.review = Object.fromEntries(Object.entries(report.review).reverse());
  assert.ok(isCurrent(readResult(JSON.stringify(report, null, 4), review, source), review, source));
});
test("unsaved drafts and any recorded history change hide an old result", () => {
  const { review, report } = fixture(), result = read(report, review);
  assert.equal(isCurrent(result, review, source, true), false);
  const changed = decide(review, source, "row-1", "dose", "confirmed", value, "Second check", 1, true);
  assert.equal(isCurrent(result, changed, source), false); assert.throws(() => read(report, changed));
  assert.equal(isCurrent(result, review, { ...source, sha256: "0".repeat(64) }), false);
});
for (const [name, mutate] of [
  ["wrong schema", r => r.schema_version = "field-revalidation/2"],
  ["AI mode", r => r.execution_mode = "CODEX_CHATGPT"], ["model calls", r => r.model_calls = 1],
  ["approval", r => r.clinical_approval = true], ["numeric false", r => r.clinical_approval = 0],
  ["authenticated reviewer", r => r.reviewer_identity = "EXPERT"], ["comparison approved", r => r.comparison_status = "APPROVED"],
  ["new critique", r => r.critique_status = "RERUN"], ["fake parsed source", r => r.source_integrity = "VERIFIED"],
  ["source hash", r => r.source_digest = "0".repeat(64)], ["source text", r => r.input.spans[0].text = "changed"],
  ["source page", r => r.input.spans[0].page = 2], ["source provenance", r => r.input.provenance = "curated_public_excerpt"],
  ["duplicate source span", r => r.input.spans.push(r.input.spans[0])], ["missing spans", r => r.input.spans = []],
  ["rules hash", r => r.rules_digest = "invalid"], ["different report origin", r => r.agent_report_digest = "e".repeat(64)],
  ["altered review", r => r.review.rows[0].fields.dose.current.value = "80 mg"],
  ["unknown finding row", r => r.findings[0].observation_id = "missing"],
  ["unknown finding field", r => r.findings[0].field = "unknown"],
  ["duplicate finding", r => r.findings.push(r.findings[0])], ["extra finding property", r => r.findings[0].approved = true],
  ["invented addition", r => r.finding_delta.added.push(r.findings[0])], ["missing removal", r => r.finding_delta.no_longer_emitted = []],
  ["false exclusion", r => r.excluded_observation_ids = ["row-1"]], ["unknown baseline row", r => r.baseline.accepted_ids = ["missing"]],
  ["unreviewed count included", r => r.effective_extraction.observations[0].fields.events.value = "6"],
  ["altered effective dose", r => r.effective_extraction.observations[0].fields.dose.value = "80 mg"],
  ["accepted unknown row", r => r.accepted = [{ id: "other" }]], ["accepted changed value", r => {
    r.accepted = structuredClone(r.effective_extraction.observations); r.accepted[0].fields.dose.value = "80 mg";
  }],
  ["success without rows", r => r.status = "DRAFT_FOR_EXPERT_REVIEW"],
]) test(`reject inconsistent result: ${name}`, () => { const { review, report } = fixture(); mutate(report); assert.throws(() => read(report, review)); });
test("held rows cannot reappear as accepted observations", () => {
  const { review, report } = fixture();
  const held = decide(review, source, "row-1", "dose", "held", value, "Uncertain", null, false);
  report.review = exportReview(held, source); report.excluded_observation_ids = ["row-1"];
  report.accepted = structuredClone(report.effective_extraction.observations); report.effective_extraction.observations = [];
  assert.throws(() => read(report, held));
});
test("accepted IDs must be unique even when rows themselves match", () => {
  const { review, report } = fixture();
  report.accepted = [report.effective_extraction.observations[0], report.effective_extraction.observations[0]];
  assert.throws(() => read(report, review));
});
test("finding navigation distinguishes a specific field from global comparisons", () => {
  const { review, report } = fixture(), finding = report.findings[0];
  assert.deepEqual(findingTargets(finding, review), [{ rowId: "row-1", field: "denominator" }]);
  assert.deepEqual(findingTargets({ ...finding, observation_id: null, field: null }, review), [{ rowId: "row-1", field: null }]);
  assert.equal(findingLabel("FIELD_HELD"), "사용자가 보류한 필드");
  assert.equal(findingLabel("FUTURE_CODE"), "검사 항목: FUTURE_CODE");
});
test("duplicate/prototype keys, deep or oversized JSON cannot enter the result view", () => {
  const { review } = fixture();
  for (const raw of ['{"x":1,"x":2}', '{"__proto__":{}}', '[1,]', '['.repeat(40) + '0' + ']'.repeat(40), ' '.repeat(RESULT_BYTES + 1)]) {
    assert.throws(() => readResult(raw, review, source));
  }
});
