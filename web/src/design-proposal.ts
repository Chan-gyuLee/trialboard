import { canonical, digest, exportReview, strictJson, type FieldReview } from "./field-review.ts";
import { evidenceExport, type PdfSource } from "./pdf-contract.ts";
import { arr, bindBrief, fail, hash, id, num, obj, str, type DesignBrief } from "./design-brief.ts";
import { localDesignOrigin, responseText } from "./design-client.ts";

export const PROPOSAL_STAGES = {
  REVALIDATING_EVIDENCE: "검토한 근거·용량군·비교 조건을 다시 확인하고 있어요.",
  PROPOSING_HYPOTHESES: "AI가 표본수 대안과 민감도 가정을 제안하고 있어요. 모델 응답 대기 중입니다.",
  CHECKING_PROPOSAL: "제안의 근거 연결·표본수 제한·계산 가능 범위를 검사하고 있어요.",
} as const;
export type ProposalConstraints = { objective: string; max_per_arm: number };
export type DesignProposal = { status: "AWAITING_REVIEW" | "NEEDS_EVIDENCE" | "FAILED";
  runId: string; mode: string; summary: string; questions: string[]; brief: DesignBrief | null; raw: string };

export async function readProposal(raw: string, review: FieldReview, source: PdfSource,
  constraints: ProposalConstraints, expectedMode: string): Promise<DesignProposal> {
  const r = obj(strictJson(raw, 500000));
  if (r.schema_version !== "design-proposal/1" || r.clinical_approval !== false || r.user_approved !== false ||
      r.execution_mode !== expectedMode || !["AWAITING_REVIEW", "NEEDS_EVIDENCE", "FAILED"].includes(String(r.status)) ||
      canonical(r.constraints) !== canonical(constraints) || hash(r.source_digest) !== source.sha256 ||
      hash(r.review_content_digest) !== await digest(canonical(exportReview(review, source)))) fail("현재 검토·요청과 AI 제안이 일치하지 않습니다.");
  const runId = id(r.run_id), questions = arr(r.questions, 0, 8).map(q => str(q));
  const calls = arr(r.calls, 0, 1);
  const brief = r.brief === null ? null : await bindBrief(r.brief, review, source);
  if (r.status === "AWAITING_REVIEW") {
    if (!brief || calls.length !== 1 || brief.plans.length !== 2 || brief.plans.some(p => p.per_arm > constraints.max_per_arm) ||
        brief.scenarios.length < 2 || brief.scenarios.length > 3 || brief.scenarios.some(s => typeof s.provenance === "string" ||
        s.provenance.proposal_id !== runId || s.provenance.reviewed_input_digest !== null)) fail("확인 전 AI 초안 형식이 아닙니다.");
  } else if (brief) fail("보류·실패 결과에 설계가 포함되어 있습니다.");
  return {status: r.status as DesignProposal["status"], runId, mode: expectedMode,
    summary: typeof r.summary === "string" && r.summary.length <= 2000 ? r.summary : fail(), questions, brief, raw};
}

export async function consumeProposalStream(response: Response, onProgress: (stage: keyof typeof PROPOSAL_STAGES) => void): Promise<string> {
  if (!response.ok) throw Error(response.status === 429 ? "다른 AI 실행이 진행 중입니다. 잠시 후 다시 시도하세요." : "AI 설계 초안 요청이 거부됐습니다. 서버 설정과 입력 자료를 확인하세요.");
  if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) fail("작업 상태 스트림이 아닙니다.");
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", {fatal: true});
  let buffer = "", bytes = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) fail("완료 전 연결이 끊겼습니다. 자동 재시도하지 않았습니다.");
      bytes += value.byteLength; if (bytes > 600000) fail("AI 제안 응답 한도 초과");
      buffer += decoder.decode(value, {stream: true});
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (block.startsWith(":")) continue;
        if (!block.startsWith("data: ")) fail("지원하지 않는 작업 상태입니다.");
        const e = obj(strictJson(block.slice(6), 500000));
        if (e.type === "progress" && Object.hasOwn(PROPOSAL_STAGES, String(e.stage))) onProgress(e.stage as keyof typeof PROPOSAL_STAGES);
        else if (e.type === "result") return JSON.stringify(e.result);
        else fail("AI 제안을 완료하지 못했습니다. 자료·키·한도를 확인하세요. 자동 재시도하지 않았습니다.");
      }
    }
  } finally {await reader.cancel().catch(() => {}); reader.releaseLock();}
}

export async function requestDesignProposal(args: { origin: string; consent: boolean; review: FieldReview; source: PdfSource;
  pdf: Blob; agentRaw: string; constraints: ProposalConstraints; signal: AbortSignal;
  onProgress: (stage: keyof typeof PROPOSAL_STAGES) => void; fetcher?: typeof fetch }): Promise<DesignProposal> {
  if (!localDesignOrigin(args.origin) || args.consent !== true) fail("로컬 화면에서 외부 AI 전송에 동의해야 합니다.");
  const {review, source, constraints} = args;
  str(constraints.objective); num(constraints.max_per_arm, 3, 500, true);
  if (review.origin.kind !== "imported_agent_report" || await digest(args.agentRaw) !== review.origin.reportDigest || review.sourceDigest !== source.sha256) fail("현재 검토를 시작한 원본 추출 결과가 필요합니다.");
  const fetcher = args.fetcher ?? fetch;
  const options = {signal: args.signal, credentials: "omit", redirect: "error", cache: "no-store"} as const;
  const probe = await fetcher("/api/design-proposals/capabilities", options);
  if (!probe.ok) fail("AI 설계 서비스 설정을 확인하지 못했습니다.");
  const caps = obj(strictJson(await responseText(probe, 4000), 4000));
  if (caps.enabled !== true || caps.configured !== true || caps.max_calls !== 1 || caps.persisted !== false || caps.transport !== "LOOPBACK_ONLY" || caps.clinical_approval !== false || !["DACON_RESPONSES", "CODEX_CHATGPT"].includes(String(caps.provider))) fail("설계·PDF 에이전트 활성화와 모델 키 설정이 필요합니다. 자료를 전송하지 않았습니다.");
  if (args.pdf.size > 5*1024*1024 || args.pdf.size !== source.byteLength) fail("원본 PDF 크기가 다릅니다.");
  const bytes = new Uint8Array(await args.pdf.arrayBuffer());
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2,"0")).join("");
  if (sha !== source.sha256) fail("원본 PDF 버전이 다릅니다.");
  let binary = ""; for (let i=0; i<bytes.length; i+=16384) binary += String.fromCharCode(...bytes.subarray(i,i+16384));
  const exported = exportReview(review, source);
  const body = JSON.stringify({consent: true, constraints, review_json: JSON.stringify(exported),
    source_json: JSON.stringify(evidenceExport({...source, name: exported.sourceName}, [])),
    pdf_base64: btoa(binary), agent_json: args.agentRaw, context: null});
  if (new TextEncoder().encode(body).length > 24*1024*1024) fail("요청 크기 한도 초과");
  const response = await fetcher("/api/design-proposals", {...options, method:"POST", headers:{"Content-Type":"application/json"}, body});
  const raw = await consumeProposalStream(response, args.onProgress);
  return readProposal(raw, review, source, constraints, String(caps.provider));
}
