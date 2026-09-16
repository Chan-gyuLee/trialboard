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
export type ProjectReceipt = {project_id:string; revision:number; title:string; created_at:string;pdf_digest:string;bundle_digest:string};
export type ProjectRecord = ProjectReceipt & {bundle_json:string;pdf_base64:string};
export const PROJECT_BYTES=48*1024*1024;
function fail():never{throw Error("프로젝트 기록의 형식·PDF·검토 버전이 맞지 않습니다. 기존 작업은 유지됩니다.");}
export function readProjectReceipt(value:unknown):ProjectReceipt {
  const r=obj(value);
  if(typeof r.project_id!=="string"||!/^[a-f\d-]{36}$/.test(r.project_id)||!Number.isInteger(r.revision)||Number(r.revision)<1||Number(r.revision)>100||typeof r.title!=="string"||!r.title.trim()||r.title.length>120||typeof r.created_at!=="string"||!Number.isFinite(Date.parse(r.created_at))||typeof r.pdf_digest!=="string"||!/^[a-f\d]{64}$/.test(r.pdf_digest)||typeof r.bundle_digest!=="string"||!/^[a-f\d]{64}$/.test(r.bundle_digest))fail();
  return r as unknown as ProjectReceipt;
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
export async function checkpointBody(title:string,file:File,bundle:ProjectBundle,receipt:ProjectReceipt|null){
  await validateProject(readBundle(JSON.stringify(bundle)),bundle.source);
  const bytes=new Uint8Array(await file.arrayBuffer());validatePdfBytes(bytes);
  let binary="";for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  const raw=JSON.stringify({consent:true,project_id:receipt?.project_id??null,expected_revision:receipt?.revision??0,title,pdf_base64:btoa(binary),bundle_json:JSON.stringify(bundle)});
  if(new TextEncoder().encode(raw).length>PROJECT_BYTES)throw Error("프로젝트가 저장 요청 한도 48 MiB를 초과했습니다.");
  return raw;
}
export async function projectRequest(path:string,body?:string):Promise<unknown>{
  if(!["http://localhost:5173","http://127.0.0.1:5173"].includes(location.origin))throw Error("프로젝트 저장은 로컬 개발 화면에서만 사용할 수 있습니다.");
  const response=await fetch(path,{method:body?"POST":"GET",headers:body?{"Content-Type":"application/json"}:undefined,body,signal:AbortSignal.timeout(30000),credentials:"omit",cache:"no-store",redirect:"error"});
  if(!response.ok){await response.body?.cancel();throw Error(response.status===409?"새 버전이 이미 있거나 저장 한도·무결성 문제가 있습니다. 최근 기록을 새로고침하세요. 기존 버전을 덮어쓰지 않았습니다.":"프로젝트 서비스에 연결하지 못했습니다. --enable-evidence-scout 옵션과 저장 자료를 확인하세요.");}
  const reader=response.body?.getReader();if(!reader)fail();let bytes=0,raw="";const decoder=new TextDecoder("utf-8",{fatal:true});
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>PROJECT_BYTES)fail();raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return strictJson(raw,PROJECT_BYTES,500000);
}
