/** File-backed meeting drafts, not expert attestations, approvals or automatic persistence. */
import { canonical, strictJson, type FieldReview } from "./field-review.ts";
import type { PdfSource } from "./pdf-contract.ts";
import { arr, exact, fail, hash, id, num, obj, str } from "./design-brief.ts";
import { readDesignResult, type DesignResult } from "./design-result.ts";
import { restoreReview } from "./field-review-restore.ts";

export type NoteStatus = "OPEN" | "RECORDED" | "FOLLOW_UP";
export type NoteInput = { status: NoteStatus; answer: string; owner: string; nextAction: string; reason: string };
export type MeetingRevision = NoteInput & { questionId: string; revision: number; at: string };
export type MeetingNotes = { schemaVersion: "kol-meeting-notes/1"; reportKey: string; reviewerIdentity: "UNAUTHENTICATED_USER"; clinicalApproval: false; revisions: MeetingRevision[] };
export const PACKET_BYTES = 24 * 1024 * 1024;
export const newMeeting = (result: DesignResult): MeetingNotes => ({ schemaVersion: "kol-meeting-notes/1", reportKey: result.reportKey, reviewerIdentity: "UNAUTHENTICATED_USER", clinicalApproval: false, revisions: [] });
export const latestNote = (notes: MeetingNotes, questionId: string) => [...notes.revisions].reverse().find(r => r.questionId === questionId);
export const NOTE_STATUS = { OPEN: "미해결", RECORDED: "답변 메모 있음", FOLLOW_UP: "추가 확인 필요" } as const;
export const blankNote = (): NoteInput => ({ status: "OPEN", answer: "", owner: "", nextAction: "", reason: "" });
function noteInput(v: unknown): NoteInput {
  const r = obj(v);
  if (r.status !== "OPEN" && r.status !== "RECORDED" && r.status !== "FOLLOW_UP") fail();
  for (const [key, max] of [["answer", 2000], ["owner", 200], ["nextAction", 2000], ["reason", 2000]] as const) if (typeof r[key] !== "string" || r[key].length > max) fail();
  if (!String(r.reason).trim() || (r.status === "RECORDED" && !String(r.answer).trim())
    || (r.status === "FOLLOW_UP" && (!String(r.nextAction).trim() || !String(r.owner).trim()))) fail("답변 기록에는 답변, 추가 확인에는 담당자·다음 행동, 모든 기록에는 변경 사유가 필요합니다.");
  return { status: r.status, answer: r.answer as string, owner: r.owner as string, nextAction: r.nextAction as string, reason: r.reason as string };
}
export function validateMeeting(value: unknown, result: DesignResult): MeetingNotes {
  const r = obj(value); exact(r, ["schemaVersion", "reportKey", "reviewerIdentity", "clinicalApproval", "revisions"]);
  if (r.schemaVersion !== "kol-meeting-notes/1" || hash(r.reportKey) !== result.reportKey || r.reviewerIdentity !== "UNAUTHENTICATED_USER" || r.clinicalApproval !== false) fail("이 회의 메모는 다른 비교 실행 결과에 연결되어 있습니다.");
  const counts = new Map<string, number>(); let previous = "";
  const revisions = arr(r.revisions, 0, 200).map(v => {
    const n = obj(v); exact(n, ["questionId", "revision", "at", "status", "answer", "owner", "nextAction", "reason"]);
    const questionId = id(n.questionId), revision = num(n.revision, 1, 40, true), at = str(n.at, 30);
    if (!result.questions.some(q => q.id === questionId) || revision !== (counts.get(questionId) ?? 0) + 1
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at) || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at || at < previous) fail();
    previous = at; counts.set(questionId, revision);
    return { ...noteInput(n), questionId, revision, at };
  });
  return { schemaVersion: "kol-meeting-notes/1", reportKey: r.reportKey as string, reviewerIdentity: "UNAUTHENTICATED_USER", clinicalApproval: false, revisions };
}
export function recordNote(notes: MeetingNotes, result: DesignResult, questionId: string, input: NoteInput, at = new Date().toISOString()): MeetingNotes {
  validateMeeting(notes, result);
  const next = { ...notes, revisions: [...notes.revisions, { ...noteInput(input), questionId, revision: (latestNote(notes, questionId)?.revision ?? 0) + 1, at }] };
  return validateMeeting(next, result);
}
export function packetJson(result: DesignResult, notes: MeetingNotes): string {
  validateMeeting(notes, result);
  const raw = JSON.stringify({ schema_version: "trialboard-meeting-packet/1", clinical_approval: false, persisted: false,
    identity: "UNAUTHENTICATED_USER", report: result.raw, meeting: notes }, null, 2);
  if (new TextEncoder().encode(raw).length > PACKET_BYTES) fail("회의 자료가 24 MB 한도를 초과했습니다.");
  return raw;
}
export async function restorePacket(raw: string, review: FieldReview, source: PdfSource): Promise<{ result: DesignResult; notes: MeetingNotes }> {
  const r = obj(strictJson(raw, PACKET_BYTES, 1_000_000)); exact(r, ["schema_version", "clinical_approval", "persisted", "identity", "report", "meeting"]);
  if (r.schema_version !== "trialboard-meeting-packet/1" || r.clinical_approval !== false || r.persisted !== false || r.identity !== "UNAUTHENTICATED_USER") fail();
  const result = await readDesignResult(JSON.stringify(r.report), review, source), notes = validateMeeting(r.meeting, result);
  return { result, notes };
}
export type MeetingSession = { review: FieldReview; result: DesignResult; notes: MeetingNotes };
/** Explicit whole-session restore. Never adopt embedded review before all checks pass. */
export async function restoreMeetingSession(raw: string, source: PdfSource): Promise<MeetingSession> {
  const packet = obj(strictJson(raw, PACKET_BYTES, 1_000_000));
  const embedded = obj(obj(packet.report).revalidation).review;
  const review = restoreReview(JSON.stringify(embedded), source);
  const { result, notes } = await restorePacket(raw, review, source);
  return { review, result, notes };
}
// Escape Markdown syntax and HTML. User text is never executable markup or a URL.
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/([\\`*_{}\[\]()#+\-.!|])/g, "\\$1").replace(/\r?\n/g, " ");
const rate = (p: number) => `${(100 * p).toFixed(1)}%`;
export function packetMarkdown(result: DesignResult, notes: MeetingNotes): string {
  validateMeeting(notes, result);
  const b = result.brief;
  const lines = ["# TrialBoard · 설계 검토 회의 자료", "", "사용자 작성 초안 · 작성자 미인증 · 임상 승인/권장 설계안 없음", "",
    `질문: ${escape(b.question)}`, "", `계산 상태: ${result.status}`, `AI 재검토: ${result.ai ? `${result.ai.mode} · 완료 보고서 제공 · 진위 미인증` : "미제공 · AI가 승인한 결과 아님"}`,
    "", "## 설계 대안 — 고정 표본수·균등배정", "", "| 설계안 | 군당 인원 | 총 인원 | 입력 사유 |", "| --- | ---: | ---: | --- |",
    ...result.plans.map(p => `| ${escape(p.label)} | ${p.per_arm} | ${p.total_sample_size} | ${escape(p.rationale)} |`),
    "", "## 원문 연결 근거 — 확률 추정에 사용하지 않음", ""];
  const review = obj(obj(result.raw.revalidation).review);
  const scripted = obj(review.origin).mode === "SCRIPTED_TEST_DOUBLE";
  lines.splice(4, 0, `원문 파일: ${escape(str(review.sourceName))}`, scripted
    ? "스크립트 테스트 시연 · 실제 AI 성능/사람의 검토/전문가 검증 결과가 아닙니다. 자동 확인 이력을 임상 근거로 사용하지 마세요."
    : "최초 추출과 사용자 기록의 작성자/실행 진위를 인증하지 않습니다.", "");
  const rows = arr(review.rows, 0, 12).map(obj);
  for (const arm of b.arms) {
    lines.push(`### ${escape(arm.id)} · ${escape(arm.source_dose)}`, "");
    for (const oid of arm.observation_ids) {
      const row = rows.find(r => r.id === oid)!, fields = obj(row.fields);
      lines.push(`관측값: ${escape(oid)}`, "");
      for (const key of ["metric", "events", "denominator", "reported_rate", "cohort", "population", "window", "definition"]) {
        const field = obj(fields[key]), current = obj(field.current), citation = current.citation === null ? null : obj(current.citation);
        lines.push(`- ${key}: ${escape(String(current.value ?? "미보고"))} · ${escape(String(field.decision))}${citation ? ` · PDF p.${citation.page} / ${escape(String(citation.spanId))} · “${escape(String(citation.quote))}”` : " · 인용 없음"}`);
      }
      lines.push("");
    }
  }
  lines.push("## 사용자가 선언한 가정 — 실제 참값·추정치 아님", "");
  for (const s of b.scenarios) {
    lines.push(`### ${escape(s.label)}`, "", escape(s.rationale), "", "| 용량군 | 가정 반응확률 | 가정 이상반응확률 |", "| --- | ---: | ---: |",
      ...b.arms.map((a, i) => `| ${escape(a.source_dose)} | ${rate(s.response[i])} | ${rate(s.adverse_event[i])} |`), "",
      `효용 가중치: ${s.adverse_event_penalty} · 가정한 이상반응 한계: ${rate(s.maximum_adverse_event_rate)}`, "");
  }
  lines.push("## 가정별 계산 결과 — 검정력 아님", "", `난수 seed ${b.seed} · 반복 ${b.repetitions}회 · ±는 Monte Carlo SE (모수 불확실성 미포함)`, "",
    "| 가정 / 설계 | 가정 규칙상 올바른 선택·보류 | 가정상 한계 초과 군 선택 | 선택 보류 |", "| --- | ---: | ---: | ---: |");
  for (const s of result.simulations) lines.push(`| ${escape(b.scenarios.find(x => x.id === s.scenarioId)!.label)} / ${escape(b.plans.find(p => p.id === s.planId)!.label)} | ${rate(s.correct)} ± ${rate(s.se.true_utility_best)} | ${rate(s.unsafe)} ± ${rate(s.se.true_unsafe)} | ${rate(s.noSelection)} ± ${rate(s.se.no_selection)} |`);
  if (!result.simulations.length) lines.push("", "근거 연결 문제로 계산하지 않았습니다.");
  lines.push("", "모든 군이 가정상 한계를 초과할 때 ‘올바른 선택·보류’는 선택을 보류한 빈도입니다.", "", "## 표본수 차이와 결과 차이", "");
  for (const t of result.tradeoffs) lines.push(`- ${escape(t.scenario_id)} / ${escape(t.alternative_plan_id)} 대 ${escape(t.reference_plan_id)}: 참여자 ${t.additional_participants > 0 ? "+" : ""}${t.additional_participants}명, 올바른 선택·보류 ${(t.correct_selection_or_abstention_delta * 100).toFixed(1)}%p (MC SE ${(t.delta_monte_carlo_se.true_utility_best * 100).toFixed(1)}%p)`);
  lines.push("", "## KOL 질문과 사용자 회의 메모 — 전문가 답변 인증 아님", "");
  for (const q of result.questions) {
    const note = latestNote(notes, q.id);
    lines.push(`### ${escape(q.question)}`, "", `우선순위: ${q.priority} · ${note ? NOTE_STATUS[note.status] : "미답변"}`, `연결 맥락: ${escape(canonical(q.trigger))}`, "");
    if (note) lines.push(`답변 메모: ${escape(note.answer || "없음")}`, `담당자(사용자 기재): ${escape(note.owner || "미정")}`, `다음 행동: ${escape(note.nextAction || "미정")}`, `변경 사유: ${escape(note.reason)}`, "");
  }
  lines.push("## 회의 기록 수정 이력", "");
  for (const n of notes.revisions) lines.push(`- ${escape(n.questionId)} r${n.revision} · ${n.at} · ${NOTE_STATUS[n.status]} · ${escape(n.reason)} · 답변: ${escape(n.answer || "없음")} · 담당: ${escape(n.owner || "미정")} · 다음 행동: ${escape(n.nextAction || "미정")}`);
  lines.push("", "## 한계와 재현 정보", "", ...result.limitations.map(l => `- ${escape(l)}`),
    "- 회의 메모는 계산 차단을 해제하거나 설계 가정을 자동 수정하지 않습니다. 변경한 가정은 새로 계산해야 합니다.",
    "- hash와 JSON 구조는 내부 일관성만 확인합니다. 일관되게 조작된 기록의 진위는 인증하지 못합니다.",
    "", `PDF SHA-256: ${b.source_digest}`, `검토 SHA-256: ${b.review_content_digest}`, `설계 입력 SHA-256: ${result.briefDigest}`,
    `비교 실행 ID: ${escape(result.runId)}`, `회의 연결 SHA-256: ${result.reportKey}`, `계산 엔진 SHA-256: ${result.raw.engine_digest}`, "");
  return lines.join("\n");
}
