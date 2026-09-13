import test from "node:test";
import assert from "node:assert/strict";
import { addRow, decide, exportReview, newReview } from "../src/field-review.ts";
import { restoreReview, reviewBackup } from "../src/field-review-restore.ts";
import { reviewKey } from "../src/revalidation-result.ts";

// Synthetic source contracts only; not PDF rendering, real reviewers or clinical validation.
const box = { x: .1, y: .2, width: .5, height: .1 };
const source = { schemaVersion: "pdf-evidence/1", name: "synthetic.pdf", sha256: "a".repeat(64), byteLength: 100,
  extractor: "test", status: "TEXT_EXTRACTED", coordinateSystem: "normalized_top_left_rotated_viewport",
  pages: [1, 2].map(number => ({ number, width: 100, height: 100, rotation: 0, status: "TEXT_EXTRACTED",
    spans: [{ id: `p${number}-i0`, item: 0, page: number, text: "Dose 40 mg; 36 of 100 patients; rate 36%.", box }] })) };
const cell = (value = "40 mg", page = 1) => ({ value, citation: { spanId: `p${page}-i0`, page, quote: source.pages[page - 1].spans[0].text } });
const initial = () => addRow(newReview(source), "one", "event_count");
const save = (r, action, value = cell(), field = "dose") => decide(r, source, "one", field, action, value, "Synthetic check", 1, true, new Date("2026-09-13T00:00:00Z"));
const reviewed = () => save(save(save(initial(), "corrected"), "confirmed"), "held");
const packet = () => exportReview(reviewed(), source);
const restore = (p, src = source) => restoreReview(JSON.stringify(p), src);

test("full review backup round-trip preserves values, all decisions, history and exact result identity", () => {
  const before = reviewed(), raw = reviewBackup(before, source), after = restoreReview(raw, source);
  assert.deepEqual(exportReview(after, source), exportReview(before, source));
  assert.equal(reviewKey(after, source), reviewKey(before, source));
  assert.deepEqual(after.rows[0].fields.dose.history.map(h => h.decision), ["corrected", "confirmed", "held"]);
  assert.equal(after.rows[0].fields.events.decision, "unreviewed");
  assert.equal(exportReview(after, source).clinicalApproval, false);
  assert.equal(exportReview(after, source).persisted, false);
  assert.equal("exportMetadata" in exportReview(after, source), false);
});
test("empty and unreviewed records restore without manufacturing confirmations", () => {
  for (const r of [newReview(source), initial()]) assert.deepEqual(exportReview(restoreReview(reviewBackup(r, source), source), source), exportReview(r, source));
});
test("restored history continues sequentially without changing earlier records", () => {
  const p = packet(), r = restore(p), next = save(r, "confirmed");
  assert.equal(next.rows[0].fields.dose.history.at(-1).revision, 4);
  assert.deepEqual(next.rows[0].fields.dose.history.slice(0, 3), p.rows[0].fields.dose.history);
  assert.equal(r.rows[0].fields.dose.decision, "held");
  assert.notEqual(reviewKey(next, source), reviewKey(r, source));
});
test("legacy disclaimers and original filename retain exact export identity across PDF renames", () => {
  const p = packet(); p.limitations = ["Legacy backup disclaimer"]; p.sourceName = "old-name.pdf";
  const renamed = { ...source, name: "renamed.pdf" }, r = restore(p, renamed);
  assert.deepEqual(exportReview(r, renamed), p);
  assert.deepEqual(exportReview(save(r, "confirmed"), renamed).limitations, p.limitations);
});
test("imported and subsequently added manual rows restore as unauthenticated records", () => {
  const r = reviewed(); r.origin = { kind: "imported_agent_report", runId: "test-run", reportDigest: "b".repeat(64), mode: "SCRIPTED_TEST_DOUBLE" };
  r.rows[0].origin = "imported_agent_report"; r.modelFindings = ["Historical model issue"];
  const mixed = addRow(r, "manual-two", "reported_percentage");
  assert.deepEqual(exportReview(restoreReview(reviewBackup(mixed, source), source), source), exportReview(mixed, source));
});
test("unreviewed unsupported model values survive without promotion; empty held fields remain held", () => {
  const r = initial(); r.origin = { kind: "imported_agent_report", runId: "test-run", reportDigest: "b".repeat(64), mode: "CODEX_CHATGPT" };
  r.rows[0].origin = "imported_agent_report";
  r.rows[0].fields.dose.original = r.rows[0].fields.dose.current = { value: "Unsupported model value", citation: null };
  const held = save(r, "held", { value: null, citation: null }, "events");
  assert.deepEqual(exportReview(restoreReview(reviewBackup(held, source), source), source), exportReview(held, source));
});
test("same text on multiple pages keeps exact cited page", () => {
  const r = decide(initial(), source, "one", "dose", "corrected", cell("40 mg", 2), "Check page 2", 2, true);
  assert.equal(restoreReview(reviewBackup(r, source), source).rows[0].fields.dose.current.citation.page, 2);
});
const mutations = {
  schema: p => p.schemaVersion = "field-revalidation/1",
  otherPDF: p => p.sourceDigest = "c".repeat(64),
  invalidDigest: p => p.sourceDigest = "A".repeat(64),
  approved: p => p.clinicalApproval = true,
  approvalString: p => p.clinicalApproval = "false",
  authenticated: p => p.reviewerIdentity = "EXPERT",
  persisted: p => p.persisted = true,
  complete: p => p.downstreamStatus = "APPROVED",
  extraRoot: p => p.hidden = true,
  missingRoot: p => delete p.limitations,
  invalidOrigin: p => p.origin.kind = "verified",
  manualRun: p => p.origin.runId = "invented",
  incompleteAgent: p => p.origin.kind = "imported_agent_report",
  arrayMode: p => p.origin = { kind: "imported_agent_report", runId: "test", reportDigest: "b".repeat(64), mode: ["CODEX_CHATGPT"] },
  importedInManual: p => p.rows[0].origin = "imported_agent_report",
  manualFindings: p => p.modelFindings = ["Invented AI result"],
  duplicateRows: p => p.rows.push(structuredClone(p.rows[0])),
  rowId: p => p.rows[0].id = "../bad",
  tooManyRows: p => p.rows = Array.from({ length: 13 }, (_, i) => ({ ...p.rows[0], id: `r${i}` })),
  missingField: p => delete p.rows[0].fields.dose,
  extraField: p => p.rows[0].fields.fake = p.rows[0].fields.dose,
  invalidKind: p => p.rows[0].valueKind = "inferred",
  manualOriginal: p => p.rows[0].fields.events.original.value = "36",
  wrongState: p => p.rows[0].fields.dose.decision = "confirmed",
  wrongCurrent: p => p.rows[0].fields.dose.current.value = "100",
  noHistory: p => p.rows[0].fields.dose.history = [],
  numbering: p => p.rows[0].fields.dose.history[1].revision = 1,
  brokenChain: p => p.rows[0].fields.dose.history[1].before.value = "100",
  unreviewedRevision: p => p.rows[0].fields.dose.history[1].decision = "unreviewed",
  changedConfirmation: p => p.rows[0].fields.dose.history[1].after.value = "100",
  changedHold: p => p.rows[0].fields.dose.history[2].after.value = "100",
  noChangeCorrection: p => p.rows[0].fields.dose.history[1].decision = "corrected",
  blankReason: p => p.rows[0].fields.dose.history[0].reason = "  ",
  longReason: p => p.rows[0].fields.dose.history[0].reason = "a".repeat(2001),
  extraRevision: p => p.rows[0].fields.dose.history[0].attestedBy = "EXPERT",
  longHistory: p => p.rows[0].fields.dose.history = Array(41).fill(p.rows[0].fields.dose.history[0]),
  missingTimezone: p => p.rows[0].fields.dose.history[0].at = "2026-09-13T00:00:00",
  invalidCalendar: p => p.rows[0].fields.dose.history[0].at = "2026-02-30T00:00:00Z",
  invalidLeapDay: p => p.rows[0].fields.dose.history[0].at = "2026-02-29T00:00:00Z",
  midnight24: p => p.rows[0].fields.dose.history[0].at = "2026-09-13T24:00:00Z",
  timezone25: p => p.rows[0].fields.dose.history[0].at = "2026-09-13T00:00:00+25:00",
  wrongPage: p => p.rows[0].fields.dose.history[0].after.citation.page = 2,
  wrongSpan: p => p.rows[0].fields.dose.history[0].after.citation.spanId = "p1-i99",
  wrongQuote: p => p.rows[0].fields.dose.history[0].after.citation.quote = "Invented quote",
  citationExtraKey: p => p.rows[0].fields.dose.history[0].after.citation.trusted = true,
  nullWithCitation: p => p.rows[0].fields.dose.history[0].after.value = null,
  unsupportedConfirmedValue: p => p.rows[0].fields.dose.history[0].after.value = "invented",
  loneSurrogate: p => p.sourceName = "bad\ud800.pdf",
  longDisclaimers: p => p.limitations = Array(21).fill("x"),
};
for (const [name, mutate] of Object.entries(mutations)) test(`reject invalid backup: ${name}`, () => {
  const p = packet(); mutate(p); const before = JSON.stringify(p);
  assert.throws(() => restore(p)); assert.equal(JSON.stringify(p), before);
});
test("valid leap-day and timezone timestamps are preserved, not re-dated", () => {
  for (const at of ["2024-02-29T12:34:56.123456+09:00", "2026-09-13T12:34:56-05:30"]) {
    const p = packet(); p.rows[0].fields.dose.history[0].at = at;
    assert.equal(restore(p).rows[0].fields.dose.history[0].at, at);
  }
});
test("old confirmed citations need displayable geometry even if now held", () => {
  const src = structuredClone(source); src.pages[0].spans[0].box = null;
  assert.throws(() => restore(packet(), src));
  assert.doesNotThrow(() => restore(exportReview(initial(), source), src));
});
test("same digest alone does not bypass source text checks", () => {
  const src = structuredClone(source); src.pages[0].spans[0].text = "Changed text";
  assert.throws(() => restore(packet(), src));
});
test("numeric review rules also apply to restored historical confirmations", () => {
  for (const [name, kind, value] of [["events", "reported_percentage", "36"], ["denominator", "event_count", "36%"], ["events", "event_count", "3"]]) {
    const p = packet(), f = p.rows[0].fields.dose;
    p.rows[0].valueKind = kind;
    for (const v of [f.current, ...f.history.flatMap(h => [h.before, h.after])]) if (v.value !== null) v.value = value;
    p.rows[0].fields[name] = f; p.rows[0].fields.dose = exportReview(initial(), source).rows[0].fields.dose;
    assert.throws(() => restore(p));
  }
});
test("bounded parser rejects duplicates, prototypes, oversized and malformed data", () => {
  for (const raw of ['{"rows":[],"rows":[]}', '{"__proto__":{}}', '{"constructor":0}', 'NaN', '{', JSON.stringify("가".repeat(700000))]) assert.throws(() => restoreReview(raw, source));
});
test("download cannot offer a non-restorable oversized backup", () => {
  const r = initial(); r.exportMetadata = { sourceName: "a".repeat(2000001), limitations: [] };
  assert.throws(() => reviewBackup(r, source));
});
test("unchanged correction is rejected at creation as well as restoration", () => {
  assert.throws(() => save(save(initial(), "corrected"), "corrected"));
});
