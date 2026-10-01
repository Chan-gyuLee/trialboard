/** User-confirmed convenience over existing per-resource CAS APIs; never grants on load. */
import {readSourceMetadata,readSourcePolicyHistory,sourcePolicyRequest,type MetadataPacket} from './research-source-policy.ts';
import {readRawMetadata,readRawHistory,type RawMetadata} from './research-raw-policy.ts';
export type FlowMetadata={sources:MetadataPacket;raw:RawMetadata};
export async function loadFlowMetadata(runId:string,signal:AbortSignal,request:typeof fetch=fetch):Promise<FlowMetadata>{
 const base=`/api/research/runs/${encodeURIComponent(runId)}`;
 const [source,raw]=await Promise.all(['source-metadata','raw-metadata'].map(p=>sourcePolicyRequest(`${base}/${p}`,undefined,signal,request)));
 signal.throwIfAborted();const result={sources:readSourceMetadata(source,runId),raw:readRawMetadata(raw,runId)};
 if(result.sources.sources.length!==result.raw.sources.length||result.sources.sources.some(s=>!result.raw.sources.some(r=>r.source_id===s.source_id&&r.source_digest===s.source_digest)))throw Error('출처와 수집 원본의 버전이 다릅니다. 목록을 다시 확인하세요.');
 return result;
}
export function reviewReadiness(metadata:FlowMetadata,sourceId:string):{ready:boolean;rawCount:number;reason:string}{
 const source=metadata.sources.sources.find(s=>s.source_id===sourceId),raw=metadata.raw.sources.find(s=>s.source_id===sourceId);
 if(!source||!raw||source.source_digest!==raw.source_digest)throw Error('선택한 출처 버전을 확인하지 못했습니다.');
 const textReady=source.usage_policy.original_storage==='ALLOW'&&source.usage_policy.external_ai==='ALLOW';
 const rawReady=raw.snapshots.every(s=>s.usage_policy.original_storage==='ALLOW'&&s.usage_policy.external_ai==='ALLOW');
 return {ready:textReady&&rawReady,rawCount:raw.snapshots.length,reason:textReady&&rawReady?'검토 가능':!textReady&&!rawReady?'텍스트·원본 허가 확인 필요':!textReady?'텍스트 허가 확인 필요':'원본 허가 확인 필요'};
}
export class FlowApprovalError extends Error{completed:number;constructor(message:string,completed:number){super(message);this.completed=completed;}}
export async function approveFlowSelection(options:{runId:string;metadata:FlowMetadata;selected:string[];evidence:string;reason:string;textConfirmed:boolean;rawConfirmed:boolean;signal:AbortSignal;onProgress?:(n:number,total:number)=>void;request?:typeof fetch}):Promise<number>{
 const {runId,metadata,selected,signal}=options,request=options.request??fetch;
 const evidence=options.evidence.trim(),reason=options.reason.trim();
 if(metadata.sources.run_id!==runId||metadata.raw.run_id!==runId||!metadata.sources.can_manage||!metadata.raw.can_manage||options.textConfirmed!==true||options.rawConfirmed!==true||selected.length<1||selected.length>8||new Set(selected).size!==selected.length||!evidence||Array.from(evidence).length>2000||!reason||Array.from(reason).length>4000)throw new FlowApprovalError('선택 자료의 텍스트·원본 허가와 근거를 모두 확인하세요.',0);
 const writes:{path:string;body:Record<string,unknown>;read:(value:unknown)=>number;revision:number}[]=[];
 for(const id of selected){
  reviewReadiness(metadata,id);const source=metadata.sources.sources.find(s=>s.source_id===id)!,raw=metadata.raw.sources.find(s=>s.source_id===id)!;
  const path=`/api/research/runs/${encodeURIComponent(runId)}/sources/${encodeURIComponent(id)}`;
  const body=(p:{policy_revision:number;internal_search:string;training:string})=>({source_digest:source.source_digest,expected_policy_revision:p.policy_revision,original_storage:'ALLOW',external_ai:'ALLOW',internal_search:p.internal_search,training:p.training,evidence_reference:evidence,reason});
  const p=source.usage_policy;
  if(p.original_storage!=='ALLOW'||p.external_ai!=='ALLOW')writes.push({path:`${path}/usage-policy`,body:body(p),read:v=>readSourcePolicyHistory(v,runId,id,source.source_digest).current.policy_revision,revision:p.policy_revision});
  for(const snapshot of raw.snapshots){const p=snapshot.usage_policy;if(p.original_storage==='ALLOW'&&p.external_ai==='ALLOW')continue;
   writes.push({path:`${path}/raw-usage-policy`,body:{...body(p),snapshot_digest:snapshot.snapshot_digest},read:v=>readRawHistory(v,{runId,sourceId:id,sourceDigest:source.source_digest,snapshotDigest:snapshot.snapshot_digest}).current.policy_revision,revision:p.policy_revision});
  }
 }
 if(writes.length>64||writes.some(w=>w.revision>=100))throw new FlowApprovalError('한 번에 확인할 원본이 너무 많거나 이력 한도에 도달했습니다. 자료를 나누거나 상세 이용조건을 확인하세요.',0);
 let completed=0;
 try{for(const w of writes){signal.throwIfAborted();const value=await sourcePolicyRequest(w.path,w.body,signal,request);if(w.read(value)!==w.revision+1)throw Error('저장된 이력 번호가 달라졌습니다.');completed++;options.onProgress?.(completed,writes.length);signal.throwIfAborted();}return completed;}
 catch(e){throw new FlowApprovalError(`${completed}건의 저장 응답을 확인했습니다. 마지막 요청은 저장됐지만 응답을 확인하지 못했을 수 있습니다. 자동 재시도하지 않았습니다. 목록을 다시 확인하세요. ${e instanceof Error?e.message:''}`,completed);}
}
