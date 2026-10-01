/** TEAM two-step collection only. Never requests a model, PDF or derived private body. */
import {isLocalDemo} from './agent-live.ts';
import {chooseCandidate,researchCandidates,type AutoEvent,type Candidate,type Scope} from './auto-review.ts';
import {readScoutReceipt,readScoutStream,type Receipt} from './evidence-scout.ts';
import {readResearchStream,type ResearchEvent} from './research.ts';
import {readSourceMetadata,type MetadataPacket} from './research-source-policy.ts';
import {readRawMetadata,type RawMetadata} from './research-raw-policy.ts';
import {readRawStoragePermissions,type RawStoragePermission} from './raw-storage-consent.ts';
import {strictJson} from './field-review.ts';
export type TeamCollectionResult={kind:'collected';runId:string;receipt:Receipt;candidate:Candidate;sources:MetadataPacket;raw:RawMetadata};
export type TeamCollectionOutcome=TeamCollectionResult|{kind:'scope';receipt:Receipt;candidates:Candidate[]};
type Options={query:string;consent:boolean;permissions:RawStoragePermission[];signal:AbortSignal;onEvent:(e:AutoEvent)=>void;receipt?:Receipt;scope?:Scope;fetcher?:typeof fetch;location?:Pick<Location,'hostname'|'protocol'|'port'>};
export async function readTeamCollectionStream(response:Response,signal:AbortSignal,onEvent:(e:ResearchEvent)=>void):Promise<string>{
 signal.throwIfAborted();
 const runId=await readResearchStream(response,event=>{
  signal.throwIfAborted();
  if(!['STARTED','PLAN','SEARCH','SOURCE','GAP','COMPLETE','ERROR'].includes(event.stage))throw Error('수집 전용 요청에서 예상하지 않은 AI 이벤트를 받았습니다. 결과를 자동 채택하지 않습니다.');
  onEvent(event);
 });
 signal.throwIfAborted();return runId;
}
export async function runTeamCollection(o:Options):Promise<TeamCollectionOutcome>{
 const query=o.query.trim(),permissions=readRawStoragePermissions(o.permissions),request=o.fetcher??fetch;
 if(!isLocalDemo(o.location??window.location))throw Error('팀 자료 수집은 현재 로컬 작업공간에서 실행하세요.');
 if(o.consent!==true||query.length<2||query.length>100||permissions.length===0)throw Error('공개 검색 동의와 최소 한 경로의 원본 저장 허가를 확인하세요.');
 const check=()=>o.signal.throwIfAborted();check();
 const capability=await request('/api/evidence-scout/capabilities',{signal:o.signal,cache:'no-store'});
 if(!capability.ok)throw Error('공개 자료 수집 기능을 확인하지 못했습니다.');
 const caps=await capability.json();if(caps.enabled!==true||caps.persisted!==true)throw Error('서버의 공개 자료 수집 기능이 비활성화되어 있습니다.');
 check();let receipt:Receipt;
 if(o.receipt){receipt=readScoutReceipt(o.receipt);if(receipt.query!==query)throw Error('검색어가 바뀌었습니다. 새 수집을 시작하세요.');}
 else{
  o.onEvent({stage:'SEARCH',message:'공개 시험을 찾습니다. 이 단계는 AI를 요청하지 않습니다.'});check();
  const response=await request('/api/evidence-scout/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,public_query_confirmed:true}),signal:o.signal});
  receipt=await readScoutStream(response,query,e=>o.onEvent({stage:'SEARCH',message:e.message??'시험 검색 기록 저장'}));
 }
 check();const candidates=researchCandidates(receipt),candidate=chooseCandidate(receipt,o.scope);
 if(!candidates.length)throw Error('수집할 약물·적응증을 확인하지 못했습니다. 정확한 이름이나 NCT 번호를 확인하세요.');
 if(!candidate){if(o.scope)throw Error('선택한 범위가 검색 기록과 일치하지 않습니다.');return {kind:'scope',receipt,candidates};}
 o.onEvent({stage:'SELECTED',message:`${candidate.study.nct_id} · 허가한 경로에서 자료만 수집합니다.`});check();
 const response=await request('/api/research/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({search_id:receipt.id,nct_id:candidate.study.nct_id,asset:candidate.asset,indication:candidate.indication,public_consent:true,model_consent:false,raw_storage_permissions:permissions}),signal:o.signal});
 const runId=await readTeamCollectionStream(response,o.signal,research=>{
  o.onEvent({stage:'RESEARCH',message:research.message,research});
 });check();
 const base=`/api/research/runs/${encodeURIComponent(runId)}`;
 async function metadata(suffix:string){const r=await request(`${base}/${suffix}`,{signal:o.signal,cache:'no-store'});if(!r.ok)throw Error('수집 기록의 이용조건을 불러오지 못했습니다. 다시 수집하지 말고 최근 검토를 확인하세요.');return strictJson(await r.text(),25000000);}
 const [sourceValue,rawValue]=await Promise.all([metadata('source-metadata'),metadata('raw-metadata')]);check();
 const sources=readSourceMetadata(sourceValue,runId),raw=readRawMetadata(rawValue,runId);
 const versions=new Map(sources.sources.map(s=>[s.source_id,s.source_digest]));
 if(raw.sources.length!==versions.size||raw.sources.some(s=>versions.get(s.source_id)!==s.source_digest))throw Error('수집 원본과 출처의 버전이 다릅니다. 기록을 새로고침하세요.');
 return {kind:'collected',runId,receipt,candidate,sources,raw};
}
