import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { addRow, decide, digest, exportReview, FIELD_NAMES, importAgentReport, locate, newReview, reviewMarkdown, strictJson } from "../src/field-review.ts";

// Explicitly synthetic contract fixtures, not clinical validation or an AI run.
const box = { x: .1, y: .2, width: .5, height: .05 };
const source = { schemaVersion: "pdf-evidence/1", name: "synthetic.pdf", sha256: "a".repeat(64), byteLength: 100,
  extractor: "test", status: "TEXT_EXTRACTED", coordinateSystem: "normalized_top_left_rotated_viewport",
  pages: [1, 2].map(number => ({ number, width: 100, height: 100, rotation: 0, status: "TEXT_EXTRACTED",
    spans: [{ id: `p${number}-i0`, item: 0, page: number, text: "Dose 40 mg, 36 of 100 patients; rate 36%.", box }] })) };
const cite = (page = 1) => ({ spanId: `p${page}-i0`, page, quote: source.pages[page - 1].spans[0].text });
const cell = (value = "40 mg", page = 1) => ({ value, citation: cite(page) });
const initial = (kind = "event_count") => addRow(newReview(source), "row-1", kind);
const save = (review = initial(), changes = {}) => decide(review, source, "row-1", changes.field ?? "dose", changes.action ?? "corrected",
  changes.proposed ?? cell(), changes.reason ?? "원문 용량을 확인함", changes.readyPage === undefined ? 1 : changes.readyPage,
  changes.attested ?? true, new Date("2026-09-13T00:00:00Z"));
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value !== null && typeof value === "object"
  ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}` : JSON.stringify(value);
function report() {
  const input = { question: "어떤 용량인가?", asset: "TEST", indication: "TEST", study: "TEST", provenance: "user_pdf_export_unverified",
    spans: source.pages.map(p => ({ id: p.spans[0].id, page: p.number, source_digest: source.sha256, text: p.spans[0].text, locator: null })) };
  const fields = Object.fromEntries(FIELD_NAMES.map(k => [k, { value: null, span_id: null, quote: null }]));
  fields.dose = { value: "40 mg", span_id: "p2-i0", quote: cite(2).quote };
  return { engine_version: "bounded-evidence-agent/3.2", input, input_digest: "", run_id: "test-run", execution_mode: "SCRIPTED_TEST_DOUBLE",
    status: "DRAFT_FOR_EXPERT_REVIEW", accepted: ["untrusted"], attempts: [{ extraction: { observations: [{ id: "row-1", value_kind: "event_count", fields }] },
      findings: [{ code: "TEST_ONLY", observation_id: "row-1", field: "dose", detail: "합성 계약 검사" }] }] };
}
const encode = r => { r.input_digest = createHash("sha256").update(canonical(r.input)).digest("hex"); return JSON.stringify(r); };

test("bounded strict JSON accepts standard whitespace and nested JSON", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(strictJson(' \t\r\n{"a":[true,false,null,1.25,-2e3,"한글\\n"]}'))), { a: [true, false, null, 1.25, -2000, "한글\n"] });
});
for (const raw of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"__proto__":{}}', '{"constructor":0}', '{"x":{"prototype":0}}',
  '{"a":}', '[1,]', '{"a":1,}', '01', '1e999', 'NaN', 'true false', '"unterminated', '\u00a0{}', '['.repeat(32) + '0' + ']'.repeat(32)]) {
  test(`reject malformed/unsafe JSON ${raw.slice(0, 35)}`, () => assert.throws(() => strictJson(raw)));
}
test("UTF-8 byte limit and SHA-256", async () => {
  assert.throws(() => strictJson(JSON.stringify("가".repeat(700000))));
  assert.equal(await digest("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
test("manual rows are immutable, bounded, unique and explicit about missing fields", () => {
  const empty = newReview(source), first = addRow(empty, "one", "event_count");
  assert.equal(empty.rows.length, 0); assert.equal(Object.keys(first.rows[0].fields).length, 12);
  assert.equal(first.rows[0].origin, "manual");
  assert.equal(first.rows[0].fields.events.current.value, null);
  assert.throws(() => addRow(first, "one", "event_count")); assert.throws(() => addRow(first, "two", "guess"));
  let full = empty; for (let i = 0; i < 12; i++) full = addRow(full, `row${i}`, "event_count");
  assert.throws(() => addRow(full, "overflow", "event_count"));
});
test("duplicate source text preserves exact page/item identity", () => {
  assert.equal(locate(source, cite(2)).id, "p2-i0");
  assert.equal(locate(source, { ...cite(2), page: 1 }), null);
  assert.equal(locate(source, { ...cite(), quote: "" }), null);
});
for (const change of [{ attested: false }, { readyPage: null }, { readyPage: 2 }, { reason: " " }, { reason: "x".repeat(2001) },
  { proposed: { value: "40 mg", citation: null } }, { proposed: cell("invented") }, { action: "approved" }, { field: "invented" }, { action: "confirmed" }]) {
  test(`review rejects invalid confirmation ${JSON.stringify(change).slice(0, 80)}`, () => assert.throws(() => save(initial(), change)));
}
test("missing geometry cannot be manually confirmed", () => {
  const s = structuredClone(source); s.pages[0].spans[0].box = null;
  assert.throws(() => decide(initial(), s, "row-1", "dose", "corrected", cell(), "checked", 1, true));
});
test("correction, confirmation and hold preserve original and immutable audit history", () => {
  const original = initial(), corrected = save(original);
  assert.equal(original.rows[0].fields.dose.current.value, null);
  assert.equal(corrected.rows[0].fields.dose.original.value, null);
  const confirmed = save(corrected, { action: "confirmed" });
  const held = save(confirmed, { action: "held", proposed: cell("unsaved"), readyPage: null, attested: false });
  const field = held.rows[0].fields.dose;
  assert.equal(field.current.value, "40 mg"); assert.equal(field.decision, "held");
  assert.deepEqual(field.history.map(h => h.revision), [1, 2, 3]);
  assert.deepEqual(field.history.map(h => h.decision), ["corrected", "confirmed", "held"]);
  assert.equal(field.history[0].before.value, null); assert.equal(field.history[0].after.value, "40 mg");
});
test("history bound and PDF identity enforced", () => {
  let review = save(); for (let i = 1; i < 40; i++) review = save(review, { action: "confirmed" });
  assert.throws(() => save(review, { action: "confirmed" }));
  const wrong = { ...initial(), sourceDigest: "b".repeat(64) };
  assert.throws(() => save(wrong)); assert.throws(() => exportReview(wrong, source));
});
test("reported percentage does not permit a fabricated event count", () => {
  assert.throws(() => save(initial("reported_percentage"), { field: "events", proposed: cell("36") }));
  assert.equal(save(initial("reported_percentage"), { field: "reported_rate", proposed: cell("36%") }).rows[0].fields.events.current.value, null);
});
for (const quote of ["36%", "136", "36.2", "-36", "+36", "0.36", "36 %", "36,000", "36％"]) {
  test(`count is not a numeric substring of ${quote}`, () => {
    const s = structuredClone(source); s.pages[0].spans[0].text = quote;
    assert.throws(() => decide(initial(), s, "row-1", "events", "corrected", { value: "36", citation: { ...cite(), quote } }, "checked", 1, true));
  });
}
test("integer at punctuation boundary remains usable", () => {
  for (const quote of ["events 36.", "events 36, denominator 100"]) {
    const s = structuredClone(source); s.pages[0].spans[0].text = quote;
    const review = decide(initial(), s, "row-1", "events", "corrected", { value: "36", citation: { ...cite(), quote } }, "checked", 1, true);
    assert.equal(review.rows[0].fields.events.current.value, "36");
  }
});
test("review export is unapproved, revalidation-required, source-linked and escaped", () => {
  const review = save(initial(), { reason: '<script> [click](https://example.test)' });
  const packet = exportReview(review, source);
  assert.equal(packet.clinicalApproval, false); assert.equal(packet.downstreamStatus, "REQUIRES_REVALIDATION");
  assert.equal(packet.reviewerIdentity, "UNAUTHENTICATED_USER"); assert.equal(packet.persisted, false);
  packet.rows[0].fields.dose.current.value = "changed"; assert.equal(review.rows[0].fields.dose.current.value, "40 mg");
  const md = reviewMarkdown(review, source); assert.ok(!md.includes("<script>")); assert.ok(md.includes("\\[click\\]"));
  const bad = structuredClone(review); bad.rows[0].fields.dose.current.citation.quote = "invented";
  assert.throws(() => exportReview(bad, source));
});
test("import checks same PDF and starts all model fields unreviewed", async () => {
  const r = report(), raw = encode(r), review = await importAgentReport(raw, source);
  assert.equal(review.origin.mode, "SCRIPTED_TEST_DOUBLE"); assert.equal(review.origin.reportDigest, await digest(raw));
  assert.equal(review.rows[0].origin, "imported_agent_report");
  const mixed = addRow(review, "manual-extra", "event_count");
  assert.equal(mixed.rows[1].origin, "manual"); assert.equal(mixed.rows[0].origin, "imported_agent_report");
  assert.equal(review.rows[0].fields.dose.current.citation.page, 2);
  assert.ok(Object.values(review.rows[0].fields).every(f => f.decision === "unreviewed" && !f.history.length));
  assert.ok(review.modelFindings[0].includes("합성"));
  assert.throws(() => save(review, { action: "confirmed", proposed: cell("40 mg", 2), readyPage: 1 }));
  assert.equal(save(review, { action: "confirmed", proposed: cell("40 mg", 2), readyPage: 2 }).rows[0].fields.dose.decision, "confirmed");
});
for (const [label, mutate] of [
  ["different PDF", r => r.input.spans[0].source_digest = "b".repeat(64)],
  ["different text", r => r.input.spans[0].text = "altered"], ["wrong page", r => r.input.spans[0].page = 2],
  ["duplicate span", r => r.input.spans.push(r.input.spans[0])], ["different provenance", r => r.input.provenance = "curated_public_excerpt"],
  ["old engine", r => r.engine_version = "bounded-evidence-agent/3.1"], ["failed run", r => r.status = "FAILED"],
  ["unknown execution mode", r => r.execution_mode = "LIVE"], ["missing extraction", r => r.attempts[0].extraction = null],
  ["missing field", r => delete r.attempts[0].extraction.observations[0].fields.asset],
  ["missing row", r => r.attempts[0].extraction.observations = []],
  ["duplicate row", r => r.attempts[0].extraction.observations.push(r.attempts[0].extraction.observations[0])],
]) test(`reject imported ${label}`, async () => { const r = report(); mutate(r); await assert.rejects(importAgentReport(encode(r), source)); });
test("input digest cannot silently change", async () => {
  const r = report(); encode(r); r.input.question = "altered"; await assert.rejects(importAgentReport(JSON.stringify(r), source));
});
test("unsupported model citation stays explicitly unlinked, never confirmed", async () => {
  const r = report(); r.attempts[0].extraction.observations[0].fields.dose.span_id = "missing";
  const review = await importAgentReport(encode(r), source);
  assert.equal(review.rows[0].fields.dose.current.value, "40 mg");
  assert.equal(review.rows[0].fields.dose.current.citation, null);
  assert.equal(review.rows[0].fields.dose.decision, "unreviewed");
});
