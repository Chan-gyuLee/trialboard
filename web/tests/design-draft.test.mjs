import test from "node:test";
import assert from "node:assert/strict";
import { addRow, newReview } from "../src/field-review.ts";
import { newDraft, briefFromDraft, readBrief } from "../src/design-brief.ts";
import { draftBackup, restoreDesignInput } from "../src/design-draft.ts";

// Synthetic editor state only; no clinical or model evaluation.
const source = { schemaVersion: "pdf-evidence/1", name: "synthetic.pdf", sha256: "a".repeat(64), byteLength: 100,
  extractor: "test", status: "NO_TEXT", coordinateSystem: "normalized_top_left_rotated_viewport",
  pages: [{ number: 1, width: 100, height: 100, rotation: 0, status: "NO_TEXT", spans: [] }] };
const review = newReview(source);
const read = raw => restoreDesignInput(raw, review, source);

test("empty editor can be saved and restored without becoming executable", async () => {
  const d = newDraft(), raw = await draftBackup(d, review, source), restored = await read(raw);
  assert.deepEqual(restored, { draft: d, incomplete: true });
  assert.equal(JSON.parse(raw).status, "UNVALIDATED_DRAFT");
  await assert.rejects(readBrief(raw, review, source));
  await assert.rejects(briefFromDraft(restored.draft, review, source));
});
test("partial text, whitespace and invalid numeric strings survive exactly, never coerce to zero", async () => {
  const d = newDraft(); d.question = "회의 전 확인\n작성 중"; d.plans[0].per_arm = "1e3";
  d.plans[1].per_arm = " "; d.scenarios[0].adverse_event_penalty = "-1";
  d.scenarios[0].maximum_adverse_event_rate = "0.";
  const before = structuredClone(d), restored = await read(await draftBackup(d, review, source));
  assert.deepEqual(restored.draft, before); assert.deepEqual(d, before);
  await assert.rejects(briefFromDraft(restored.draft, review, source));
  restored.draft.plans[0].label = "changed"; assert.deepEqual(d, before);
});
test("different PDF and changed review are rejected, original draft remains intact", async () => {
  const d = newDraft(), before = structuredClone(d), raw = await draftBackup(d, review, source);
  await assert.rejects(restoreDesignInput(raw, review, { ...source, sha256: "b".repeat(64) }));
  await assert.rejects(restoreDesignInput(raw, addRow(review, "new-row", "event_count"), source));
  await assert.rejects(draftBackup(d, review, { ...source, sha256: "b".repeat(64) }));
  assert.deepEqual(d, before);
});
const malformed = {
  schema: p => p.schema_version = "design-draft/99",
  approval: p => p.status = "APPROVED",
  extra: p => p.calculated = true,
  extraDraft: p => p.draft.result = {},
  wrongNumberType: p => p.draft.seed = 42,
  oversizedText: p => p.draft.question = "x".repeat(2001),
  oversizedNumeric: p => p.draft.seed = "1".repeat(21),
  missingPlan: p => p.draft.plans.pop(),
  duplicatePlan: p => p.draft.plans[1].id = p.draft.plans[0].id,
  noScenario: p => p.draft.scenarios = [],
  dimension: p => p.draft.scenarios[0].response.push("0.5"),
  observedProbability: p => p.draft.scenarios[0].provenance = "observed",
  unknownDose: p => {
    p.draft.arms.push({ id: "a", source_dose: "unknown", observation_ids: [] });
    p.draft.scenarios[0].response.push(""); p.draft.scenarios[0].adverse_event.push("");
  },
};
for (const [name, mutate] of Object.entries(malformed)) test(`reject malformed draft: ${name}`, async () => {
  const p = JSON.parse(await draftBackup(newDraft(), review, source)); mutate(p);
  await assert.rejects(read(JSON.stringify(p)));
});
test("reject oversized and duplicate-key JSON", async () => {
  await assert.rejects(read(" ".repeat(100001)));
  await assert.rejects(read('{"schema_version":"design-draft/1","schema_version":"design-brief/1"}'));
});
