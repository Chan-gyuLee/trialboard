import {canonical,digest,strictJson} from './field-review.ts';
import {consumeAgentStream,type LiveProgress} from './agent-live.ts';
import {readAgentRecord,type AgentRecord} from './agent-briefing.ts';
import type {AutoDocument} from './auto-document.ts';
import type {ResearchResult} from './research.ts';

export type AutoSaved={schema:'research-automation/1';runId:string;digest:string;status:'PREPARED'|'RUNNING'|'REVIEW_REQUIRED'|'NEEDS_EVIDENCE'|'FAILED'|'CANCELLED'|'INTERRUPTED'|'PLAN_DOCUMENT_SAVED';document:AutoDocument;report:AgentRecord|null;decision:{status:string;clinicalApproved:false;simulationExecuted:false;acceptedDrafts:number;findingCodes:string[];questions:string[];reason:string}|null;events:unknown[];textVerifiedAgainstPdf:false;route?:{policy:'posted-results-first/1';snapshotDigest:string;resultSourceIds:string[];reason:string}};
const fail=():never=>{throw Error('저장된 원문·추출 결과의 연결을 확인하지 못했습니다. 자동 재실행하지 않습니다.');};
export async function readAutoSaved(raw:string,result:ResearchResult):Promise<AutoSaved|null>{
 if(raw.length>6_000_000)fail();
 const value=strictJson(raw) as AutoSaved|null;if(value===null)return null;
 const c=result.collection,d=value.document,input=d?.input;
 if(value.schema!=='research-automation/1'||value.runId!==c.id||value.textVerifiedAgainstPdf!==false
  ||!['PREPARED','RUNNING','REVIEW_REQUIRED','NEEDS_EVIDENCE','FAILED','CANCELLED','INTERRUPTED','PLAN_DOCUMENT_SAVED'].includes(value.status)
  ||!d||d.status!=='READY'||!input||!d.source||!d.coverage||!Array.isArray(d.candidates)||!Array.isArray(value.events)
  ||await digest(canonical({input,coverage:d.coverage,sourceId:d.sourceId,sourceDigest:d.source.sha256}))!==value.digest||!c.sources.some(s=>s.id===d.sourceId)
  ||input.asset!==c.request.asset||input.indication!==c.request.indication||input.study!==c.request.nct_id
  ||d.source.schemaVersion!=='pdf-evidence-window/1'||d.coverage.clinicalReview!=='NOT_PERFORMED')fail();
 if(value.report){
  value.report=await readAgentRecord(JSON.stringify(value.report));
  if(value.report.execution_mode!=='DACON_RESPONSES'||canonical(value.report.input)!==canonical(input))fail();
 }
 const decision=value.decision;
 if(value.status==='PLAN_DOCUMENT_SAVED'){
  const route=value.route;
  if(value.report!==null||decision!==null||!route||route.policy!=='posted-results-first/1'||!/^[a-f0-9]{64}$/.test(route.snapshotDigest)||typeof route.reason!=='string'||route.reason.length>2000||!Array.isArray(route.resultSourceIds)||!route.resultSourceIds.length||route.resultSourceIds.length>2||new Set(route.resultSourceIds).size!==route.resultSourceIds.length||route.resultSourceIds.some(id=>!c.sources.some(s=>s.id===id&&s.kind==='REGISTRY'&&s.link_basis.includes('REGISTRY_RESULTS')&&s.raw_snapshots.includes(route.snapshotDigest))))fail();
 }
 if(decision&&(decision.clinicalApproved!==false||decision.simulationExecuted!==false
  ||!Array.isArray(decision.questions)||decision.questions.length>10||decision.questions.some(q=>typeof q!=='string'||q.length>2000)
  ||decision.acceptedDrafts!==value.report?.accepted.length||typeof decision.reason!=='string'||decision.reason.length>2000))fail();
 if(['REVIEW_REQUIRED','NEEDS_EVIDENCE'].includes(value.status)&&(!value.report||!decision||decision.status!==value.status))fail();
 return value;
}
export async function loadAutoSaved(result:ResearchResult,signal:AbortSignal,request:typeof fetch=fetch){
 const response=await request(`/api/research/runs/${result.collection.id}/automation`,{signal,cache:'no-store'});
 if(response.status===404)return null; // Legacy server: never invent restored preparation.
 if(!response.ok)throw Error('저장된 자동 추출 상태를 확인하지 못했습니다.');
 return readAutoSaved(await response.text(),result);
}
export async function extractAutomatically(result:ResearchResult,document:AutoDocument,consent:boolean,signal:AbortSignal,progress:(event:LiveProgress)=>void,request:typeof fetch=fetch):Promise<AutoSaved>{
 signal.throwIfAborted();if(consent!==true||document.status!=='READY'||!document.input||!document.coverage)throw Error('원문 준비와 모델 전송 동의가 필요합니다.');
 const path=`/api/research/runs/${result.collection.id}/automation`;
 const body=JSON.stringify({document,consent:true});if(new TextEncoder().encode(body).length>4_000_000)throw Error('원문 저장 크기 한도를 초과했습니다.');
 const prepared=await request(path,{method:'POST',headers:{'Content-Type':'application/json'},body,signal,credentials:'omit',redirect:'error'});
 if(!prepared.ok)throw Error('원문 준비를 저장하지 못해 AI 추출을 시작하지 않았습니다.');
 const saved=await readAutoSaved(await prepared.text(),result)??fail();
 if(saved.status!=='PREPARED')return saved; // No paid repeat on a duplicate request.
 signal.throwIfAborted();
 const response=await request(path+'/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({consent:true}),signal,credentials:'omit',redirect:'error'});
 const report=await consumeAgentStream(response,'pdf',progress,'DACON_RESPONSES');
 if(canonical(report.input)!==canonical(document.input))fail();
 const finished=await loadAutoSaved(result,signal,request)??fail();if(finished.report?.run_id!==report.run_id)fail();
 return finished;
}
