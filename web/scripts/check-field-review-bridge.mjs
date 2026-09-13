// Cross-language integration using synthetic text and the scripted transport only.
// No actual PDF parsing, model calls, credentials or external services are involved.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decide, exportReview, importAgentReport } from "../src/field-review.ts";
import { isCurrent, readResult } from "../src/revalidation-result.ts";
import { restoreReview, reviewBackup } from "../src/field-review-restore.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = JSON.parse(execFileSync("uv", ["run", "python", "-c", `
import asyncio, hashlib, json
from trialboard.agent.example import demo_input, ScriptedProvider
from trialboard.agent.pdf_input import from_pdf_export
from trialboard.agent.engine import run_agent

demo = demo_input()
pdf_text = "%PDF-SYNTHETIC-CONTRACT-ONLY"
box = {"x": 0.1, "y": 0.2, "width": 0.5, "height": 0.1}
spans = [{"id": f"p1-i{i}", "item": i, "page": 1, "text": s.text, "box": box} for i, s in enumerate(demo.spans)]
source = {"schemaVersion": "pdf-evidence/1", "name": "SYNTHETIC-CONTRACT-NOT-A-PDF.pdf", "sha256": hashlib.sha256(pdf_text.encode()).hexdigest(),
    "byteLength": len(pdf_text), "extractor": "synthetic-test", "status": "TEXT_EXTRACTED", "coordinateSystem": "normalized_top_left_rotated_viewport",
    "pages": [{"number": 1, "width": 100, "height": 100, "rotation": 0, "status": "TEXT_EXTRACTED", "spans": spans}]}
notes = [{"spanId": s["id"], "sourceDigest": source["sha256"], "quote": s["text"], "page": 1, "box": box,
    "locationStatus": "USER_ATTESTED_VISUAL_MATCH", "meaningStatus": "NOT_ASSESSED"} for s in spans]
data = from_pdf_export({"schemaVersion": "pdf-evidence-review/1", "source": source, "notes": notes},
    asset=demo.asset, indication=demo.indication, study=demo.study, question=demo.question)
report = asyncio.run(run_agent(data, ScriptedProvider("persistent")))
print(json.dumps({"source": source, "report": report.model_dump(mode="json"), "pdf_text": pdf_text}, ensure_ascii=False))
`], { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 2_000_000 }));

const reportRaw = JSON.stringify(fixture.report);
const review = await importAgentReport(reportRaw, fixture.source);
assert.equal(review.rows.length, 4);
assert.equal(review.origin.mode, "SCRIPTED_TEST_DOUBLE");
assert.ok(review.rows.every(row => Object.values(row.fields).every(field => field.decision === "unreviewed")));
const row = review.rows[0];
assert.equal(row.fields.dose.current.citation.spanId, "p1-i0");
const checked = decide(review, fixture.source, row.id, "dose", "confirmed", row.fields.dose.current, "Synthetic contract check", 1, true);
assert.equal(exportReview(checked, fixture.source).downstreamStatus, "REQUIRES_REVALIDATION");
await assert.rejects(importAgentReport(JSON.stringify(fixture.report), { ...fixture.source, sha256: "0".repeat(64) }));
console.log("PASS: synthetic PDF-export → Python agent → browser import → source-linked user review. No model or PDF rendering tested.");

function rerun(value) {
  const payload = { review: exportReview(value, fixture.source), source: { schemaVersion: "pdf-evidence-review/1", source: fixture.source },
    report_raw: reportRaw, pdf_text: fixture.pdf_text };
  return JSON.parse(execFileSync("uv", ["run", "python", "-c", `
import json, sys
from trialboard.agent.revalidate import revalidate
p = json.load(sys.stdin)
result = revalidate(json.dumps(p["review"], ensure_ascii=False).encode(), json.dumps(p["source"], ensure_ascii=False).encode(),
    p["pdf_text"].encode(), agent_raw=p["report_raw"].encode())
print(json.dumps(result, ensure_ascii=False))
`], { input: JSON.stringify(payload), cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 2_000_000 }));
}
assert.equal(rerun(review).accepted.length, 0);
let fullyReviewed = review;
for (const observation of review.rows) {
  for (const [name, f] of Object.entries(observation.fields)) {
    if (f.current.value === null) continue;
    const corrected = observation.id === "obs-1" && name === "denominator";
    fullyReviewed = decide(fullyReviewed, fixture.source, observation.id, name, corrected ? "corrected" : "confirmed",
      corrected ? { ...f.current, value: "20" } : f.current, "Synthetic source check", 1, true);
  }
}
const validated = rerun(fullyReviewed);
assert.equal(validated.accepted.length, 4);
assert.equal(validated.model_calls, 0);
assert.equal(validated.clinical_approval, false);
assert.equal(validated.critique_status, "NOT_RERUN");
assert.ok(validated.finding_delta.no_longer_emitted.some(f => f.code === "VALUE_NOT_IN_QUOTE"));
assert.equal(validated.previous_model_review.extraction.observations[1].fields.denominator.value, "200");
const held = decide(fullyReviewed, fixture.source, "obs-0", "reported_rate", "held",
  { value: null, citation: null }, "Synthetic hold, including optional fields", null, false);
const heldResult = rerun(held);
assert.equal(heldResult.accepted.length, 3);
assert.deepEqual(heldResult.excluded_observation_ids, ["obs-0"]);
console.log("PASS: browser export → offline Python revalidation: unreviewed=0, corrected=4, held=3; previous AI draft preserved.");
const display = readResult(JSON.stringify(validated), fullyReviewed, fixture.source);
assert.equal(display.acceptedIds.length, 4);
assert.ok(isCurrent(display, fullyReviewed, fixture.source));
assert.equal(isCurrent(display, held, fixture.source), false);
assert.throws(() => readResult(JSON.stringify(validated), held, fixture.source));
const heldDisplay = readResult(JSON.stringify(heldResult), held, fixture.source);
assert.equal(heldDisplay.acceptedIds.length, 3);
assert.ok(heldDisplay.findings.some(f => f.code === "FIELD_HELD"));
console.log("PASS: Python result → current PDF review view; changed review rejects stale result.");
const backup = reviewBackup(held, fixture.source);
const renamedSource = { ...fixture.source, name: "RENAMED-SYNTHETIC.pdf" };
const restored = restoreReview(backup, renamedSource);
assert.deepEqual(exportReview(restored, renamedSource), exportReview(held, fixture.source));
assert.equal(readResult(JSON.stringify(heldResult), restored, renamedSource).acceptedIds.length, 3);
assert.equal(rerun(restored).accepted.length, 3);
const resumed = decide(restored, fixture.source, "obs-0", "dose", "confirmed",
  restored.rows[0].fields.dose.current, "Synthetic resumed check", 1, true);
assert.equal(resumed.rows[0].fields.dose.history.at(-1).revision, 2);
assert.equal(isCurrent(heldDisplay, resumed, fixture.source), false);
assert.equal(rerun(resumed).accepted.length, 3);
console.log("PASS: backup → restore → previous result match → continued history → Python revalidation; no reviewer authentication claimed.");
