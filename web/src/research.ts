import {strictJson} from "./field-review.ts";
import {linkageMarkdown} from "./research-linkage.ts";
export type ResearchContext={search_id:string;nct_id:string;asset:string;indication:string};
export type ResearchSource={id:string;kind:"REGISTRY"|"PAPER"|"PROTOCOL"|"SAP"|"REGULATORY";title:string;url:string;text:string;content_level:string;link_basis:string[];identifiers:Record<string,string>;published:string|null;fetched_at:string;digest:string;pdf_url:string|null;raw_snapshots:string[]};
export type ResearchPlan={followup_terms:string[];priorities:{source_id:string;reason:string}[];missing_evidence:string[]};
export type ResearchReview={findings:{source_id:string;quote:string;interpretation:string}[];questions:string[];conclusion:string};
export type ResearchCoverage={channel:string;query:string;status:string;total:number|null;fetched:number;limited:boolean;pages?:number|null;stop_reason?:string|null};
export type ResearchInventory={total:number;REGISTRY_TEXT:number;ABSTRACT:number;METADATA:number;PDF_AVAILABLE:number};
export type ResearchSourcePreview={id:string;title:string;kind:string;link_basis:string[];content_level?:string;url?:string};
export type ResearchEvent={run_id:string;sequence:number;stage:string;elapsed_ms:number;message:string;query?:string;channel?:string;coverage?:ResearchCoverage;inventory?:ResearchInventory;input_sources?:string[];anchor_count?:number;plan?:ResearchPlan;review?:ResearchReview;sources?:ResearchSourcePreview[]};
export type Collection={id:string;project_id:string;created_at:string;status:string;execution_mode:"COLLECTORS_ONLY"|"CODEX_CHATGPT"|"DACON_RESPONSES"|"SCRIPTED_TEST_DOUBLE";request:ResearchContext&{model_consent:boolean};sources:ResearchSource[];coverage:ResearchCoverage[];events:ResearchEvent[];plan:ResearchPlan|null;review:ResearchReview|null;calls:{stage:string;status:string;input_tokens?:number;output_tokens?:number}[];notices:string[]};
export type ResearchResult={collection:Collection;changes:{previous_id:string|null;added:string[];changed:string[];not_retrieved:string[]}};
export function researchFindingWarnings(finding:ResearchReview["findings"][number],source:ResearchSource,nct:string):string[]{
  const warnings:string[]=[];
  if(finding.interpretation.includes(nct)&&!source.text.toUpperCase().includes(nct.toUpperCase()))warnings.push(`AI 설명에 ${nct}가 나오지만 확보한 출처 문구에는 해당 NCT가 없습니다. 동일 시험·분석집단 연결은 원문에서 확인해야 합니다.`);
  if(source.content_level==="PDF_AVAILABLE"||source.content_level==="METADATA")warnings.push("AI가 읽은 것은 서지·문서 메타데이터입니다. 문서 본문을 읽은 검토가 아닙니다.");
  return warnings;
}
export const basisLabel=(basis:string)=>({REGISTRY_RECORD:"선택 시험 등록부",REGISTRY_DOCUMENT:"등록부에 첨부된 문서",REGISTRY_BIBLIOGRAPHY:"등록부 인용문헌",REGISTRY_REFERENCE_BACKGROUND:"등록부의 배경 인용",REGISTRY_REFERENCE_DERIVED:"등록부의 파생 인용",REGISTRY_REFERENCE_RESULT:"등록부의 결과 인용",NCT_SEARCH:"NCT 검색 일치",NCT_IN_ABSTRACT:"초록에 NCT 명시",DRUG_SEARCH:"약물명 검색 일치",AI_FOLLOWUP:"AI 추가 검색",DRUG_APPLICATION_NOT_TRIAL_PROOF:"약물 허가 문서 · 시험 일치 미확인"}[basis] ?? basis);
export function safeSourceUrl(url:unknown):url is string {
  if(typeof url!=="string")return false;
  try {const u=new URL(url);return u.protocol==="https:" && !u.username && !u.password && !u.port && !u.search && !u.hash && (
    u.hostname==="pubmed.ncbi.nlm.nih.gov" && /^\/\d+\/$/.test(u.pathname) ||
    u.hostname==="clinicaltrials.gov" && /^\/study\/NCT\d{8}$/.test(u.pathname) ||
    u.hostname==="cdn.clinicaltrials.gov" && /^\/large-docs\/\d{2}\/NCT\d{8}\/[A-Za-z0-9_-]+\.pdf$/.test(u.pathname) ||
    u.hostname==="www.accessdata.fda.gov" && /^\/drugsatfda_docs\/[A-Za-z0-9_/-]+\.pdf$/.test(u.pathname)
  );}catch{return false;}
}
export function readResearchResult(raw:string):ResearchResult {
  if(new TextEncoder().encode(raw).byteLength>6_000_000)throw Error("수집 기록이 너무 큽니다.");
  const data=strictJson(raw) as ResearchResult,c=data?.collection;
  if(!c || typeof c.id!=="string" || !/^[a-f\d-]{36}$/.test(c.id) || !["RUNNING","COMPLETE","PARTIAL","FAILED","CANCELLED"].includes(c.status) || !c.request || typeof c.request.asset!=="string" || !/^NCT\d{8}$/.test(c.request.nct_id) || !Array.isArray(c.sources) || c.sources.length>100 || !Array.isArray(c.coverage) || !Array.isArray(c.events) || !Array.isArray(c.notices) || !data.changes)throw Error("수집 기록 형식 오류");
  if(!["COLLECTORS_ONLY","CODEX_CHATGPT","DACON_RESPONSES","SCRIPTED_TEST_DOUBLE"].includes(c.execution_mode) || typeof c.request.model_consent!=="boolean" || typeof c.request.indication!=="string" || !validDate(c.created_at) || !strings(c.notices,100) || !Array.isArray(c.calls) || c.calls.length>2 || c.calls.some(x=>!x || typeof x.stage!=="string" || typeof x.status!=="string") || c.coverage.some(x=>!x || typeof x.channel!=="string" || typeof x.query!=="string" || !["OK","EMPTY","FAILED","SKIPPED"].includes(x.status) || !Number.isSafeInteger(x.fetched) || x.fetched<0 || x.total!==null && (!Number.isSafeInteger(x.total) || x.total<0) || typeof x.limited!=="boolean"))throw Error("조사 실행 정보 오류");
  if(!strings(data.changes.added,100) || !strings(data.changes.changed,100) || !strings(data.changes.not_retrieved,100) || data.changes.previous_id!==null && typeof data.changes.previous_id!=="string")throw Error("버전 비교 형식 오류");
  c.coverage.forEach(coverageDetails);
  const ids=new Set<string>();
  for(const s of c.sources){if(!s || typeof s.id!=="string" || ids.has(s.id) || !safeSourceUrl(s.url) || s.pdf_url!==null && !safeSourceUrl(s.pdf_url) || typeof s.title!=="string" || typeof s.text!=="string" || !/^[a-f\d]{64}$/.test(s.digest) || !Array.isArray(s.link_basis) || !s.link_basis.every(b=>typeof b==="string"))throw Error("근거 출처 형식 오류");ids.add(s.id);}
  for(const s of c.sources){if(!["REGISTRY","PAPER","PROTOCOL","SAP","REGULATORY"].includes(s.kind) || !["REGISTRY_TEXT","ABSTRACT","METADATA","PDF_AVAILABLE"].includes(s.content_level) || !validDate(s.fetched_at) || s.published!==null && typeof s.published!=="string" || !s.identifiers || typeof s.identifiers!=="object" || Array.isArray(s.identifiers) || !Object.values(s.identifiers).every(v=>typeof v==="string") || !strings(s.raw_snapshots,20) || s.raw_snapshots.some(h=>!/^[a-f\d]{64}$/.test(h)))throw Error("근거 메타데이터 오류");}
  if(c.plan){validatePlan(c.plan);if(c.plan.priorities.some(p=>!ids.has(p.source_id)))throw Error("검토 우선순위 출처 오류");}
  if(c.review)validateReview(c.review);
  if(c.review){if(!Array.isArray(c.review.findings) || !Array.isArray(c.review.questions) || !c.review.questions.every(q=>typeof q==="string"))throw Error("검토 초안 형식 오류");for(const f of c.review.findings){const s=c.sources.find(s=>s.id===f.source_id);if(!s || !f.quote || !s.text.includes(f.quote) || typeof f.interpretation!=="string")throw Error("검토 초안 인용문 불일치");}}
  return data;
}
const strings=(value:unknown,max:number):value is string[]=>Array.isArray(value)&&value.length<=max&&value.every(x=>typeof x==="string");
const validDate=(v:unknown)=>typeof v==="string"&&Number.isFinite(Date.parse(v));
function validatePlan(p:ResearchPlan){if(!p || !strings(p.followup_terms,2) || !strings(p.missing_evidence,6) || !Array.isArray(p.priorities) || p.priorities.length>6 || p.priorities.some(x=>!x || typeof x.source_id!=="string" || typeof x.reason!=="string"))throw Error("AI 계획 형식 오류");}
function validateReview(r:ResearchReview){if(!r || !["NEEDS_EXPERT_REVIEW","INSUFFICIENT_EVIDENCE"].includes(r.conclusion) || !strings(r.questions,8) || !Array.isArray(r.findings) || r.findings.length>8 || r.findings.some(f=>!f || typeof f.source_id!=="string" || typeof f.quote!=="string" || !f.quote || typeof f.interpretation!=="string"))throw Error("AI 검토 형식 오류");}
function validateEvent(e:ResearchEvent){if(e.sequence===1 && e.stage!=="STARTED")throw Error("시작 이벤트 누락");if(e.stage==="AI_PLAN_READY")validatePlan(e.plan!);if(e.stage==="REVIEW_READY")validateReview(e.review!);if(e.sources && (!Array.isArray(e.sources) || e.sources.length>6 || e.sources.some(s=>!s || typeof s.id!=="string" || typeof s.title!=="string")))throw Error("수집 이벤트 형식 오류");researchTelemetry(e);}
const coverageStops:Record<string,string>={RESULTS_EXHAUSTED:'응답 기준 검색 결과 끝',PAGE_LIMIT:'검색별 페이지 한도 도달',SOURCE_LIMIT:'전체 출처 100개 저장 한도 도달',CURSOR_UNAVAILABLE:'다음 페이지 정보 없음·반복으로 중단',NO_NEW_RECORDS:'중복 페이지만 수신하여 중단',REQUEST_FAILED:'요청 실패 · 수신한 자료는 보존'};
export const coverageStopLabel=(c:ResearchCoverage)=>c.stop_reason?coverageStops[c.stop_reason]??'종료 사유 미확인':'종료 사유 미기록';
function coverageDetails(c:ResearchCoverage):Pick<ResearchCoverage,'pages'|'stop_reason'>{
 if(c.pages!=null&&(!Number.isSafeInteger(c.pages)||c.pages<0||c.pages>2)||c.stop_reason!=null&&!Object.hasOwn(coverageStops,c.stop_reason))throw Error('수집 종료 정보 오류');
 return {...(c.pages!=null?{pages:c.pages}:{}),...(c.stop_reason!=null?{stop_reason:c.stop_reason}:{})};
}
/** Bounded, display-only provenance. Never includes source body, plan or model review. */
export function researchTelemetry(e:ResearchEvent):Partial<ResearchEvent>{
 const out:Partial<ResearchEvent>={},count=(v:unknown,max=1_000_000_000)=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=max;
 const text=(v:unknown,max:number)=>typeof v==='string'&&v.length>0&&v.length<=max;
 const fail=()=>{throw Error('수집 상세 이벤트 형식 오류');};
 if(e.query!==undefined){if(!text(e.query,2000))fail();out.query=e.query;}
 if(e.channel!==undefined){if(!text(e.channel,150))fail();out.channel=e.channel;}
 if(e.coverage!==undefined){const c=e.coverage;if(!c||!text(c.channel,150)||!text(c.query,2000)||!['OK','EMPTY','FAILED','SKIPPED'].includes(c.status)||!count(c.fetched)||c.total!==null&&!count(c.total)||typeof c.limited!=='boolean'||c.total!==null&&c.fetched>c.total)fail();out.coverage={channel:c.channel,query:c.query,status:c.status,total:c.total,fetched:c.fetched,limited:c.limited,...coverageDetails(c)};}
 if(e.inventory!==undefined){const c=e.inventory;if(!c||!count(c.total,100)||['REGISTRY_TEXT','ABSTRACT','METADATA','PDF_AVAILABLE'].some(k=>!count(c[k as keyof ResearchInventory],100))||c.REGISTRY_TEXT+c.ABSTRACT+c.METADATA+c.PDF_AVAILABLE!==c.total)fail();out.inventory={total:c.total,REGISTRY_TEXT:c.REGISTRY_TEXT,ABSTRACT:c.ABSTRACT,METADATA:c.METADATA,PDF_AVAILABLE:c.PDF_AVAILABLE};}
 if(e.input_sources!==undefined){if(!Array.isArray(e.input_sources)||e.input_sources.length>100||new Set(e.input_sources).size!==e.input_sources.length||e.input_sources.some(id=>!text(id,150)))fail();out.input_sources=[...e.input_sources];}
 if(e.anchor_count!==undefined){if(!count(e.anchor_count,2000))fail();out.anchor_count=e.anchor_count;}
 if(e.sources!==undefined){if(!Array.isArray(e.sources)||e.sources.length>6)fail();const sources:ResearchSourcePreview[]=[];for(const s of e.sources){if(!s||!text(s.id,150)||!text(s.title,2000))fail();if(s.url===undefined&&s.content_level===undefined)continue;if(!safeSourceUrl(s.url)||!['REGISTRY_TEXT','ABSTRACT','METADATA','PDF_AVAILABLE'].includes(s.content_level??'')||!['REGISTRY','PAPER','PROTOCOL','SAP','REGULATORY'].includes(s.kind)||!strings(s.link_basis,32)||s.link_basis.some(b=>b.length>150))fail();sources.push({id:s.id,title:s.title,kind:s.kind,link_basis:[...s.link_basis],url:s.url,content_level:s.content_level});}if(sources.length)out.sources=sources;}
 return out;
}
export async function readResearchStream(response:Response,onEvent:(e:ResearchEvent)=>void):Promise<string>{
  if(!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("text/event-stream"))throw Error(response.status===429?"다른 모델 실행이 진행 중입니다.":"조사 요청을 시작하지 못했습니다.");
  const reader=response.body.getReader(), decoder=new TextDecoder("utf-8",{fatal:true});let buffer="",bytes=0,seq=0,id="";
  try{while(true){const {value,done}=await reader.read();if(done)throw Error("최종 저장 전에 연결이 끝났습니다. 최근 조사 기록을 확인하세요.");bytes+=value!.byteLength;if(bytes>2_000_000)throw Error("작업 이벤트가 너무 큽니다.");buffer+=decoder.decode(value,{stream:true});let end:number;while((end=buffer.indexOf("\n\n"))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);if(block.startsWith(":"))continue;if(!block.startsWith("data: "))throw Error("이벤트 형식 오류");const e=strictJson(block.slice(6)) as ResearchEvent;if(!e || e.sequence!==++seq || seq>100 || typeof e.run_id!=="string" || !/^[a-f\d-]{36}$/.test(e.run_id) || id && e.run_id!==id || !Number.isSafeInteger(e.elapsed_ms) || e.elapsed_ms<0 || typeof e.message!=="string" || !["STARTED","PLAN","SEARCH","SOURCE","GAP","AI_PLAN","AI_PLAN_READY","CITATIONS_READY","AI_REVIEW","REVIEW_READY","COMPLETE","ERROR"].includes(e.stage))throw Error("작업 이벤트 순서 오류");validateEvent(e);id=e.run_id;onEvent(e);if(e.stage==="ERROR")throw Error("조사가 완료되지 않았습니다. 부분 수집 기록은 다시 열 수 있습니다.");if(e.stage==="COMPLETE")return id;}}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function researchMarkdown(c:Collection):string {
  return [
    `# ${c.request.asset} 근거 조사`,
    `시험: ${c.request.nct_id} / ${c.request.indication}`,
    `수집: ${c.created_at} / ${c.status} / ${c.execution_mode}`,
    "연구용 검토 초안. 임상적 승인·권장 용량·검증된 설계가 아닙니다. 사람의 근거 판단 이력은 별도 JSON입니다.",
    "## 수집 범위",
    ...c.coverage.map(x=>`- ${x.channel}: ${x.status}, ${x.fetched}/${x.total??"미확인"}건${x.limited?" (부분 수집)":""}${x.pages!=null?` · ${x.pages}페이지 · ${coverageStopLabel(x)}`:""}`),
    "## 인용 연결 검토",
    ...(c.review?.findings??[]).map(f=>{
      const source=c.sources.find(s=>s.id===f.source_id)!;
      const warnings=researchFindingWarnings(f,source,c.request.nct_id);
      return [`### ${f.source_id}`,...warnings.map(w=>`주의: ${w}`),f.interpretation,`> ${f.quote.replaceAll("\n","\n> ")}`,source.url].join("\n\n");
    }),
    "## KOL 검토 질문",...(c.review?.questions??[]).map(q=>`- ${q}`),
    "## 출처",...c.sources.map(s=>`- ${s.id}: ${s.title}\n  ${s.url}\n  ${s.content_level} / ${s.link_basis.join(", ")} / SHA256 ${s.digest}`),
    linkageMarkdown(c.sources,c.request.nct_id),
    "## 한계",...c.notices.map(n=>`- ${n}`),
    ...(c.execution_mode==="SCRIPTED_TEST_DOUBLE"?["MOC · 합성 테스트 모델 결과"]:[]),
  ].join("\n\n");
}
