export const purposes = ["original_storage", "internal_search", "external_ai", "training"] as const;
export type Purpose = typeof purposes[number];
export type Decision = "ALLOW" | "DENY" | "UNKNOWN";
export type PolicyDraft = Record<Purpose, Decision> & {evidence_reference:string;reason:string};
export type SourcePolicy = Record<Purpose, Decision> & {
  resource_kind:"SOURCE_TEXT";run_id:string;source_id:string;source_digest:string;
  policy_revision:number;evidence_reference:string|null;reason:string|null;
  asserted_by:string|null;created_at:string|null;verification:"UNVERIFIED"|"USER_ATTESTED_UNVERIFIED";
};
export type SourceMetadata = {source_id:string;source_digest:string;title:string;usage_policy:SourcePolicy};
export type MetadataPacket = {run_id:string;resource_kind:"SOURCE_TEXT";can_manage:boolean;sources:SourceMetadata[]};
export type PolicyPacket = {current:SourcePolicy;history:SourcePolicy[];can_manage:boolean};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
function invalid():never{throw Error("출처 이용조건 응답의 대상 또는 형식이 올바르지 않습니다.");}
function object(value:unknown,keys:string[]):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))return invalid();
  const row=value as Record<string,unknown>;
  if(Object.keys(row).length!==keys.length||keys.some(key=>!(key in row)))return invalid();
  return row;
}
function text(value:unknown,max:number):value is string{return typeof value==="string"&&value.trim().length>0&&value.length<=max;}
export function readSourcePolicy(value:unknown,runId:string,sourceId:string,sourceDigest:string):SourcePolicy{
  const row=object(value,[...purposes,"resource_kind","run_id","source_id","source_digest","policy_revision","evidence_reference","reason","asserted_by","created_at","verification"]);
  if(!uuid.test(runId)||!text(sourceId,150)||!digest.test(sourceDigest)||row.run_id!==runId||row.source_id!==sourceId||row.source_digest!==sourceDigest||row.resource_kind!=="SOURCE_TEXT")return invalid();
  if(!Number.isInteger(row.policy_revision)||Number(row.policy_revision)<0||Number(row.policy_revision)>100||purposes.some(p=>typeof row[p]!=="string"||!["ALLOW","DENY","UNKNOWN"].includes(row[p] as string)))return invalid();
  if(row.policy_revision===0){
    if(purposes.some(p=>row[p]!=="UNKNOWN")||row.verification!=="UNVERIFIED"||["evidence_reference","reason","asserted_by","created_at"].some(k=>row[k]!==null))return invalid();
  }else if(row.verification!=="USER_ATTESTED_UNVERIFIED"||!text(row.evidence_reference,2000)||!text(row.reason,4000)||typeof row.asserted_by!=="string"||!uuid.test(row.asserted_by)||typeof row.created_at!=="string"||!Number.isFinite(Date.parse(row.created_at)))return invalid();
  return row as SourcePolicy;
}
export function readSourceMetadata(value:unknown,runId:string):MetadataPacket{
  const row=object(value,["run_id","resource_kind","can_manage","sources"]);
  if(!uuid.test(runId)||row.run_id!==runId||row.resource_kind!=="SOURCE_TEXT"||typeof row.can_manage!=="boolean"||!Array.isArray(row.sources)||row.sources.length>500)return invalid();
  const seen=new Set<string>();
  const sources=row.sources.map(value=>{
    const source=object(value,["source_id","source_digest","title","usage_policy"]);
    if(!text(source.source_id,150)||typeof source.source_digest!=="string"||!digest.test(source.source_digest)||!text(source.title,20000)||seen.has(source.source_id))return invalid();
    seen.add(source.source_id);
    return {source_id:source.source_id,source_digest:source.source_digest,title:source.title,usage_policy:readSourcePolicy(source.usage_policy,runId,source.source_id,source.source_digest)};
  });
  return {run_id:runId,resource_kind:"SOURCE_TEXT",can_manage:row.can_manage,sources};
}
export function readSourcePolicyHistory(value:unknown,runId:string,sourceId:string,sourceDigest:string):PolicyPacket{
  const row=object(value,["current","history","can_manage"]);
  if(typeof row.can_manage!=="boolean"||!Array.isArray(row.history)||row.history.length>100)return invalid();
  const current=readSourcePolicy(row.current,runId,sourceId,sourceDigest);
  const history=row.history.map(v=>readSourcePolicy(v,runId,sourceId,sourceDigest));
  if(history.length!==current.policy_revision||history.some((v,i)=>v.policy_revision!==current.policy_revision-i))return invalid();
  if(history.length&&Object.keys(current).some(k=>current[k as keyof SourcePolicy]!==history[0][k as keyof SourcePolicy]))return invalid();
  return {current,history,can_manage:row.can_manage};
}
export function policyDraft(policy:SourcePolicy):PolicyDraft{
  return {original_storage:policy.original_storage,internal_search:policy.internal_search,external_ai:policy.external_ai,training:policy.training,evidence_reference:policy.evidence_reference??"",reason:policy.reason??""};
}
export class SourcePolicyRequestError extends Error{
  readonly status:number;
  constructor(status:number){super(status===409?"다른 변경이 먼저 저장됐거나 출처 버전이 바뀌었습니다.":status===401?"로그인이 만료됐습니다. 다시 로그인하세요.":status===403?"이용조건을 변경할 권한이 없습니다.":status===404?"현재 팀에서 이 조사나 출처를 찾을 수 없습니다.":"출처 이용조건 요청을 완료하지 못했습니다.");this.status=status;}
}
export async function sourcePolicyRequest(path:string,body?:unknown,signal?:AbortSignal,request:typeof fetch=fetch):Promise<unknown>{
  const response=await request(path,{method:body===undefined?"GET":"POST",headers:body===undefined?undefined:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal,cache:"no-store"});
  if(!response.ok)throw new SourcePolicyRequestError(response.status);
  const raw=await response.text();if(raw.length>8_000_000)throw Error("출처 이용조건 응답이 너무 큽니다.");return JSON.parse(raw);
}
