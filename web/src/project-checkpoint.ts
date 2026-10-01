/** Checkpoint consistency only: never model execution, identity, or clinical approval. */
import { canonical, digest, importAgentReport, strictJson, type FieldReview } from "./field-review.ts";
import { restoreReview } from "./field-review-restore.ts";
import { restoreDesignInput } from "./design-draft.ts";
import { draftFromBrief, exact, obj, type DesignDraft } from "./design-brief.ts";
import { restorePacket, type MeetingSession } from "./meeting-packet.ts";
import { evidenceExport, validatePdfBytes, type EvidenceNote, type PdfSource } from "./pdf-contract.ts";
import type { ScoutContext } from "./evidence-scout.ts";

export type DesignCheckpoint = {draftRaw:string; meetingRaw:string|null};
export type ReviewCheckpoint = DesignCheckpoint & {reviewRaw:string; agentRaw:string|null};
export type Capture<T> = {current:(()=>Promise<T>)|null};
export type ProjectBundle = ReviewCheckpoint & {schema:"trialboard-project/1";source:PdfSource;notes:EvidenceNote[];context:ScoutContext|null};
export type RestoredProject = {review:FieldReview;draft:DesignDraft;session:MeetingSession|null;agentRaw:string|null};
export type ProjectSharingScope="team_wide"|"restricted";
export type ProjectAccessGrant={subject_id:string;access:"owner"|"write"|"read"};
export type SourceVersion={version_id:string|null;is_series_head:boolean;series_head_revision:number;predecessor_project_id:string|null;predecessor_review_revision:number|null};
export type UsageDecision="ALLOW"|"DENY"|"UNKNOWN";
export type UsagePolicyAssertion={original_storage:UsageDecision;internal_search:UsageDecision;external_ai:UsageDecision;training:UsageDecision;evidence_reference:string;reason:string};
export type UsagePolicy=Omit<UsagePolicyAssertion,"evidence_reference">&{project_id:string;pdf_digest:string;policy_revision:number;evidence_reference:string|null;author:{subject_id:string;username:string;role:string}|null;asserted_at:string|null;verification_status:"USER_ATTESTED_UNVERIFIED";can_manage?:boolean;training_capability:"CAPABILITY_ABSENT"};
export type UsagePolicyHistory={current:UsagePolicy;history:UsagePolicy[]};
export type ProjectReceipt = {project_id:string; revision:number; title:string; created_at:string;pdf_digest:string;bundle_digest:string;original_filename?:string;sharing_scope?:ProjectSharingScope;acl_revision?:number;author?:string;access_source?:string;can_manage_access?:boolean;can_create_source_version?:boolean;source_version?:SourceVersion;usage_policy?:UsagePolicy};
export type ProjectModelBinding={project_id:string;review_revision:number;pdf_digest:string;policy_revision:number};
export type ProjectRecord = ProjectReceipt & {bundle_json:string;pdf_base64:string};
export const PROJECT_BYTES=48*1024*1024;
const UUID_PATTERN=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/;
function fail():never{throw Error("프로젝트 기록의 형식·PDF·검토 버전이 맞지 않습니다. 기존 작업은 유지됩니다.");}
export function projectModelBinding(receipt:ProjectReceipt|null):ProjectModelBinding|null{
  const policy=receipt?.usage_policy;
  if(!receipt||receipt.sharing_scope==="restricted"||!policy||policy.project_id!==receipt.project_id||policy.pdf_digest!==receipt.pdf_digest||policy.external_ai!=="ALLOW"||policy.policy_revision<1)return null;
  return{project_id:receipt.project_id,review_revision:receipt.revision,pdf_digest:receipt.pdf_digest,policy_revision:policy.policy_revision};
}
export function readProjectReceipt(value:unknown):ProjectReceipt {
  const r=obj(value);
  const allowed=new Set(["project_id","revision","title","created_at","pdf_digest","bundle_digest","original_filename","sharing_scope","acl_revision","author","access_source","can_manage_access","can_create_source_version","source_version","usage_policy","bundle_json","pdf_base64"]);
  if(Object.keys(r).some(key=>!allowed.has(key)))fail();
  if(typeof r.project_id!=="string"||!/^[a-f\d-]{36}$/.test(r.project_id)||!Number.isInteger(r.revision)||Number(r.revision)<1||Number(r.revision)>100||typeof r.title!=="string"||!r.title.trim()||r.title.length>120||typeof r.created_at!=="string"||!Number.isFinite(Date.parse(r.created_at))||typeof r.pdf_digest!=="string"||!/^[a-f\d]{64}$/.test(r.pdf_digest)||typeof r.bundle_digest!=="string"||!/^[a-f\d]{64}$/.test(r.bundle_digest))fail();
  if(r.sharing_scope!==undefined&&r.sharing_scope!=="team_wide"&&r.sharing_scope!=="restricted")fail();
  if(r.acl_revision!==undefined&&(!Number.isInteger(r.acl_revision)||Number(r.acl_revision)<0||Number(r.acl_revision)>10000))fail();
  if(r.can_manage_access!==undefined&&typeof r.can_manage_access!=="boolean")fail();
  if(r.can_create_source_version!==undefined&&typeof r.can_create_source_version!=="boolean")fail();
  if(r.original_filename!==undefined&&(typeof r.original_filename!=="string"||!r.original_filename||r.original_filename.length>2000))fail();
  if(r.author!==undefined&&(typeof r.author!=="string"||!r.author||r.author.length>120))fail();
  if(r.access_source!==undefined&&!['team_admin_override','project_owner','team_wide','owner','write','read'].includes(String(r.access_source)))fail();
  if(r.bundle_json!==undefined&&typeof r.bundle_json!=="string")fail();
  if(r.pdf_base64!==undefined&&typeof r.pdf_base64!=="string")fail();
  if(r.source_version!==undefined){const s=obj(r.source_version);exact(s,["version_id","is_series_head","series_head_revision","predecessor_project_id","predecessor_review_revision"]);const linked=s.version_id!==null;
    if((linked&&(typeof s.version_id!=="string"||!/^[a-f\d-]{36}$/.test(s.version_id)))||typeof s.is_series_head!=="boolean"||!Number.isInteger(s.series_head_revision)||Number(s.series_head_revision)<0||Number(s.series_head_revision)>2147483647)fail();
    if((s.predecessor_project_id===null)!==(s.predecessor_review_revision===null))fail();
    if(s.predecessor_project_id!==null&&(typeof s.predecessor_project_id!=="string"||!/^[a-f\d-]{36}$/.test(s.predecessor_project_id)||!Number.isInteger(s.predecessor_review_revision)||Number(s.predecessor_review_revision)<1||Number(s.predecessor_review_revision)>100))fail();
    if(!linked&&(s.is_series_head!==true||s.series_head_revision!==0||s.predecessor_project_id!==null))fail();
    if(s.predecessor_project_id===r.project_id)fail();
  }
  if(r.usage_policy!==undefined){const policy=readUsagePolicy(r.usage_policy,true);if(policy.project_id!==r.project_id||policy.pdf_digest!==r.pdf_digest)fail();}
  return r as unknown as ProjectReceipt;
}
export function readUsagePolicy(value:unknown,allowManage=false):UsagePolicy{
  const p=obj(value);const keys=["project_id","pdf_digest","policy_revision","original_storage","internal_search","external_ai","training","evidence_reference","reason","author","asserted_at","verification_status","training_capability",...(allowManage?["can_manage"]:[])];exact(p,keys);
  const decision=(v:unknown)=>v==="ALLOW"||v==="DENY"||v==="UNKNOWN";
  if(typeof p.project_id!=="string"||!UUID_PATTERN.test(p.project_id)||typeof p.pdf_digest!=="string"||!/^[a-f\d]{64}$/.test(p.pdf_digest)||!Number.isInteger(p.policy_revision)||Number(p.policy_revision)<0||Number(p.policy_revision)>10000||!decision(p.original_storage)||!decision(p.internal_search)||!decision(p.external_ai)||!decision(p.training)||!(p.evidence_reference===null||typeof p.evidence_reference==="string")||(typeof p.evidence_reference==="string"&&p.evidence_reference.length>2000)||typeof p.reason!=="string"||p.reason.length>4000||!(p.asserted_at===null||(typeof p.asserted_at==="string"&&p.asserted_at.length<=64&&/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(p.asserted_at)&&Number.isFinite(Date.parse(p.asserted_at))))||p.verification_status!=="USER_ATTESTED_UNVERIFIED"||p.training_capability!=="CAPABILITY_ABSENT")fail();
  if(allowManage&&typeof p.can_manage!=="boolean")fail();
  if(p.author!==null){const a=obj(p.author);exact(a,["subject_id","username","role"]);if(typeof a.subject_id!=="string"||!UUID_PATTERN.test(a.subject_id)||typeof a.username!=="string"||!a.username.trim()||a.username!==a.username.trim()||a.username.length>120||!['admin','reviewer'].includes(String(a.role)))fail();}
  if(p.policy_revision===0){if(p.original_storage!=="UNKNOWN"||p.internal_search!=="UNKNOWN"||p.external_ai!=="UNKNOWN"||p.training!=="UNKNOWN"||p.evidence_reference!==null||p.reason!=="No asserted project usage policy is recorded."||p.author!==null||p.asserted_at!==null)fail();}
  else if(typeof p.evidence_reference!=="string"||!p.evidence_reference.trim()||p.evidence_reference!==p.evidence_reference.trim()||!p.reason.trim()||p.reason!==p.reason.trim()||p.author===null||p.asserted_at===null)fail();
  return p as unknown as UsagePolicy;
}
export function readUsagePolicyHistory(value:unknown,expected:{project_id:string;pdf_digest:string}):UsagePolicyHistory{
  if(!UUID_PATTERN.test(expected.project_id)||!/^[a-f\d]{64}$/.test(expected.pdf_digest))fail();
  const p=obj(value);exact(p,["current","history"]);if(!Array.isArray(p.history)||p.history.length>10000)fail();
  const current=readUsagePolicy(p.current,true),history=p.history.map(value=>readUsagePolicy(value));
  if(current.project_id!==expected.project_id||current.pdf_digest!==expected.pdf_digest||history.some(item=>item.project_id!==expected.project_id||item.pdf_digest!==expected.pdf_digest))fail();
  if(current.policy_revision===0){if(history.length!==0)fail();return{current,history};}
  if(history.length!==current.policy_revision)fail();
  for(let index=0;index<history.length;index++)if(history[index].policy_revision!==current.policy_revision-index)fail();
  const head=history[0];
  for(const key of ["project_id","pdf_digest","policy_revision","original_storage","internal_search","external_ai","training","evidence_reference","reason","author","asserted_at","verification_status","training_capability"] as const)if(JSON.stringify(current[key])!==JSON.stringify(head[key]))fail();
  return{current,history};
}
export function readBundle(raw:string):ProjectBundle {
  const p=obj(strictJson(raw,32*1024*1024,500000));
  exact(p,["schema","source","notes","reviewRaw","draftRaw","meetingRaw","agentRaw","context"]);
  if(p.schema!=="trialboard-project/1"||typeof p.reviewRaw!=="string"||typeof p.draftRaw!=="string"||!(p.meetingRaw===null||typeof p.meetingRaw==="string")||!(p.agentRaw===null||typeof p.agentRaw==="string"))fail();
  const source=obj(p.source);
  if(typeof source.name!=="string"||!source.name.length||source.name.length>2000||typeof source.sha256!=="string"||!/^[a-f\d]{64}$/.test(source.sha256)||!Number.isSafeInteger(source.byteLength)||Number(source.byteLength)<5||Number(source.byteLength)>5*1024*1024)fail();
  if(!Array.isArray(p.notes)||p.notes.length>100)fail();
  for(const value of p.notes){const n=obj(value);exact(n,["sourceDigest","spanId","quote","page","box","question","comment","userAttestedAt","locationStatus","meaningStatus"]);
    if(typeof n.question!=="string"||!n.question.trim()||n.question.length>500||typeof n.comment!=="string"||n.comment.length>2000||typeof n.userAttestedAt!=="string"||!Number.isFinite(Date.parse(n.userAttestedAt)))fail();}
  if(p.context!==null){const c=obj(p.context);exact(c,["asset","indication","study","question","receiptId",...(c.document===undefined?[]:["document"])]);
    for(const key of ["asset","indication","study","question","receiptId"])if(typeof c[key]!=="string"||!c[key]||c[key].length>2000)fail();
    if(c.document!==undefined){const d=obj(c.document);exact(d,["runId","sourceId","title"]);for(const v of Object.values(d))if(typeof v!=="string"||!v||v.length>2000)fail();}}
  return p as unknown as ProjectBundle;
}
export async function validateProject(bundle:ProjectBundle,source:PdfSource):Promise<RestoredProject>{
  // Fresh PDF extraction must match exactly; extractor changes do not silently relocate citations.
  if(canonical(bundle.source)!==canonical(source))fail();
  evidenceExport(source,bundle.notes);
  const review=restoreReview(bundle.reviewRaw,source);
  const {draft}=await restoreDesignInput(bundle.draftRaw,review,source);
  const packet=bundle.meetingRaw===null?null:await restorePacket(bundle.meetingRaw,review,source);
  if(packet&&canonical(draft)!==canonical(draftFromBrief(packet.result.brief)))fail();
  if(bundle.agentRaw!==null){
    if(review.origin.kind!=="imported_agent_report"||await digest(bundle.agentRaw)!==review.origin.reportDigest)fail();
    await importAgentReport(bundle.agentRaw,source);
  }
  return {review,draft,session:packet?{review,...packet}:null,agentRaw:bundle.agentRaw};
}
export async function projectFile(record:ProjectRecord):Promise<{file:File;bundle:ProjectBundle}>{
  readProjectReceipt(record);
  if(typeof record.bundle_json!=="string"||typeof record.pdf_base64!=="string"||record.pdf_base64.length>7*1024*1024||await digest(record.bundle_json)!==record.bundle_digest)fail();
  const bundle=readBundle(record.bundle_json);
  const bytes=Uint8Array.from(atob(record.pdf_base64),c=>c.charCodeAt(0));validatePdfBytes(bytes);
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
  if(sha!==record.pdf_digest||sha!==bundle.source.sha256||bytes.length!==bundle.source.byteLength)fail();
  return {file:new File([bytes],bundle.source.name,{type:"application/pdf"}),bundle};
}
export async function checkpointBody(title:string,file:File,bundle:ProjectBundle,receipt:ProjectReceipt|null,publicAuthorizedNonSensitive=false,sharingScope?:ProjectSharingScope,accessMembers:ProjectAccessGrant[]=[],sourceReceipt?:ProjectReceipt|null,usagePolicy?:UsagePolicyAssertion){
  await validateProject(readBundle(JSON.stringify(bundle)),bundle.source);
  const bytes=new Uint8Array(await file.arrayBuffer());validatePdfBytes(bytes);
  let binary="";for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  const raw=JSON.stringify({consent:true,project_id:receipt?.project_id??null,expected_revision:receipt?.revision??0,title,pdf_base64:btoa(binary),bundle_json:JSON.stringify(bundle),...(publicAuthorizedNonSensitive?{public_authorized_non_sensitive:true}:{}),...(sharingScope?{sharing_scope:sharingScope,access_members:accessMembers}:{}),...(sourceReceipt?{source_project_id:sourceReceipt.project_id,source_project_revision:sourceReceipt.revision}:{}),...(usagePolicy?{usage_policy:usagePolicy}:{})});
  if(new TextEncoder().encode(raw).length>PROJECT_BYTES)throw Error("프로젝트가 저장 요청 한도 48 MiB를 초과했습니다.");
  return raw;
}
export async function importCheckpointBody(title:string,file:File,bundleRaw:string,sharingScope:ProjectSharingScope,accessMembers:ProjectAccessGrant[],usagePolicy:UsagePolicyAssertion,contextDetachmentAcknowledged=false,previewDigest?:string){
  const bundle=readBundle(bundleRaw);await validateProject(bundle,bundle.source);
  const bytes=new Uint8Array(await file.arrayBuffer());validatePdfBytes(bytes);
  let binary="";for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  const raw=JSON.stringify({consent:true,project_id:null,expected_revision:0,title,pdf_base64:btoa(binary),bundle_json:bundleRaw,public_authorized_non_sensitive:true,sharing_scope:sharingScope,access_members:accessMembers,usage_policy:usagePolicy,...(contextDetachmentAcknowledged?{context_detachment_acknowledged:true}:{}),...(previewDigest?{import_preview_digest:previewDigest}: {})});
  if(new TextEncoder().encode(raw).length>PROJECT_BYTES)throw Error("프로젝트가 저장 요청 한도 48 MiB를 초과했습니다.");
  return raw;
}
export async function sourceVersionBody(title:string,file:File,bundle:ProjectBundle,parent:ProjectReceipt,usagePolicy:UsagePolicyAssertion){
  const base=JSON.parse(await checkpointBody(title,file,bundle,null,true,undefined,[],undefined,usagePolicy));
  return JSON.stringify({...base,confirmation:true,predecessor_project_id:parent.project_id,predecessor_review_revision:parent.revision,expected_series_head_revision:parent.source_version?.series_head_revision??0});
}
export async function projectRequest(path:string,body?:string):Promise<unknown>{
  if(!["http://localhost:5173","http://127.0.0.1:5173"].includes(location.origin))throw Error("프로젝트 저장은 로컬 개발 화면에서만 사용할 수 있습니다.");
  const response=await fetch(path,{method:body?"POST":"GET",headers:body?{"Content-Type":"application/json"}:undefined,body,signal:AbortSignal.timeout(30000),credentials:"omit",cache:"no-store",redirect:"error"});
  if(!response.ok){let code="";try{code=(await response.clone().json())?.detail??"";}catch{}await response.body?.cancel();if(response.status===409)throw Error(code==="REVIEW_VERSION_CONFLICT"?"REVIEW_VERSION_CONFLICT":code==="PROJECT_ACL_VERSION_CONFLICT"?"PROJECT_ACL_VERSION_CONFLICT":code==="PROJECT_USAGE_POLICY_VERSION_CONFLICT"?"PROJECT_USAGE_POLICY_VERSION_CONFLICT":code==="IMPORT_DUPLICATE"?"IMPORT_DUPLICATE":code==="SOURCE_SERIES_HEAD_CONFLICT"?"SOURCE_SERIES_HEAD_CONFLICT":code==="SOURCE_PDF_ALREADY_VERSIONED"?"SOURCE_PDF_ALREADY_VERSIONED":"PROJECT_VERSION_CONFLICT");if(code==="LEGACY_CONTEXT_RELINK_REQUIRED")throw Error("과거 조사 연결을 분리하려면 선택한 원본에 대한 별도 동의가 필요합니다.");if(code==="CONTEXT_DETACH_PREVIEW_REQUIRED"||code==="IMPORT_PREVIEW_REQUIRED")throw Error("파일·이름·공유 범위·이용조건 또는 동의가 바뀌었습니다. 저장 전 검사를 다시 실행하세요.");if(code==="PROJECT_ORIGINAL_STORAGE_BLOCKED")throw Error("현재 원본 저장 정책이 UNKNOWN 또는 DENY여서 PDF와 bundle을 열거나 새 checkpoint를 저장할 수 없습니다. 정책 관리자에서 조건을 확인하세요.");if(code==="ORIGINAL_STORAGE_ALLOW_REQUIRED")throw Error("원본 저장을 ALLOW로 선택하고 근거와 이유를 입력해야 새 PDF를 저장할 수 있습니다.");if(code==="LEGACY_CONTEXT_DETACH_UNSAFE")throw Error("이 bundle의 중첩 이력 계약은 안전하게 분리할 수 없어 가져오기를 중단했습니다.");if(code==="PUBLIC_AUTHORIZED_ATTESTATION_REQUIRED")throw Error("선택한 PDF와 bundle의 공개·사용 허가·비민감 자료 확인이 필요합니다.");if(code==="PROJECT_SHARING_SCOPE_REQUIRED")throw Error("새 프로젝트의 공유 범위를 선택하세요.");if(code==="PRIVATE_PROJECT_DERIVED_ACTIONS_DISABLED")throw Error("제한 프로젝트는 현재 팀 전체 조사·모델 이력과 자동 연결할 수 없습니다.");if(code==="SOURCE_PROJECT_WIDEN_FORBIDDEN")throw Error("제한 프로젝트를 복사해 팀 전체로 넓히려면 원본 프로젝트 소유자 권한이 필요합니다.");if(code==="SOURCE_VERSION_REQUIRES_CLEAN_BUNDLE")throw Error("새 원문 버전은 이전 메모·관측·승인·회의를 포함하지 않은 새 검토에서 저장하세요.");if(code==="SOURCE_VERSION_ACL_INACTIVE"||code==="SOURCE_VERSION_ACL_INVALID")throw Error("원본 프로젝트 ACL에 비활성 구성원 또는 유효하지 않은 소유자가 있습니다. 접근 관리에서 먼저 정리하세요.");throw Error(response.status===403?"이 역할에는 변경 권한이 없습니다.":response.status===404?"이 프로젝트에 접근할 수 없거나 존재하지 않습니다.":"프로젝트 서비스에 연결하지 못했습니다. --enable-evidence-scout 옵션과 저장 자료를 확인하세요.");}
  const reader=response.body?.getReader();if(!reader)fail();let bytes=0,raw="";const decoder=new TextDecoder("utf-8",{fatal:true});
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>PROJECT_BYTES)fail();raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return strictJson(raw,PROJECT_BYTES,500000);
}
