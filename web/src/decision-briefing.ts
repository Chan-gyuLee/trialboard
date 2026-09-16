import { changedFields, readAgentRecord, type AgentRecord } from "./agent-briefing.ts";
import { strictJson } from "./field-review.ts";
import { bindStressResult, stressError, stressInput, stressMarkdown, type StressComparison, type StressDraft } from "./scenario-briefing.ts";
import { percent } from "./review.ts";

/** A view of the stored synthetic repair, never a new agent execution or a PDF attestation. */
export function repairEvidence(record: AgentRecord) {
  if (record.execution_mode !== "SCRIPTED_TEST_DOUBLE" || record.input.provenance !== "synthetic_fixture") throw new Error("이 시연은 명시된 합성 수정 기록만 사용합니다.");
  const changes = record.attempts.flatMap(a => changedFields(record, a.number)).filter(c => c.field === "denominator");
  if (changes.length !== 1) throw new Error("분모 수정 기록을 하나로 식별할 수 없습니다.");
  const change = changes[0], row = record.accepted.find(r => r.id === change.id);
  const first = record.attempts[0]?.extraction?.observations.find(r => r.id === change.id);
  const span = record.input.spans.find(s => s.id === change.after.span_id);
  if (!row || !first || !span || !change.after.quote || !span.text.includes(change.after.quote)
    || row.fields.denominator.value !== change.after.value || row.fields.events.value !== first.fields.events.value
    || !record.attempts[0].findings.some(f => f.observation_id === row.id && f.field === "denominator" && f.code === "VALUE_NOT_IN_QUOTE")) throw new Error("수정값과 검증·인용 기록이 연결되지 않습니다.");
  const values = [row.fields.events.value, change.before.value, change.after.value];
  if (values.some(v => v === null || !/^\d+$/.test(v))) throw new Error("사건 수·분모를 대조할 수 없습니다.");
  const [events, before, after] = values.map(Number);
  if (before <= 0 || after <= 0 || events > before || events > after || !change.after.quote.includes(String(after))) throw new Error("지원하지 않는 분모 수정입니다.");
  return { change, row, span, events, before, after, beforeRate: events / before, afterRate: events / after };
}
export function currentDecision(result: StressComparison | null, draft: StressDraft): boolean {
  if (!result || stressError(draft)) return false;
  const s = result.execution.input.scenarios[1];
  return s.adverse_event[0] === Number(draft.aeA) / 100 && s.adverse_event[1] === Number(draft.aeB) / 100;
}
export function decisionInsight(result: StressComparison) {
  const [small, large] = result.plans.map(p => p.after);
  const scenario = large.scenario;
  const unsafeCount = scenario.adverse_event.filter(p => p > scenario.maximum_adverse_event_rate).length;
  return {
    title: unsafeCount === 2 ? "증원만으로는 풀리지 않는 독성 가정입니다." : unsafeCount === 1 ? "위험 군 선택과 추가 참여자 부담을 함께 봐야 합니다." : "선택의 안정성이 추가 참여자 부담을 정당화할까요?",
    action: unsafeCount === 2 ? "용량 범위·선택 보류 기준을 우선 회의 의제로 검토" : "허용 한계·표본수 대안의 차이를 통계 전문가와 검토",
    detail: `총 ${small.total_sample_size}명 → ${large.total_sample_size}명. 변경 가정에서 선택 보류 ${percent(small.no_selection_probability)} → ${percent(large.no_selection_probability)}, 한계 초과 군 선택 ${percent(small.selects_true_unsafe_probability)} → ${percent(large.selects_true_unsafe_probability)}.`,
    added: large.total_sample_size - small.total_sample_size,
  };
}
export type DecisionNote = { owner: string; action: string };
export const DECISION_SESSION_BYTES = 2_000_000;
export type DecisionSession = { record: AgentRecord; history: StressComparison[]; draft: StressDraft; notes: Record<string, DecisionNote> };
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("작업 파일 구조가 올바르지 않습니다.");
  return v as Record<string, unknown>;
};
const exactKeys = (v: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v,k))) throw new Error("작업 파일에 알 수 없는 항목이 있습니다.");
};
function sessionParts(value: unknown) {
  const v = object(value); exactKeys(v,["schema","provenance","clinicalApproval","identity","record","executions","draft","notes"]);
  if (v.schema !== "decision-session/1" || v.provenance !== "SYNTHETIC_DEMO" || v.clinicalApproval !== false || v.identity !== "UNAUTHENTICATED_USER") throw new Error("이 작업 파일은 지원하는 합성 시연 형식이 아닙니다.");
  const draft = object(v.draft); exactKeys(draft,["aeA","aeB"]);
  if ([draft.aeA,draft.aeB].some(x => typeof x !== "string" || x.length > 12)) throw new Error("가정 입력이 지원 길이를 초과했습니다.");
  if (!Array.isArray(v.executions) || v.executions.length > 4) throw new Error("최대 4개 실행만 복구할 수 있습니다.");
  const history = v.executions.map(value => {
    const execution = value as StressComparison["execution"];
    const ae = execution?.input?.scenarios?.[1]?.adverse_event;
    if (!Array.isArray(ae) || ae.length !== 2 || ae.some(x => typeof x !== "number" || !Number.isFinite(x))) throw new Error("계산 조건이 없습니다.");
    return bindStressResult(execution, stressInput({aeA:String(ae[0]*100),aeB:String(ae[1]*100)}));
  });
  const ids = new Set(history.map(r => r.execution.execution_id));
  if (ids.size !== history.length) throw new Error("계산 실행 ID가 중복됩니다.");
  const notes = object(v.notes);
  for (const [id, raw] of Object.entries(notes)) {
    if (!ids.has(id)) throw new Error("회의 메모가 다른 계산에 연결되어 있습니다.");
    const note = object(raw); exactKeys(note,["owner","action"]);
    if (typeof note.owner !== "string" || note.owner.length > 200 || typeof note.action !== "string" || note.action.length > 2000) throw new Error("회의 메모가 지원 길이를 초과했습니다.");
  }
  return {record:v.record,history,draft:draft as StressDraft,notes:notes as Record<string,DecisionNote>};
}
export async function restoreDecisionSession(raw: string): Promise<DecisionSession> {
  const parts = sessionParts(strictJson(raw, DECISION_SESSION_BYTES));
  const record = await readAgentRecord(JSON.stringify(parts.record)); repairEvidence(record);
  return {...parts,record};
}
export function decisionSessionJson(session: DecisionSession) {
  repairEvidence(session.record);
  const payload = {schema:"decision-session/1",provenance:"SYNTHETIC_DEMO",clinicalApproval:false,identity:"UNAUTHENTICATED_USER",
    record:session.record,executions:session.history.map(r => r.execution),draft:session.draft,notes:session.notes};
  sessionParts(payload);
  const raw = JSON.stringify(payload,null,2);
  if (new TextEncoder().encode(raw).length > DECISION_SESSION_BYTES) throw new Error("작업 파일이 2 MB를 초과했습니다.");
  return raw;
}
export function decisionMarkdown(record: AgentRecord, result: StressComparison, draft: StressDraft, note: DecisionNote) {
  if (!currentDecision(result, draft)) throw new Error("가정이 바뀌었습니다. 새 계산 후 회의 자료를 저장하세요.");
  const bound = bindStressResult(result.execution, stressInput(draft));
  const evidence = repairEvidence(record), insight = decisionInsight(bound);
  const safe = (s: string) => s.replace(/[<>]/g, "").replace(/([\\`*_{}\[\]()#+.!|~-])/g, "\\$1").replace(/[\r\n]+/g, " ");
  return ["# TrialBoard · 의사결정 브리핑", "", "MOC · 합성 시연 · 임상 권고/전문가 승인 아님", "",
    "## 1. 근거 점검 · 저장된 스크립트 기록 / 새 AI 실행 없음",
    `- 분모 ${evidence.before} → ${evidence.after}. 단순 사건 비율 ${percent(evidence.beforeRate)} → ${percent(evidence.afterRate)}.`,
    `- 원문 인용: ${safe(evidence.change.after.quote!)}`,
    `- 기록 ${safe(record.run_id)} / ${safe(evidence.span.id)} / SHA-256 ${evidence.span.source_digest}`,
    "- 이 합성 발췌의 수치를 아래 계산의 확률로 전달하거나 추정하지 않았습니다. 두 단계는 별도 예제입니다.", "",
    "## 2. 계산에서 회의로 · 규칙 기반 해석 초안",
    insight.title, insight.detail, `검토할 의제: ${insight.action}`, "",
    "## 3. 이번 실행의 후속 행동 · 사용자 기재, 미인증",
    `담당자: ${safe(note.owner.trim()) || "미지정"}`, `다음 행동: ${safe(note.action.trim()) || "미기록"}`,
    "메모는 이 계산 실행에만 연결됩니다. 서버 자동 저장·팀 공유·전문가 답변 생성 없음.", "", stressMarkdown(bound)].join("\n");
}
