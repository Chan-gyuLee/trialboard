/** One consent-bound workflow using the real collector/agent APIs. No synthetic fallback. */
import {isLocalDemo} from './agent-live.ts';
import {readScoutReceipt,readScoutStream,type Receipt,type Study} from './evidence-scout.ts';
import {readResearchResult,readResearchStream,type ResearchResult,type ResearchEvent} from './research.ts';
import {trialPriority,type TrialPriority} from './trial-priority.ts';
import {prepareAutoDocument,type AutoDocument} from './auto-document.ts';
import {extractAutomatically,loadAutoSaved,type AutoSaved} from './auto-extraction.ts';
import type {LiveProgress} from './agent-live.ts';
import {loadRegistryResults,type RegistryResults} from './registry-results.ts';
import {requestExploration,type Exploration} from './design-exploration.ts';

export const AUTO_PURPOSE='용량 비교를 위한 근거·KOL 브리핑';
export type Scope={asset:string;indication:string};
export type Candidate={study:Study;asset:string;indication:string;score:number;reason:string;priority?:TrialPriority};
export type AutoEvent={stage:'SEARCH'|'SCOPE'|'SELECTED'|'RESEARCH'|'DOCUMENT'|'EXTRACTION'|'ASSESSMENT'|'EXPLORATION'|'RESULT';message:string;research?:ResearchEvent;progress?:LiveProgress};
export type AutoResult={kind:'result';receipt:Receipt;candidate:Candidate;result:ResearchResult;document?:AutoDocument;automation?:AutoSaved|null;automationError?:string;registryResults?:RegistryResults|null;registryError?:string;exploration?:Exploration|null;explorationError?:string};
export type AutoOutcome=AutoResult|{kind:'scope';receipt:Receipt;candidates:Candidate[]};
const normalize=(s:string)=>s.trim().toLocaleLowerCase().replace(/\s+/g,' ');

/** Retrieval priority, not a clinical ranking or evidence inclusion decision. */
export function researchCandidates(receipt:Receipt):Candidate[]{
 const nct=/^NCT\d{8}$/i.test(receipt.query),query=normalize(receipt.query);
 const all=receipt.studies.flatMap(study=>{
  if(nct&&study.nct_id!==receipt.query.toUpperCase())return [];
  const drugs=[...new Set(study.interventions.filter(i=>i.type==='DRUG').map(i=>i.name.trim()).filter(Boolean))];
  const exact=drugs.find(d=>normalize(d)===query);
  // Never silently reinterpret a development code/alias, combination or a broad search hit.
  const assets=exact?[receipt.query.trim()]:drugs;
  return assets.filter(asset=>asset.length<=100&&/^[\p{L}\p{N}_ .()+-]+$/u.test(asset)).flatMap(asset=>{
   const priority=trialPriority(study,asset);
   return [...new Set(study.conditions)].filter(c=>c.trim().length>=2).map(indication=>({study,asset,indication,score:priority.score,reason:priority.reason,priority}));
  });
 }).sort((a,b)=>b.score-a.score||a.study.nct_id.localeCompare(b.study.nct_id));
 // If the submitted name is present, don't ask users to pick an unrelated co-medication.
 const exact=all.filter(c=>normalize(c.asset)===query);
 return !nct&&exact.length?exact:all;
}
export function chooseCandidate(receipt:Receipt,scope?:Scope):Candidate|undefined{
 const all=researchCandidates(receipt),nct=/^NCT\d{8}$/i.test(receipt.query);
 if(scope)return all.find(c=>c.asset===scope.asset&&c.indication===scope.indication);
 const matching=all.filter(c=>nct||normalize(c.asset)===normalize(receipt.query));
 const scopes=new Set(matching.map(c=>JSON.stringify([normalize(c.asset),c.indication])));
 // Multiple trial IDs may be searched from one provisional starting point; never merged.
 return scopes.size===1?matching[0]:undefined;
}
export type WorkState='done'|'running'|'waiting'|'partial'|'skipped';
export function autoWorkStates(events:AutoEvent[],outcome:AutoOutcome|null,busy:boolean):WorkState[]{
 const research=events.flatMap(e=>e.research?[e.research]:[]),c=outcome?.kind==='result'?outcome.result.collection:null;
 const plan=c?.plan??research.find(e=>e.stage==='AI_PLAN_READY')?.plan;
 const review=c?.review??research.find(e=>e.stage==='REVIEW_READY')?.review;
 const researching=research.length>0||events.some(e=>e.stage==='SELECTED');
 const searched=!!outcome||researching||events.some(e=>e.stage==='SCOPE');
 const planStarted=research.some(e=>e.stage==='AI_PLAN');
 const reviewStarted=research.some(e=>e.stage==='AI_REVIEW');
 const collectFinished=planStarted||!!c;
 const failedCollection=!!c?.coverage.some(x=>x.status==='FAILED');
 return [
  searched?'done':busy?'running':events.length?'partial':'waiting',
  collectFinished?(failedCollection?'partial':'done'):researching?(busy?'running':'partial'):'waiting',
  plan?(plan.followup_terms.length===0?'skipped':reviewStarted||c?(failedCollection?'partial':'done'):busy?'running':'partial'):planStarted?(busy?'running':'partial'):'waiting',
  review?'done':reviewStarted?(busy?'running':'partial'):'waiting',
 ];
}
type Options={query:string;consent:boolean;signal:AbortSignal;onEvent:(event:AutoEvent)=>void;receipt?:Receipt;scope?:Scope;fetcher?:typeof fetch;location?:Pick<Location,'hostname'|'port'|'protocol'>};
export async function runAutoReview(o:Options):Promise<AutoOutcome>{
 const request=o.fetcher??fetch,query=o.query.trim();
 if(!isLocalDemo(o.location??window.location))throw Error('자동 조사는 로컬 화면에서 실행하세요.');
 if(o.consent!==true||query.length<2||query.length>100)throw Error('공개 자료 조사·대회 API 사용 범위에 동의해 주세요.');
 const check=()=>o.signal.throwIfAborted();
 let explorationEnabled=false;
 async function readiness(){
  check();const response=await request('/api/agent-demo/capabilities',{signal:o.signal,cache:'no-store'});
  if(!response.ok)throw Error('실행 모델을 확인하지 못했습니다. 자료를 전송하지 않습니다.');
  const c=await response.json();
  explorationEnabled=c.exploration_enabled===true;
  if(c.enabled!==true||c.provider!=='DACON_RESPONSES'||c.configured!==true||!['gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna'].includes(c.model))throw Error('자동 조사에는 서버의 대회 API 설정이 필요합니다. 개인 Codex로 전환하지 않습니다.');
  if(c.automation_enabled!==true)throw Error('원문 자동 추출을 지원하는 최신 서버가 필요합니다. PDF 에이전트·공개 근거 조사를 활성화해 주세요.');
 }
 await readiness();
 let receipt:Receipt;
 if(o.receipt){receipt=readScoutReceipt(o.receipt);if(receipt.query!==query)throw Error('검색어가 변경됐습니다. 새 검토를 시작하세요.');}
 else{
  o.onEvent({stage:'SEARCH',message:'공개 임상시험을 검색하고 원본을 저장합니다.'});
  const response=await request('/api/evidence-scout/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,public_query_confirmed:true}),signal:o.signal});
  receipt=await readScoutStream(response,query,e=>o.onEvent({stage:'SEARCH',message:e.message??'검색 기록 저장 완료'}));
 }
 check();const candidates=researchCandidates(receipt),candidate=chooseCandidate(receipt,o.scope);
 if(!candidates.length)throw Error('조사할 약물·적응증을 확인하지 못했습니다. 정확한 약물명이나 NCT 번호로 다시 시작하거나 상세 검색을 이용하세요.');
 if(!candidate){
  if(o.scope)throw Error('선택한 약물·적응증이 현재 검색 기록과 일치하지 않습니다.');
  o.onEvent({stage:'SCOPE',message:'서로 다른 검토 범위가 있어 약물·적응증 선택이 필요합니다. 아직 모델을 호출하지 않았습니다.'});
  return {kind:'scope',receipt,candidates};
 }
 o.onEvent({stage:'SELECTED',message:`${candidate.study.nct_id}에서 조사를 시작합니다. ${candidate.reason}`});
 await readiness();check();
 const context={search_id:receipt.id,nct_id:candidate.study.nct_id,asset:candidate.asset,indication:candidate.indication};
 const response=await request('/api/research/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...context,public_consent:true,model_consent:true}),signal:o.signal});
 const id=await readResearchStream(response,research=>o.onEvent({stage:'RESEARCH',message:research.message,research}));
 check();
 const saved=await request(`/api/research/runs/${encodeURIComponent(id)}`,{signal:o.signal});
 if(!saved.ok)throw Error('저장 결과를 열지 못했습니다. 다시 실행하지 말고 최근 조사 기록을 확인하세요.');
 const result=readResearchResult(await saved.text()),c=result.collection;
 if(c.id!==id||c.execution_mode!=='DACON_RESPONSES'||c.request.model_consent!==true||Object.entries(context).some(([k,v])=>c.request[k as keyof typeof context]!==v))throw Error('실행 공급자·검토 범위가 결과와 다릅니다. 자동으로 채택하지 않았습니다.');
 if(!['COMPLETE','PARTIAL'].includes(c.status))throw Error('완료된 조사 결과가 아닙니다. 최근 기록에서 상태를 확인하세요.');
 check();const document=await prepareAutoDocument(result,o.consent,o.signal,message=>o.onEvent({stage:'DOCUMENT',message}),request);
 let automation:AutoSaved|null=null,automationError:string|undefined;
 if(document.status==='READY'){
  o.onEvent({stage:'EXTRACTION',message:'준비한 원문을 저장하고 등록 결과 우선 경로 또는 PDF 추출 경로를 확인합니다.'});
  try{automation=await extractAutomatically(result,document,o.consent,o.signal,progress=>o.onEvent({stage:'EXTRACTION',message:`${({EXTRACT:'임상 필드 추출',VERIFY:'인용·수치 대조',CRITIQUE:'비교 한계 검토',HANDOFF:'판단할 쟁점 정리'} as Record<string,string>)[progress.stage]??progress.stage} · ${progress.state==='STARTED'?'진행 중':'처리 결과 도착'}`,progress}),request);}
  catch{check();automationError='자동 추출이 완료되지 않았습니다. 원문과 조사 결과는 유지하며 모델을 자동 재호출하지 않습니다.';}
  if(automation?.status==='PLAN_DOCUMENT_SAVED')o.onEvent({stage:'EXTRACTION',message:'이미 검토한 등록 결과를 사용합니다. 계획 문서는 저장했고 PDF 결과 추출 추가 호출은 생략했습니다.'});
 }
 let registryResults:RegistryResults|null=null,registryError:string|undefined;
 o.onEvent({stage:'ASSESSMENT',message:'등록 결과의 집단·분모·시점을 대조하고 비교 준비 상태를 확인합니다.'});
 try{registryResults=await loadRegistryResults(result,o.signal,request);}catch{check();registryError='등록 결과표를 불러오지 못했습니다. 결과가 없다는 뜻은 아닙니다.';}
 if(registryResults?.readiness)o.onEvent({stage:'ASSESSMENT',message:`등록 결과 ${registryResults.outcomes.length+registryResults.safety.length}행 점검 · 효능 ${registryResults.readiness.responseCandidate?'검토 후보 있음':'추가 근거 필요'} · 안전성 ${registryResults.readiness.safetyCandidate?'검토 후보 있음':'추가 근거 필요'}. 설계 계산은 승인 전 미실행입니다.`});
 let exploration:Exploration|null=null,explorationError:string|undefined;
 if(explorationEnabled&&c.review){
  check();o.onEvent({stage:'EXPLORATION',message:'실제 근거와 분리한 MOC 설계 탐색: 표본수 3안·가정 3종을 로컬 계산하고 저장합니다.'});
  try{exploration=await requestExploration(result,o.signal,request,true);o.onEvent({stage:'EXPLORATION',message:'가상 설계 9개 조합의 계산·저장을 확인했습니다. 실제 용량 선택이나 임상 승인은 아닙니다.'});}
  catch{check();explorationError='가상 설계 계산·저장을 확인하지 못했습니다. 실제 근거 검토는 유지하며 자동 재시도하지 않습니다.';}
 }
 check();o.onEvent({stage:'RESULT',message:c.review?'인용을 연결한 브리핑과 질문을 저장했습니다.':'수집 자료를 저장했습니다. AI 브리핑은 미완료입니다.'});
 return {kind:'result',receipt,candidate,result,document,automation,automationError,registryResults,registryError,exploration,explorationError};
}

/** Replay reads only persisted records. Opening never restarts a model or external search. */
export async function openAutoRecord(id:string,signal:AbortSignal,request:typeof fetch=fetch):Promise<AutoResult>{
 if(!/^[a-f\d-]{36}$/.test(id))throw Error('조사 기록 ID 오류');
 const saved=await request(`/api/research/runs/${encodeURIComponent(id)}`,{signal});
 if(!saved.ok)throw Error('저장된 조사 기록을 열지 못했습니다.');
 const result=readResearchResult(await saved.text()),c=result.collection;
 if(c.id!==id)throw Error('요청한 조사 기록과 다릅니다.');
 const response=await request(`/api/evidence-scout/searches/${encodeURIComponent(c.request.search_id)}`,{signal});
 if(!response.ok)throw Error('조사의 원래 검색 기록을 열지 못했습니다.');
 const receipt=readScoutReceipt(await response.json());
 if(receipt.id!==c.request.search_id)throw Error('조사 출처가 다릅니다.');
 const study=receipt.studies.find(s=>s.nct_id===c.request.nct_id&&s.conditions.includes(c.request.indication));
 if(!study)throw Error('저장한 시험·적응증과 다릅니다.');
 signal.throwIfAborted();
 let automation:AutoSaved|null=null,automationError:string|undefined;
 try{automation=await loadAutoSaved(result,signal,request);}catch{signal.throwIfAborted();automationError='자동 추출 저장 상태를 불러오지 못했습니다. 조사 결과만 표시합니다.';}
 let registryResults:RegistryResults|null=null,registryError:string|undefined;
 try{registryResults=await loadRegistryResults(result,signal,request);}catch{signal.throwIfAborted();registryError='등록 결과표를 불러오지 못했습니다. 결과가 없다는 뜻은 아닙니다.';}
 let exploration:Exploration|null=null,explorationError:string|undefined;
 try{exploration=await requestExploration(result,signal,request);}catch{signal.throwIfAborted();explorationError='저장한 가상 설계 탐색을 확인하지 못했습니다. 새 계산은 실행하지 않았습니다.';}
 return {kind:'result',receipt,result,automation,automationError,registryResults,registryError,exploration,explorationError,document:automation?.document,candidate:{study,asset:c.request.asset,indication:c.request.indication,score:0,reason:'저장된 검토 범위입니다. 자동으로 다시 조사하거나 범위를 승인하지 않습니다.'}};
}
