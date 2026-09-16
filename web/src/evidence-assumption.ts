/** Evidence informs an explicitly entered hypothetical value; never auto-estimates a probability. */
import { canonical, digest, exportReview, locate, type FieldName, type FieldReview } from "./field-review.ts";
import { draftNumber, type DesignDraft } from "./design-brief.ts";
import { validateDraft } from "./design-draft.ts";
import type { PdfSource } from "./pdf-contract.ts";

export type AssumptionChoice = { armId: string; observationId: string; metric: "response" | "adverse_event";
  value: string; reason: string; acknowledged: boolean };
const contextFields: FieldName[] = ["asset", "indication", "study", "cohort", "dose", "metric", "population", "window", "definition"];
export function assumptionEvidence(draft: DesignDraft, review: FieldReview, source: PdfSource, armId: string, observationId: string) {
  if (review.sourceDigest !== source.sha256) throw new Error("현재 PDF와 검토 버전이 다릅니다.");
  const arm = draft.arms.find(a => a.id === armId), row = review.rows.find(r => r.id === observationId);
  if (!arm || !row || !arm.observation_ids.includes(observationId) || row.fields.dose.current.value !== arm.source_dose) throw new Error("이 용량군에 연결한 관측값을 선택하세요.");
  if (Object.values(row.fields).some(f => f.decision === "held")) throw new Error("보류 항목이 있는 관측값입니다. 먼저 원문 필드를 검토하세요.");
  const required: FieldName[] = [...contextFields, ...(row.valueKind === "event_count" ? ["events", "denominator"] as FieldName[] : ["reported_rate"] as FieldName[])];
  for (const name of required) {
    const f = row.fields[name], v = f.current;
    if (!["confirmed", "corrected"].includes(f.decision) || !v.value?.trim() || !locate(source, v.citation)?.box || !v.citation!.quote.includes(v.value)) throw new Error("수치·정의·집단·기간을 원문에서 확인한 관측값만 연결할 수 있습니다.");
  }
  if (row.valueKind === "event_count") {
    const values = [row.fields.events.current.value!, row.fields.denominator.current.value!];
    if (values.some(v => !/^\d+$/.test(v) || !Number.isSafeInteger(Number(v))) || +values[1] <= 0 || +values[0] > +values[1]) throw new Error("사건 수와 분모를 다시 확인하세요.");
  }
  return {arm,row};
}

export async function recordEvidenceAssumption(draft: DesignDraft, review: FieldReview, source: PdfSource,
  scenarioId: string, choice: AssumptionChoice): Promise<DesignDraft> {
  // Snapshot before hashing, so changes during async work cannot produce mixed revisions.
  const d = validateDraft(draft), r = structuredClone(review), s = structuredClone(source), c = structuredClone(choice);
  const scenario = d.scenarios.find(v => v.id === scenarioId);
  if (!scenario || !["response", "adverse_event"].includes(c.metric)) throw new Error("변경할 가정을 선택하세요.");
  if (c.acknowledged !== true) throw new Error("원문 지표와 가정 지표의 대응 및 적용 한계를 확인하세요.");
  if (typeof c.reason !== "string" || c.reason.trim().length < 5 || c.reason.length > 700) throw new Error("적용 이유와 한계를 5–700자로 기록하세요.");
  const value = draftNumber(c.value);
  if (value > 1 || c.value.length > 20) throw new Error("가정 확률은 0–1로 입력하세요.");
  const {arm,row} = assumptionEvidence(d,r,s,c.armId,c.observationId), index = d.arms.findIndex(a => a.id === arm.id);
  const before = scenario[c.metric][index];
  if (before === c.value) throw new Error("현재 입력과 같습니다. 다른 가정값을 입력하세요.");
  const reviewDigest = await digest(canonical(exportReview(r,s)));
  const summary = row.valueKind === "event_count" ? `${row.fields.events.current.value}/${row.fields.denominator.current.value}` : `보고 비율 ${row.fields.reported_rate.current.value}`;
  const field = row.fields[row.valueKind === "event_count" ? "denominator" : "reported_rate"].current;
  const trace = ["[근거 참고 가정 변경 · 사용자 기재/미인증]",
    `PDF SHA-256 ${s.sha256}; 검토 SHA-256 ${reviewDigest}`,
    `관측 ${row.id}; 용량 ${arm.source_dose}; 원문 지표 ${row.fields.metric.current.value}; 관측값 ${summary}`,
    `집단 ${row.fields.population.current.value}; 기간 ${row.fields.window.current.value}; 정의 ${row.fields.definition.current.value}`,
    `인용 ${field.citation!.spanId} / p.${field.citation!.page}: ${field.citation!.quote}`,
    `가정 ${scenario.id} / ${c.metric}: ${before || "미입력"} → ${c.value}`,
    `사용자 이유·한계: ${c.reason.trim()}`,
    "원문 수치의 자동 추정·임상 참값·AI 추천·전문가 승인 아님. 다른 지표/집단/기간에 적용할 타당성은 별도 검토."].join("\n");
  const rationale = [scenario.rationale,trace].filter(Boolean).join("\n\n");
  if (rationale.length > 2000) throw new Error("가정 사유의 2,000자 한도를 넘습니다. 현재 입력을 저장한 뒤 별도 가정을 작성하세요.");
  scenario[c.metric][index] = c.value; scenario.rationale = rationale;
  return d;
}
