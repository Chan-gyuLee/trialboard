/** Editable backup, deliberately not a calculation brief or an execution result. */
import { canonical, digest, exportReview, strictJson, type FieldReview } from "./field-review.ts";
import type { PdfSource } from "./pdf-contract.ts";
import { arr, BRIEF_BYTES, draftFromBrief, exact, fail, hash, id, obj, readBrief, readProvenance, str, unique, type DesignDraft } from "./design-brief.ts";

const text = (value: unknown, max = 2000): string => typeof value === "string" && value.length <= max ? value : fail("초안의 입력 길이나 형식이 올바르지 않습니다.");
export function validateDraft(value: unknown): DesignDraft {
  const d = obj(value);
  exact(d, ["question", "arms", "plans", "scenarios", "seed", "repetitions"]);
  const arms = arr(d.arms, 0, 4).map(value => {
    const a = obj(value); exact(a, ["id", "source_dose", "observation_ids"]);
    return { id: id(a.id), source_dose: str(a.source_dose), observation_ids: arr(a.observation_ids, 0, 12).map(id) };
  });
  unique(arms.map(a => a.id)); unique(arms.map(a => a.source_dose)); unique(arms.flatMap(a => a.observation_ids));
  const plans = arr(d.plans, 2, 4).map(value => {
    const p = obj(value); exact(p, ["id", "label", "per_arm", "rationale"]);
    return { id: id(p.id), label: text(p.label), per_arm: text(p.per_arm, 20), rationale: text(p.rationale) };
  });
  unique(plans.map(p => p.id));
  const scenarios = arr(d.scenarios, 1, 6).map(value => {
    const s = obj(value); exact(s, ["id", "label", "response", "adverse_event", "adverse_event_penalty", "maximum_adverse_event_rate", "rationale", "provenance"]);
    return { id: id(s.id), label: text(s.label), rationale: text(s.rationale), provenance: readProvenance(s.provenance),
      response: arr(s.response, arms.length, arms.length).map(v => text(v, 20)),
      adverse_event: arr(s.adverse_event, arms.length, arms.length).map(v => text(v, 20)),
      adverse_event_penalty: text(s.adverse_event_penalty, 20), maximum_adverse_event_rate: text(s.maximum_adverse_event_rate, 20) };
  });
  unique(scenarios.map(s => s.id));
  return { question: text(d.question), arms, plans, scenarios, seed: text(d.seed, 20), repetitions: text(d.repetitions, 20) };
}
async function reviewDigest(review: FieldReview, source: PdfSource) {
  if (review.sourceDigest !== source.sha256) fail("현재 PDF와 필드 검토가 일치하지 않습니다.");
  return digest(canonical(exportReview(review, source)));
}
function checkLinks(d: DesignDraft, review: FieldReview) {
  for (const arm of d.arms) {
    if (!review.rows.some(r => r.fields.dose.current.value === arm.source_dose)) fail("초안의 원문 용량이 현재 검토에 없습니다.");
    for (const oid of arm.observation_ids) {
      if (!review.rows.some(r => r.id === oid && r.fields.dose.current.value === arm.source_dose)) fail("초안의 관측값 연결이 현재 검토와 다릅니다.");
    }
  }
}
export async function draftBackup(draft: DesignDraft, review: FieldReview, source: PdfSource): Promise<string> {
  const draftCopy = validateDraft(draft); checkLinks(draftCopy, review);
  const raw = JSON.stringify({ schema_version: "design-draft/1", status: "UNVALIDATED_DRAFT", source_digest: source.sha256,
    review_content_digest: await reviewDigest(review, source), draft: draftCopy }, null, 2);
  strictJson(raw, BRIEF_BYTES);
  return raw;
}
export async function restoreDesignInput(raw: string, review: FieldReview, source: PdfSource): Promise<{ draft: DesignDraft; incomplete: boolean }> {
  const r = obj(strictJson(raw, BRIEF_BYTES));
  if (r.schema_version === "design-brief/1") return { draft: draftFromBrief(await readBrief(raw, review, source)), incomplete: false };
  exact(r, ["schema_version", "status", "source_digest", "review_content_digest", "draft"]);
  if (r.schema_version !== "design-draft/1" || r.status !== "UNVALIDATED_DRAFT") fail("지원하지 않는 설계 초안입니다.");
  if (hash(r.source_digest) !== source.sha256 || hash(r.review_content_digest) !== await reviewDigest(review, source)) fail("현재 PDF·필드 검토 이력과 다른 초안입니다. 저장 당시의 검토 JSON을 먼저 복구하세요.");
  const draft = validateDraft(r.draft); checkLinks(draft, review);
  return { draft, incomplete: true };
}
