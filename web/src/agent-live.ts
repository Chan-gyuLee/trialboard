import { readAgentRecord, type AgentRecord } from "./agent-briefing.ts";
import { strictJson } from "./field-review.ts";

export type LiveCase = "public" | "synthetic" | "pdf";
export type LiveItem = {kind:"source"|"observation"|"finding"|"concern"|"question"|"decision";id:string;text:string;span_ids:string[]};
export type LiveProgress = { stage: string; attempt: number; state: "STARTED" | "COMPLETED"; elapsed_ms: number; observations?: number; findings?: number; concerns?: number; questions?: number; codes?: string[]; items?:LiveItem[] };
const failure = (message: string): never => { throw new Error(message); };
export const isLocalDemo = (location: Pick<Location, "hostname" | "port" | "protocol">) => location.protocol === "http:" && ["localhost", "127.0.0.1"].includes(location.hostname) && location.port === "5173";

/** Bounded POST stream; no reconnect/retry that could charge the account twice. */
export async function consumeAgentStream(response: Response, chosen: LiveCase, progress: (event: LiveProgress) => void, expectedMode?: string): Promise<AgentRecord> {
  if (!response.ok) failure(response.status === 429 ? "다른 에이전트 실행이 진행 중입니다. 완료 후 다시 시도하세요." : response.status === 404 ? "서버에서 실시간 데모가 활성화되지 않았습니다." : "실시간 데모 요청이 거부되었습니다.");
  if (!response.headers.get("content-type")?.startsWith("text/event-stream") || !response.body) failure("실시간 이벤트 응답이 아닙니다.");
  const reader = response.body!.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", bytes = 0, seq = 0, runId: string | null = null, started = false;
  let mode: string | null = null;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) failure("실행 결과를 받기 전에 연결이 끊겼습니다. 자동 재시도하지 않았습니다.");
      bytes += value!.byteLength;
      if (bytes > 2_000_000) failure("실시간 기록이 지원 크기를 초과했습니다.");
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (block.startsWith(":")) continue;
        if (!block.startsWith("data: ")) failure("지원하지 않는 이벤트 형식입니다.");
        const e = strictJson(block.slice(6)) as Record<string, unknown>;
        if (!e || typeof e !== "object" || e.sequence !== seq + 1 || typeof e.run_id !== "string" || (runId !== null && e.run_id !== runId) || !Number.isSafeInteger(e.elapsed_ms) || Number(e.elapsed_ms) < 0) failure("이벤트 순서 또는 실행 연결이 일치하지 않습니다.");
        seq++; runId = String(e.run_id);
        if (e.type === "error") failure("로컬 에이전트 실행이 실패했습니다. 저장 예제·개인 계정으로 대체하지 않았습니다. 선택한 API의 키/한도 또는 CLI 로그인 상태를 확인하세요.");
        if (e.type === "started") {
          if (started || seq !== 1 || e.case !== chosen || !["CODEX_CHATGPT", "DACON_RESPONSES"].includes(String(e.execution_mode)) || (expectedMode && e.execution_mode !== expectedMode)) failure("요청한 실제 모델 실행과 응답이 다릅니다.");
          mode = String(e.execution_mode); started = true; continue;
        }
        if (!started) failure("시작 기록이 없는 응답입니다.");
        if (e.type === "progress") {
          if (!["EXTRACT", "VERIFY", "CRITIQUE", "REVISE", "HANDOFF"].includes(String(e.stage)) || !["STARTED", "COMPLETED"].includes(String(e.state)) || !Number.isInteger(e.attempt) || Number(e.attempt) < 0 || Number(e.attempt) > 1) failure("지원하지 않는 작업 상태입니다.");
          for (const key of ["observations", "findings", "concerns", "questions"]) if (e[key] !== undefined && (!Number.isSafeInteger(e[key]) || Number(e[key]) < 0 || Number(e[key]) > 300)) failure("작업 집계가 올바르지 않습니다.");
          if (e.codes !== undefined && (!Array.isArray(e.codes) || e.codes.length > 300 || e.codes.some(c => typeof c !== "string" || c.length > 200))) failure("작업 쟁점이 올바르지 않습니다.");
          if(e.items !== undefined) {
            const items=Array.isArray(e.items)?e.items:failure("작업 산출물 수가 올바르지 않습니다.");
            if(items.length>24) failure("작업 산출물 수가 올바르지 않습니다.");
            for(const item of items) {
              if(!item || typeof item!=="object" || Object.keys(item).sort().join(',')!=="id,kind,span_ids,text"
                || !["source","observation","finding","concern","question","decision"].includes(item.kind)
                || typeof item.id!=="string" || !item.id || item.id.length>80 || typeof item.text!=="string" || item.text.length>1000
                || !Array.isArray(item.span_ids) || item.span_ids.length>12 || item.span_ids.some((s:unknown)=>typeof s!=="string" || !s || s.length>80)) failure("작업 산출물 형식이 올바르지 않습니다.");
            }
          }
          progress(e as unknown as LiveProgress); continue;
        }
        if (e.type === "result") {
          const report = await readAgentRecord(JSON.stringify(e.report));
          if (report.execution_mode !== mode || report.input.provenance !== (chosen === "public" ? "curated_public_excerpt" : chosen === "pdf" ? "user_pdf_export_unverified" : "synthetic_fixture")) failure("요청한 자료·모델과 결과가 다릅니다.");
          return report;
        }
        failure("알 수 없는 실시간 이벤트입니다.");
      }
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export async function runLiveAgent(chosen: LiveCase, signal: AbortSignal, progress: (e: LiveProgress) => void, location: Pick<Location, "hostname" | "port" | "protocol"> = window.location): Promise<AgentRecord> {
  if (!isLocalDemo(location)) failure("실시간 에이전트는 이 컴퓨터의 로컬 화면에서만 실행할 수 있습니다.");
  const probe = await fetch("/api/agent-demo/capabilities", {signal, cache:"no-store"});
  if (!probe.ok) failure("실행 설정 확인 실패 · 자료를 보내지 않았습니다.");
  const caps = await probe.json();
  if (!caps.enabled || caps.configured === false || !["CODEX_CHATGPT", "DACON_RESPONSES"].includes(caps.provider)) failure("실행 모델/키 설정을 확인하세요. 자료를 보내지 않았습니다.");
  const response = await fetch("/api/agent-demo/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ case: chosen, consent: true }), signal });
  return consumeAgentStream(response, chosen, progress, caps.provider);
}
