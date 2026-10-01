import type {SourceMetadata} from './research-source-policy';
import {strictJson} from './field-review.ts';

export type SavedBinding={source_id:string;source_digest:string;policy_revision:number};
export type SavedStatus='RUNNING'|'COMPLETED'|'FAILED'|'CANCELLED';
export type AttemptSummary={attempt_id:string;run_id:string;status:SavedStatus;created_at:string;completed_at:string|null;model_calls:number};
export type SavedArtifact=AttemptSummary&{
 schema:'research-saved-review/1';mode:'SAVED_REVIEW_ONLY';asserted_by:string;
 context:{asset:string;indication:string;nct_id:string};source_bindings:SavedBinding[];
 sources:{source_id:string;source_digest:string;title:string}[];
 collector_calls:0;plan_calls:0;execution_mode:'COLLECTORS_ONLY'|'DACON_RESPONSES'|'SCRIPTED_TEST_DOUBLE';
 model:string|null;response_id:string|null;input_tokens:number|null;output_tokens:number|null;
 review:{findings:{source_id:string;quote:string;interpretation:string}[];questions:string[];conclusion:'NEEDS_EXPERT_REVIEW'|'INSUFFICIENT_EVIDENCE'}|null;
 citation_bindings:{anchor_id:string;source_id:string;source_digest:string;start:number;end:number;offset_unit:'UNICODE_CODE_POINTS'}[];
 error_code:string|null;notices:string[];
};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const statuses=['RUNNING','COMPLETED','FAILED','CANCELLED'];
const errors=['MODEL_POLICY_DENIED','MODEL_FAILED','MODEL_RESPONSE_REJECTED','CANCELLED','INTERRUPTED'];
function fail():never{throw Error('저장 자료 재검토 응답의 대상 또는 형식이 올바르지 않습니다.');}
function object(v:unknown,keys:string[]):Record<string,unknown>{
 if(!v||typeof v!=='object'||Array.isArray(v))return fail();
 const row=v as Record<string,unknown>;
 if(Object.keys(row).length!==keys.length||keys.some(k=>!Object.hasOwn(row,k)))return fail();
 return row;
}
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&Array.from(v).length<=max;
const integer=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):v is number=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max;
const date=(v:unknown):v is string=>typeof v==='string'&&/(Z|\+00:00)$/.test(v)&&Number.isFinite(Date.parse(v));
function summary(v:unknown,runId:string,attemptId?:string):AttemptSummary{
 const row=v as Record<string,unknown>;
 if(!uuid.test(runId)||row.run_id!==runId||typeof row.attempt_id!=='string'||!uuid.test(row.attempt_id)||attemptId!==undefined&&row.attempt_id!==attemptId||!statuses.includes(String(row.status))||!date(row.created_at)||!integer(row.model_calls,0,1))return fail();
 if(row.status==='RUNNING'?(row.completed_at!==null||row.model_calls!==0):!date(row.completed_at))return fail();
 return row as AttemptSummary;
}
const summaryKeys=['attempt_id','run_id','status','created_at','completed_at','model_calls'];
export function readSavedAttempts(v:unknown,runId:string):AttemptSummary[]{
 const row=object(v,['run_id','attempts']);
 if(row.run_id!==runId||!Array.isArray(row.attempts)||row.attempts.length>30)return fail();
 const seen=new Set<string>();
 return row.attempts.map(v=>{const item=summary(object(v,summaryKeys),runId);if(seen.has(item.attempt_id))return fail();seen.add(item.attempt_id);return item;});
}
export function savedBindings(sources:SourceMetadata[],selected:string[]):SavedBinding[]{
 if(selected.length<1||selected.length>8||new Set(selected).size!==selected.length)return fail();
 return selected.map(id=>{
  const s=sources.find(s=>s.source_id===id),p=s?.usage_policy;
  if(!s||!p||p.original_storage!=='ALLOW'||p.external_ai!=='ALLOW'||!integer(p.policy_revision,1,100))return fail();
  return {source_id:s.source_id,source_digest:s.source_digest,policy_revision:p.policy_revision};
 });
}
export function readSavedArtifact(v:unknown,runId:string,attemptId:string,expected?:SavedBinding[]):SavedArtifact{
 const row=object(v,[...summaryKeys,'schema','mode','asserted_by','context','source_bindings','sources','collector_calls','plan_calls','execution_mode','model','response_id','input_tokens','output_tokens','review','citation_bindings','error_code','notices']);
 summary(row,runId,attemptId);
 if(!uuid.test(attemptId)||row.schema!=='research-saved-review/1'||row.mode!=='SAVED_REVIEW_ONLY'||typeof row.asserted_by!=='string'||!uuid.test(row.asserted_by)||row.collector_calls!==0||row.plan_calls!==0||!['COLLECTORS_ONLY','DACON_RESPONSES','SCRIPTED_TEST_DOUBLE'].includes(String(row.execution_mode)))return fail();
 const context=object(row.context,['asset','indication','nct_id']);
 if(!text(context.asset,2000)||!text(context.indication,2000)||typeof context.nct_id!=='string'||!/^NCT\d{8}$/.test(context.nct_id))return fail();
 if(!Array.isArray(row.source_bindings)||row.source_bindings.length<1||row.source_bindings.length>8||!Array.isArray(row.sources)||row.sources.length!==row.source_bindings.length)return fail();
 const seen=new Map<string,string>();
 row.source_bindings.forEach((v,i)=>{
  const b=object(v,['source_id','source_digest','policy_revision']);
  if(!text(b.source_id,150)||typeof b.source_digest!=='string'||!digest.test(b.source_digest)||!integer(b.policy_revision,1,100)||seen.has(b.source_id))return fail();
  seen.set(b.source_id,b.source_digest);
  const s=object((row.sources as unknown[])[i],['source_id','source_digest','title']);
  if(s.source_id!==b.source_id||s.source_digest!==b.source_digest||!text(s.title,20000))return fail();
  if(expected&&(expected.length!==(row.source_bindings as unknown[]).length||!expected[i]||Object.keys(b).some(k=>b[k]!==expected[i][k as keyof SavedBinding])))return fail();
 });
 for(const k of ['model','response_id'])if(row[k]!==null&&!text(row[k],200))return fail();
 for(const k of ['input_tokens','output_tokens'])if(row[k]!==null&&!integer(row[k]))return fail();
 if(!Array.isArray(row.notices)||row.notices.length>10||row.notices.some(v=>!text(v,500))||!Array.isArray(row.citation_bindings)||row.citation_bindings.length>8)return fail();
 if(row.status==='COMPLETED'){
  if(row.model_calls!==1||row.error_code!==null||row.execution_mode==='COLLECTORS_ONLY')return fail();
  const review=object(row.review,['findings','questions','conclusion']);
  if(!['NEEDS_EXPERT_REVIEW','INSUFFICIENT_EVIDENCE'].includes(String(review.conclusion))||!Array.isArray(review.questions)||review.questions.length>8||review.questions.some(v=>!text(v,700))||!Array.isArray(review.findings)||review.findings.length>8||review.findings.length!==row.citation_bindings.length)return fail();
  review.findings.forEach((v,i)=>{
   const finding=object(v,['source_id','quote','interpretation']);
   if(typeof finding.source_id!=='string'||!seen.has(finding.source_id)||!text(finding.quote,600)||!text(finding.interpretation,700))return fail();
   const c=object((row.citation_bindings as unknown[])[i],['anchor_id','source_id','source_digest','start','end','offset_unit']);
   if(!text(c.anchor_id,200)||c.source_id!==finding.source_id||c.source_digest!==seen.get(finding.source_id)||!integer(c.start)||!integer(c.end,1)||c.end<=c.start||c.end-c.start!==Array.from(finding.quote).length||c.offset_unit!=='UNICODE_CODE_POINTS')return fail();
  });
 }else{
  if(row.review!==null||row.citation_bindings.length!==0)return fail();
  if(row.status==='RUNNING'){if(row.error_code!==null||row.response_id!==null||row.input_tokens!==null||row.output_tokens!==null)return fail();}
  else if(typeof row.error_code!=='string'||!errors.includes(row.error_code))return fail();
 }
 return row as SavedArtifact;
}

export async function readSavedStream(response:Response,runId:string,onStart:(id:string)=>void,eventSchema:'research-saved-review-event/1'|'research-pdf-review-event/1'='research-saved-review-event/1'):Promise<string>{
 if(!['research-saved-review-event/1','research-pdf-review-event/1'].includes(eventSchema))fail();
 if(!response.ok||!response.body||!response.headers.get('content-type')?.startsWith('text/event-stream'))throw Error('재검토를 시작하지 못했습니다. 이용조건과 로그인 상태를 확인하세요.');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',sequence=0,attempt='',bytes=0;
 try{while(true){
  const {value,done}=await reader.read();if(done)throw Error('연결이 끝났습니다. 자동 재시도하지 않았습니다. 실행 기록을 새로고침하세요.');
  bytes+=value.byteLength;if(bytes>100000)fail();buffer+=decoder.decode(value,{stream:true});let end:number;
  while((end=buffer.indexOf('\n\n'))>=0){
   const block=buffer.slice(0,end);buffer=buffer.slice(end+2);if(block.startsWith(':'))continue;if(!block.startsWith('data: '))fail();
   const e=object(strictJson(block.slice(6),100000),['schema','run_id','attempt_id','sequence','type','message']);
   if(e.schema!==eventSchema||e.run_id!==runId||typeof e.attempt_id!=='string'||!uuid.test(e.attempt_id)||e.sequence!==++sequence||sequence>2||!text(e.message,400)||attempt&&attempt!==e.attempt_id)fail();
   if(sequence===1){if(e.type!=='STARTED')fail();attempt=e.attempt_id;onStart(attempt);}
   else{if(!['COMPLETE','FAILED'].includes(String(e.type)))fail();return attempt;}
  }
 }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
