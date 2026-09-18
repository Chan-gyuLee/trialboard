import {safeSourceUrl,type ResearchResult} from './research.ts';
import {readReadiness,type Readiness} from './registry-readiness.ts';
export type RegistryResults={schema:'registry-result-tables/1';runId:string;nctId:string;snapshotDigest:string;sourceUrl:string;clinicalVerified:false;computedRates:false;limited:boolean;notice:string;readiness?:Readiness;outcomes:{title:string;groupId:string;groupTitle:string;groupDescription:string;population:string;window:string;definition:string;parameter:string;unit:string;classTitle:string;categoryTitle:string;value:string;lower:string|null;upper:string|null;dispersion:string;denominators:{unit:string;value:string}[];denominatorScope?:'CLASS'|'OUTCOME';overallDenominators?:{unit:string;value:string}[];spread?:string|null;comment?:string;locator:string}[];safety:{groupId:string;groupTitle:string;groupDescription:string;metric:string;affected:number|null;atRisk:number|null;window:string;description:string;locator:string}[]};
export function readRegistryResults(value:unknown,result:ResearchResult):RegistryResults|null{
 if(value===null)return null;const r=value as RegistryResults;
 if(!r||r.schema!=='registry-result-tables/1'||r.runId!==result.collection.id||r.nctId!==result.collection.request.nct_id||r.clinicalVerified!==false||r.computedRates!==false||typeof r.limited!=='boolean'||!safeSourceUrl(r.sourceUrl)||r.sourceUrl!==`https://clinicaltrials.gov/study/${r.nctId}`||!/^[a-f0-9]{64}$/.test(r.snapshotDigest)||!Array.isArray(r.outcomes)||r.outcomes.length>100||!Array.isArray(r.safety)||r.safety.length>60||typeof r.notice!=='string')throw Error('등록 결과표 연결 오류');
 for(const row of r.outcomes){
  for(const key of ['title','groupId','groupTitle','groupDescription','population','window','definition','parameter','unit','classTitle','categoryTitle','value','dispersion','locator'] as const)if(typeof row[key]!=='string'||row[key].length>20000)throw Error('등록 결과표 문구 오류');
  if(!Array.isArray(row.denominators)||row.denominators.length>100||row.denominators.some(d=>typeof d.unit!=='string'||typeof d.value!=='string'))throw Error('등록 분모 오류');
  if([row.lower,row.upper].some(v=>v!==null&&typeof v!=='string'))throw Error('등록 구간값 오류');
  if(row.denominatorScope!==undefined&&!['CLASS','OUTCOME'].includes(row.denominatorScope))throw Error('등록 분모 범위 오류');
  if(row.overallDenominators!==undefined&&(!Array.isArray(row.overallDenominators)||row.overallDenominators.length>100||row.overallDenominators.some(d=>typeof d.unit!=='string'||typeof d.value!=='string')))throw Error('전체 분모 형식 오류');
  if(row.spread!==undefined&&row.spread!==null&&typeof row.spread!=='string'||row.comment!==undefined&&typeof row.comment!=='string')throw Error('등록 산포·주석 오류');
 }
 for(const row of r.safety){
  for(const key of ['groupId','groupTitle','groupDescription','metric','window','description','locator'] as const)if(typeof row[key]!=='string'||row[key].length>20000)throw Error('등록 안전성 문구 오류');
  for(const v of [row.affected,row.atRisk])if(v!==null&&(!Number.isSafeInteger(v)||v<0))throw Error('등록 안전성 수치 오류');
 }
 if(r.readiness!==undefined)readReadiness(r.readiness,r);
 return r;
}
export async function loadRegistryResults(result:ResearchResult,signal:AbortSignal,request:typeof fetch=fetch){
 const response=await request(`/api/research/runs/${result.collection.id}/result-tables`,{signal,cache:'no-store'});
 if(response.status===404)return null;if(!response.ok)throw Error('등록 결과표를 확인하지 못했습니다.');
 return readRegistryResults(await response.json(),result);
}
