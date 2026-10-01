export type Study = { nct_id: string; title: string; url: string; conditions: string[]; phases: string[]; status: string; updated: string | null; sponsor: string | null; enrollment: {count: number; type: string} | null; interventions: {name: string; type: string}[]; arms: {label: string; description?: string|null}[]; primary_outcomes: {measure: string; timeFrame?: string}[]; results_available: boolean; documents: {label?: string; type?: string}[] };
export type Receipt = { id: string; query: string; created_at: string; digest: string; total_count: number; fetched_count: number; truncated: boolean; studies: Study[]; mode: "LIVE_PUBLIC"; clinical_verified: false };
export type ScoutContext = {asset: string; indication: string; study: string; question: string; receiptId: string; document?: {runId:string;sourceId:string;title:string}};
export type ScoutEvent = {stage: string; message?: string; receipt?: Receipt};
import {strictJson} from './field-review.ts';
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(s=>typeof s === "string");
const rows = (x: unknown, key: string) => Array.isArray(x) && x.every(s=>object(s) && typeof s[key] === "string");

export function readScoutReceipt(input: unknown): Receipt {
  const bad = () => {throw new Error("수집 기록 형식이 올바르지 않습니다. 이전 기록을 사용하세요.");};
  if (!object(input)) return bad();
  const r = input;
  if (typeof r.id !== "string" || !/^[a-f\d-]{36}$/.test(r.id) || typeof r.query !== "string" || !r.query.trim() ||
    typeof r.created_at !== "string" || !Number.isFinite(Date.parse(r.created_at)) ||
    typeof r.digest !== "string" || !/^[a-f\d]{64}$/.test(r.digest) || r.mode !== "LIVE_PUBLIC" || r.clinical_verified !== false ||
    !Number.isSafeInteger(r.total_count) || !Number.isSafeInteger(r.fetched_count) || typeof r.truncated !== "boolean" ||
    !Array.isArray(r.studies) || r.studies.length > 20 || r.fetched_count !== r.studies.length || (r.total_count as number) < r.studies.length ||
    ((r.total_count as number)>r.studies.length && !r.truncated)) return bad();
  const seen = new Set<string>(),exactNct=/^NCT\d{8}$/i.test(r.query)?r.query.toUpperCase():null;
  for (const s of r.studies) {
    if (!object(s) || typeof s.nct_id !== "string" || !/^NCT\d{8}$/.test(s.nct_id) || seen.has(s.nct_id) ||
      (exactNct!==null&&s.nct_id!==exactNct) || s.url !== `https://clinicaltrials.gov/study/${s.nct_id}` || typeof s.title !== "string" || !strings(s.conditions) || !strings(s.phases) ||
      typeof s.status !== "string" || !(s.updated === null || typeof s.updated === "string") || !(s.sponsor === null || typeof s.sponsor === "string") ||
      !(s.enrollment === null || object(s.enrollment) && Number.isSafeInteger(s.enrollment.count) && (s.enrollment.count as number)>=0 && typeof s.enrollment.type === "string") ||
      !rows(s.interventions,"name") || !rows(s.interventions,"type") || !rows(s.arms,"label") || !rows(s.primary_outcomes,"measure") ||
      !Array.isArray(s.documents) || typeof s.results_available !== "boolean") return bad();
    for (const o of s.primary_outcomes as Record<string,unknown>[]) if (o.timeFrame != null && typeof o.timeFrame !== "string") return bad();
    for (const a of s.arms as Record<string,unknown>[]) if (a.description != null && typeof a.description !== "string") return bad();
    seen.add(s.nct_id);
  }
  return r as unknown as Receipt;
}

/** Bounded NDJSON, strict event ordering, one verified receipt, no simulated progress. */
export async function readScoutStream(response: Response, query: string, onEvent: (event: ScoutEvent)=>void): Promise<Receipt> {
  if (!response.ok || !response.body) throw new Error(response.status===409 ? "다른 수집이 진행 중입니다. 잠시 후 다시 시도하세요." : "검색을 시작하지 못했습니다. 약물명 또는 NCT 번호와 서버 연결을 확인하세요.");
  const reader=response.body.getReader(), decoder=new TextDecoder("utf-8",{fatal:true});
  let buffer="", bytes=0, index=0, receipt:Receipt|null=null;
  const stages=["SEARCHING","COLLECTED","SAVING","COMPLETE"];
  try {
    while (true) {
      const {done,value}=await reader.read(); bytes += value?.byteLength ?? 0;
      if(bytes>5_000_000) throw new Error("수집 응답이 너무 큽니다.");
      buffer += decoder.decode(value,{stream:!done}); let newline:number;
      while ((newline=buffer.indexOf("\n"))>=0) {
        const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(!line.trim())continue;
        const event:unknown=strictJson(line,5_000_000);
        if(!object(event)) throw new Error("수집 이벤트 형식 오류");
        if(event.stage==="ERROR") throw new Error("공개 자료 수집·저장 실패. 기존 저장 기록은 유지됩니다.");
        if(event.stage!==stages[index++] || (event.message!==undefined && typeof event.message!=="string")) throw new Error("수집 이벤트 순서 오류");
        if(event.stage==="COMPLETE") {receipt=readScoutReceipt(event.receipt);if(receipt.query!==query)throw new Error("검색어와 수집 기록이 다릅니다.");}
        onEvent(event as ScoutEvent);
      }
      if(done)break;
    }
    if(!receipt || buffer.trim())throw new Error("저장 완료를 확인하지 못했습니다. 최근 수집 기록을 확인하세요.");
    return receipt;
  } finally {await reader.cancel().catch(()=>{}); reader.releaseLock();}
}
