import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { restoreReview } from "../src/field-review-restore.ts";
import { readDesignResult } from "../src/design-result.ts";
import { blankNote, latestNote, newMeeting, packetJson, packetMarkdown, recordNote, restorePacket, restoreMeetingSession, validateMeeting } from "../src/meeting-packet.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const f = JSON.parse(execFileSync("uv", ["run", "python", "-c", `
import json, sys
sys.path.insert(0,'tests')
from test_design_compare import run
from test_field_revalidation import sample
f = sample()
print(json.dumps({'source': f['source']['source'], 'report':run(f)}))
`], { cwd:root, encoding:"utf8", timeout:30000, maxBuffer:2_000_000 }));
const review = restoreReview(JSON.stringify(f.report.revalidation.review), f.source);
const result = await readDesignResult(JSON.stringify(f.report), review, f.source);
const legacyReport = structuredClone(f.report);
legacyReport.schema_version = "design-comparison/1";
for (const question of legacyReport.kol_questions) { delete question.urgency_score; delete question.urgency_reasons; }
const legacyResult = await readDesignResult(JSON.stringify(legacyReport), review, f.source);
const input = { status:"FOLLOW_UP", answer:"Not yet confirmed", owner:"Team member", nextAction:"Ask a statistician", reason:"Need independent review" };
const at = "2026-09-14T01:00:00.000Z";
test("one meeting packet restores review, design and note history using only the same PDF", async () => {
  const notes = recordNote(newMeeting(result), result, "statistics", input, at);
  const raw = packetJson(result, notes), sourceBefore = structuredClone(f.source);
  const session = await restoreMeetingSession(raw, f.source);
  assert.deepEqual(session.review, review);
  assert.deepEqual(session.notes, notes);
  assert.equal(session.result.reportKey, result.reportKey);
  assert.equal(session.result.reviewKey, result.reviewKey);
  assert.deepEqual(f.source, sourceBefore);
  const next = recordNote(session.notes, session.result, "statistics", { ...input, reason: "Continue restored meeting" }, "2026-09-14T02:00:00.000Z");
  assert.equal(next.revisions[1].revision, 2);
  assert.deepEqual((await restoreMeetingSession(packetJson(session.result, next), f.source)).notes, next);
});
test("whole-session restore rejects different PDF without returning a partial session", async () => {
  await assert.rejects(restoreMeetingSession(packetJson(result, newMeeting(result)), { ...f.source, sha256: "b".repeat(64) }));
});
const sessionMutations = {
  missingReview: p => delete p.report.revalidation.review,
  invalidHistory: p => p.report.revalidation.review.rows[0].fields.dose.history[0].revision = 99,
  wrongCitation: p => p.report.revalidation.review.rows[0].fields.dose.current.citation.quote = "NOT IN PDF",
  falseApproval: p => p.report.revalidation.review.clinicalApproval = true,
  wrongResultHash: p => p.report.brief_digest = "b".repeat(64),
  wrongMeetingHash: p => p.meeting.reportKey = "b".repeat(64),
  unknownSchema: p => p.schema_version = "trialboard-meeting-packet/99",
};
for (const [name, change] of Object.entries(sessionMutations)) test(`whole-session restore is all-or-nothing: ${name}`, async () => {
  const packet = JSON.parse(packetJson(result, newMeeting(result))); change(packet);
  const before = JSON.stringify(review);
  await assert.rejects(restoreMeetingSession(JSON.stringify(packet), f.source));
  assert.equal(JSON.stringify(review), before);
});
test("meeting notes are append-only snapshots and never change evidence or assumptions", () => {
  const notes = newMeeting(result), before = JSON.stringify(result);
  const next = recordNote(notes, result, "statistics", input, at);
  const last = recordNote(next, result, "statistics", { ...input, status:"RECORDED", answer:"User-transcribed reply", reason:"Added reply" }, "2026-09-14T01:01:00.000Z");
  assert.equal(notes.revisions.length, 0); assert.equal(next.revisions.length, 1); assert.equal(last.revisions.length, 2);
  assert.equal(latestNote(last, "statistics").revision, 2); assert.deepEqual(last.revisions[0], next.revisions[0]);
  assert.equal(JSON.stringify(result), before); assert.equal(last.clinicalApproval, false);
});
test("meeting JSON fully restores a version-bound comparison plus notes", async () => {
  const notes = recordNote(newMeeting(result), result, "statistics", input, at);
  const restored = await restorePacket(packetJson(result, notes), review, f.source);
  assert.deepEqual(restored.notes, notes); assert.equal(restored.result.reportKey, result.reportKey);
  const continued = recordNote(restored.notes, restored.result, "statistics", {...input, reason:"Next meeting"}, "2026-09-14T02:00:00.000Z");
  assert.equal(continued.revisions[1].revision, 2);
});
test("legacy /1 report and existing kol-meeting-notes/1 history restore with original hash binding", async () => {
  const notes = recordNote(newMeeting(legacyResult), legacyResult, "statistics", input, at);
  const before = structuredClone(legacyReport), restored = await restorePacket(packetJson(legacyResult, notes), review, f.source);
  assert.equal(restored.result.reportKey, legacyResult.reportKey);
  assert.deepEqual(restored.notes, notes);
  assert.ok(restored.result.questions.every(q => q.urgency_score === undefined));
  assert.deepEqual(legacyReport, before);
  assert.ok(packetMarkdown(restored.result, notes).includes("이전 /1 보고서에 기록 없음"));
});
test("meeting packet includes citations, all assumptions, MC errors and unanswered questions", () => {
  const md = packetMarkdown(result, newMeeting(result));
  const plain = md.replaceAll("\\", "");
  for (const text of ["PDF p.1", "원문 연결 근거", "가정한 이상반응 한계", "Monte Carlo", "미답변", "가정별 계산 결과", "수정 이력", result.briefDigest, result.reportKey]) assert.ok(md.includes(text), text);
  assert.ok(md.includes("AI 재검토: 미제공"));
  let previous = -1;
  for (const question of result.questions) {
    const index = plain.indexOf(question.question);
    assert.ok(index > previous, `question export order: ${question.id}`);
    previous = index;
    assert.ok(md.includes(`규칙 기반 우선순위 점수: ${question.urgency_score}`));
    for (const reason of question.urgency_reasons) assert.ok(plain.includes(reason), reason);
  }
});
test("user-entered HTML, Markdown links and tables cannot become executable packet markup", () => {
  const notes = recordNote(newMeeting(result), result, "statistics", { ...input, answer:'<script>alert(1)</script> [link](javascript:alert(1)) | new\n# header', reason:'<img src=x onerror=alert(1)>' }, at);
  const md = packetMarkdown(result, notes);
  assert.ok(!md.includes("<script>")); assert.ok(!md.includes("<img")); assert.ok(!md.includes("[link]("));
  assert.ok(md.includes("&lt;script&gt;")); assert.ok(md.includes("\\|"));
});
for (const [name, modify] of Object.entries({
  approval: n => n.clinicalApproval = true,
  authenticated: n => n.reviewerIdentity = "EXPERT",
  differentReport: n => n.reportKey = "0".repeat(64),
  gap: n => n.revisions[0].revision = 2,
  unknownQuestion: n => n.revisions[0].questionId = "not-a-question",
  invalidStatus: n => n.revisions[0].status = "APPROVED",
  blankReason: n => n.revisions[0].reason = " ",
  followupOwner: n => n.revisions[0].owner = "",
  followupAction: n => n.revisions[0].nextAction = "",
  emptyAnswer: n => { n.revisions[0].status = "RECORDED"; n.revisions[0].answer = ""; },
  invalidDate: n => n.revisions[0].at = "2026-02-30T01:00:00.000Z",
  localDate: n => n.revisions[0].at = "2026-09-14",
  unknownField: n => n.revisions[0].expertApproval = true,
  tooLong: n => n.revisions[0].answer = "x".repeat(2001),
})) test(`meeting restore rejects ${name}`, () => {
  const n = recordNote(newMeeting(result), result, "statistics", input, at); modify(n);
  assert.throws(() => validateMeeting(n, result));
});
test("history rejects clock regression and more than 40 revisions per question", () => {
  let notes = recordNote(newMeeting(result), result, "statistics", input, at);
  assert.throws(() => recordNote(notes, result, "statistics", input, "2026-09-13T00:00:00.000Z"));
  for (let i = 1; i < 40; i++) notes = recordNote(notes, result, "statistics", input, at);
  assert.throws(() => recordNote(notes, result, "statistics", input, at));
});
test("unrecorded editor draft is not a valid saved note", () => {
  assert.throws(() => recordNote(newMeeting(result), result, "statistics", blankNote(), at));
});
test("meeting packet approval and changed result are rejected", async () => {
  const raw = JSON.parse(packetJson(result, newMeeting(result))); raw.clinical_approval = true;
  await assert.rejects(restorePacket(JSON.stringify(raw), review, f.source));
  raw.clinical_approval = false; raw.report.run_id = "a-different-execution";
  await assert.rejects(restorePacket(JSON.stringify(raw), review, f.source));
});
test("meeting packet rejects unknown top-level fields", async () => {
  const raw = JSON.parse(packetJson(result, newMeeting(result))); raw.urgency_override = true;
  await assert.rejects(restorePacket(JSON.stringify(raw), review, f.source));
});
