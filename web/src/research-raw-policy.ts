import {purposes,type Decision,type PolicyDraft} from './research-source-policy.ts';
import {strictJson} from './field-review.ts';
export type RawKey={runId:string;sourceId:string;sourceDigest:string;snapshotDigest:string};
export type RawPolicy=Record<typeof purposes[number],Decision>&{
 resource_kind:'RAW_SNAPSHOT';run_id:string;source_id:string;source_digest:string;snapshot_digest:string;policy_revision:number;
 evidence_reference:string|null;reason:string|null;asserted_by:string|null;created_at:string|null;verification:'UNVERIFIED'|'USER_ATTESTED_UNVERIFIED';
};
export type RawSnapshot={snapshot_digest:string;byte_length:number;usage_policy:RawPolicy};
export type RawSource={source_id:string;source_digest:string;title:string;snapshots:RawSnapshot[]};
export type RawMetadata={run_id:string;resource_kind:'RAW_SNAPSHOT';can_manage:boolean;sources:RawSource[]};
export type RawHistory={current:RawPolicy;history:RawPolicy[];can_manage:boolean};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,sha=/^[a-f0-9]{64}$/;
function invalid():never{throw Error('수집 원본 이용조건의 대상 또는 형식이 올바르지 않습니다.');}
function object(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const row=value as Record<string,unknown>;if(Object.keys(row).length!==keys.length||keys.some(k=>!(k in row)))return invalid();return row;
}
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&Array.from(v).length<=max&&!/[\uD800-\uDFFF]/u.test(v);
const integer=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
export function readRawPolicy(value:unknown,key:RawKey):RawPolicy{
 const row=object(value,['resource_kind','run_id','source_id','source_digest','snapshot_digest','policy_revision',...purposes,'evidence_reference','reason','asserted_by','created_at','verification']);
 if(!uuid.test(key.runId)||!text(key.sourceId,150)||!sha.test(key.sourceDigest)||!sha.test(key.snapshotDigest)||row.resource_kind!=='RAW_SNAPSHOT'||row.run_id!==key.runId||row.source_id!==key.sourceId||row.source_digest!==key.sourceDigest||row.snapshot_digest!==key.snapshotDigest)return invalid();
 if(!integer(row.policy_revision,0,100)||purposes.some(p=>!['ALLOW','DENY','UNKNOWN'].includes(row[p] as string)))return invalid();
 if(row.policy_revision===0){if(purposes.some(p=>row[p]!=='UNKNOWN')||row.verification!=='UNVERIFIED'||['evidence_reference','reason','asserted_by','created_at'].some(k=>row[k]!==null))return invalid();}
 else if(row.verification!=='USER_ATTESTED_UNVERIFIED'||!text(row.evidence_reference,2000)||!text(row.reason,4000)||typeof row.asserted_by!=='string'||!uuid.test(row.asserted_by)||typeof row.created_at!=='string'||!Number.isFinite(Date.parse(row.created_at))||!/(?:Z|\+00:00)$/.test(row.created_at))return invalid();
 return row as RawPolicy;
}
export function readRawMetadata(value:unknown,runId:string):RawMetadata{
 const row=object(value,['run_id','resource_kind','can_manage','sources']);
 if(!uuid.test(runId)||row.run_id!==runId||row.resource_kind!=='RAW_SNAPSHOT'||typeof row.can_manage!=='boolean'||!Array.isArray(row.sources)||row.sources.length>500)return invalid();
 const seen=new Set<string>();let total=0;
 const sources=row.sources.map(value=>{
  const source=object(value,['source_id','source_digest','title','snapshots']);
  if(!text(source.source_id,150)||typeof source.source_digest!=='string'||!sha.test(source.source_digest)||!text(source.title,20000)||seen.has(source.source_id)||!Array.isArray(source.snapshots)||source.snapshots.length>100)return invalid();
  seen.add(source.source_id);const ids=new Set<string>();total+=source.snapshots.length;if(total>1000)return invalid();
  const snapshots=source.snapshots.map(value=>{
   const snapshot=object(value,['snapshot_digest','byte_length','usage_policy']);
   if(typeof snapshot.snapshot_digest!=='string'||!sha.test(snapshot.snapshot_digest)||ids.has(snapshot.snapshot_digest)||!integer(snapshot.byte_length,2,5000000))return invalid();ids.add(snapshot.snapshot_digest);
   return {snapshot_digest:snapshot.snapshot_digest,byte_length:snapshot.byte_length,usage_policy:readRawPolicy(snapshot.usage_policy,{runId,sourceId:source.source_id as string,sourceDigest:source.source_digest as string,snapshotDigest:snapshot.snapshot_digest})};
  });
  return {source_id:source.source_id,source_digest:source.source_digest,title:source.title,snapshots};
 });
 return {run_id:runId,resource_kind:'RAW_SNAPSHOT',can_manage:row.can_manage,sources};
}
export function readRawHistory(value:unknown,key:RawKey):RawHistory{
 const row=object(value,['current','history','can_manage']);if(typeof row.can_manage!=='boolean'||!Array.isArray(row.history)||row.history.length>100)return invalid();
 const current=readRawPolicy(row.current,key),history=row.history.map(v=>readRawPolicy(v,key));
 if(history.length!==current.policy_revision||history.some((v,i)=>v.policy_revision!==current.policy_revision-i)||history.length&&Object.keys(current).some(k=>current[k as keyof RawPolicy]!==history[0][k as keyof RawPolicy]))return invalid();
 return {current,history,can_manage:row.can_manage};
}
export const rawDraft=(p:RawPolicy):PolicyDraft=>({original_storage:p.original_storage,internal_search:p.internal_search,external_ai:p.external_ai,training:p.training,evidence_reference:p.evidence_reference??'',reason:p.reason??''});
export class RawRequestError extends Error{
 readonly status:number;
 constructor(status:number){super(status===401?'로그인이 만료되었습니다.':status===403?'현재 권한으로 수집 원본 이용조건을 변경할 수 없습니다.':status===409?'수집 원본·출처 버전 또는 이용조건 이력이 바뀌었습니다.':status===404?'현재 팀에서 이 수집 원본을 찾을 수 없습니다.':status===422?'수집 원본 또는 이용조건이 처리 한도·형식에 맞지 않습니다.':'수집 원본 이용조건을 확인하지 못했습니다.');this.status=status;}
}
export async function rawRequest(path:string,signal:AbortSignal,body?:unknown){
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal,cache:'no-store'});
 if(!response.ok)throw new RawRequestError(response.status);
 return strictJson(await response.text(),25000000);
}
