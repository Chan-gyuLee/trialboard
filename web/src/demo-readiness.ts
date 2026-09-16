import { readAgentRecord } from "./agent-briefing.ts";
import { isLocalDemo, type LiveCase } from "./agent-live.ts";

export type DemoCapability = { enabled: boolean; case_limits: Record<LiveCase, { max_calls: number; max_repairs: number }> };
export function readDemoCapability(value: unknown): DemoCapability {
  const v = value as Record<string, any>;
  if (!v || typeof v.enabled !== "boolean" || !["CODEX_CHATGPT", "DACON_RESPONSES"].includes(v.provider) || v.transport !== "LOOPBACK_ONLY" || v.persisted !== false || v.clinical_approval !== false || v.max_seconds !== 120 || v.concurrent_runs !== 1 || v.case_limits?.public?.max_calls !== 2 || v.case_limits?.public?.max_repairs !== 0 || v.case_limits?.synthetic?.max_calls !== 4 || v.case_limits?.synthetic?.max_repairs !== 1) throw new Error("서버의 시연 설정을 확인할 수 없습니다. 최신 로컬 서버인지 확인하세요.");
  return { enabled: v.enabled, case_limits: v.case_limits };
}
export type ReadinessCheck = { id: string; label: string; ok: boolean; detail: string };
export async function checkDemoReadiness(signal: AbortSignal, location: Pick<Location, "hostname" | "port" | "protocol"> = window.location): Promise<ReadinessCheck[]> {
  const specs = [
    { id: "server", label: "실제 실행 설정", path: "/api/agent-demo/capabilities", check: async (raw: string) => {
      if (!isLocalDemo(location)) throw new Error();
      const caps = readDemoCapability(JSON.parse(raw)); if (!caps.enabled || (JSON.parse(raw) as {configured?:boolean}).configured === false) throw new Error();
      return "공개 최대2요청 · 합성 최대4요청 · 자격 증명 유효성/모델 응답은 미검증";
    } },
    { id: "public", label: "공개 모델 저장 기록", path: "/data/agent/public-record.json", check: async (raw: string) => {
      const r = await readAgentRecord(raw);
      if (r.execution_mode !== "CODEX_CHATGPT" || r.input.provenance !== "curated_public_excerpt" || ["FAILED", "BUDGET_EXCEEDED"].includes(r.status)) throw new Error();
      return "구조·입력 연결 검사 통과 · 이전 실행이며 임상 정확도 검증 아님";
    } },
    { id: "repair", label: "합성 수정 테스트 기록", path: "/data/agent/synthetic-repair.json", check: async (raw: string) => {
      const r = await readAgentRecord(raw);
      if (r.execution_mode !== "SCRIPTED_TEST_DOUBLE" || r.input.provenance !== "synthetic_fixture") throw new Error();
      return "스크립트 테스트 기록 확인 · 실제 모델 성능 증거 아님";
    } },
  ];
  return Promise.all(specs.map(async spec => {
    try {
      if (spec.id === "server" && !isLocalDemo(location)) throw new Error();
      const response = await fetch(spec.path, { signal, cache: "no-store" });
      if (!response.ok) throw new Error();
      const raw = await response.text(); if (raw.length > 2_000_000) throw new Error();
      const detail = await spec.check(raw);
      return { id: spec.id, label: spec.label, ok: true, detail };
    } catch {
      return { id: spec.id, label: spec.label, ok: false, detail: spec.id === "server" ? "실행 설정 미확인 · 로컬 서버 활성화/버전 확인 필요" : "기록을 읽거나 검증하지 못함 · 이 파일로 시연하지 마세요" };
    }
  }));
}
export function interruptionMessage(reason: unknown) {
  return reason === "TIMEOUT" ? "135초 대기 한도에 도달했습니다. 완성된 결과를 받지 못했으며 자동 재시도하지 않았습니다." : "사용자가 실행 대기를 중단했습니다. 성공 결과로 표시하지 않습니다.";
}
export function elapsedSeconds(start: number, now: number): number { return Math.max(0, Math.floor((now - start) / 1000)); }
