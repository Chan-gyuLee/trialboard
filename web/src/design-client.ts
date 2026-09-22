/** Optional localhost-only bridge. Never contact a model provider or hosted API. */
import { digest, exportReview, strictJson, type FieldReview } from "./field-review.ts";
import { evidenceExport, type PdfSource } from "./pdf-contract.ts";
import { bindBrief, obj, type DesignBrief } from "./design-brief.ts";
import { readDesignResult, type DesignResult } from "./design-result.ts";
import { readRecritique } from "./recritique-result.ts";
const BODY_BYTES = 24 * 1024 * 1024;
const RESPONSE_BYTES = 16 * 1024 * 1024;
export const localDesignOrigin = (origin: string) => ["http://127.0.0.1:5173", "http://localhost:5173"].includes(origin);
export type DesignAttachments = { agentRaw: string | null; aiRaw: string | null; context: { asset: string; indication: string; study: string; question: string } | null };
export async function responseText(response: Response, max: number): Promise<string> {
  if (!response.body) throw new Error("로컬 서비스의 응답이 비어 있습니다.");
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, raw = "";
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > max) throw new Error("계산 응답 크기 한도를 초과했습니다."); raw += decoder.decode(value, { stream: true }); }
    return raw + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function executeLocalDesign(args: { origin: string; consent: boolean; brief: DesignBrief; review: FieldReview; source: PdfSource;
  pdf: Blob; attachments: DesignAttachments; signal: AbortSignal; fetcher?: typeof fetch }): Promise<DesignResult> {
  if (!localDesignOrigin(args.origin) || !args.consent) throw new Error("로컬 개발 화면에서 자료 전송에 동의한 경우에만 실행합니다.");
  const fetcher = args.fetcher ?? fetch;
  const brief = await bindBrief(args.brief, args.review, args.source);
  if (args.pdf.size > 5 * 1024 * 1024 || args.pdf.size !== args.source.byteLength) throw new Error("PDF 크기·버전이 현재 원문과 다릅니다.");
  const { agentRaw, aiRaw, context } = args.attachments;
  if (args.review.origin.kind === "imported_agent_report") {
    if (agentRaw === null || context !== null || await digest(agentRaw) !== args.review.origin.reportDigest) throw new Error("이 검토를 시작한 최초 에이전트 결과 파일을 연결하세요.");
    strictJson(agentRaw, 8 * 1024 * 1024, 500000);
  } else if (agentRaw !== null || context === null || [context.asset, context.indication, context.study, context.question].some(v => !v.trim()) || context.question !== brief.question) throw new Error("직접 추가한 검토는 약물·적응증·시험·질문 문맥이 필요합니다.");
  if (aiRaw !== null && (await readRecritique(aiRaw, args.review, args.source)).status !== "COMPLETED") throw new Error("현재 버전의 완료된 AI 재검토 결과만 연결할 수 있습니다.");
  const options = { credentials: "omit", cache: "no-store", redirect: "error", signal: args.signal } as const;
  const capabilities = await fetcher("/api/design-comparisons/capabilities", options);
  if (!capabilities.ok) throw new Error("로컬 계산 서비스에 연결하지 못했습니다. 실행 안내를 확인하세요.");
  const caps = obj(strictJson(await responseText(capabilities, 2000), 2000));
  if (caps.enabled !== true || caps.persisted !== false || caps.model_calls !== 0 || caps.transport !== "LOOPBACK_ONLY" || caps.clinical_approval !== false) throw new Error("로컬 서비스를 --enable-designs 옵션으로 시작하세요. 아직 자료를 전송하지 않았습니다.");
  const bytes = new Uint8Array(await args.pdf.arrayBuffer());
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  if (sha !== args.source.sha256) throw new Error("원본 PDF hash가 현재 검토와 다릅니다.");
  let binary = ""; for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  const review = exportReview(args.review, args.source);
  const body = JSON.stringify({ brief, review_json: JSON.stringify(review),
    source_json: JSON.stringify(evidenceExport({ ...args.source, name: review.sourceName }, [])), pdf_base64: btoa(binary), agent_json: agentRaw, ai_json: aiRaw, context });
  if (new TextEncoder().encode(body).length > BODY_BYTES) throw new Error("로컬 계산 요청이 24 MiB 한도를 초과했습니다.");
  const response = await fetcher("/api/design-comparisons", { ...options, method: "POST", headers: { "Content-Type": "application/json" }, body });
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(response.status === 422 ? "원문·검토·가정 또는 AI 결과가 일치하지 않습니다. 입력 파일을 확인하세요." : response.status === 429 ? "로컬 계산이 진행 중입니다. 잠시 후 직접 다시 실행하세요." : `로컬 계산 실패 (${response.status}). 자동 재시도하지 않았습니다.`); }
  return readDesignResult(await responseText(response, RESPONSE_BYTES), args.review, args.source, brief);
}
