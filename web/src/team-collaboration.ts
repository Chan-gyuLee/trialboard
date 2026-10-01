import {exact,obj} from "./design-brief.ts";

export type EventKind="note"|"review_approval";
export type ReviewEvent={event_revision:number;base_document_revision:number;kind:EventKind;text:string;subject:{id:string;username:string};role:"admin"|"reviewer"|"viewer";created_at:string;clinical_approval:false};
export type TeamMember={id:string;username:string;role:"admin"|"reviewer"|"viewer"};
export type AccessMember={subject_id:string;username:string;access:"owner"|"write"|"read"};
export type ProjectAccess={project_id:string;sharing_scope:"team_wide"|"restricted";acl_revision:number;management_source:"project_owner"|"team_admin_override";members:AccessMember[];download_revoke_limitation:true};
export type ProjectAccessAck={project_id:string;sharing_scope:"team_wide"|"restricted";acl_revision:number;access_revoked:boolean};
type LegacyContext={asset:string;indication:string;study:string;question:string;receiptId:string;document?:{runId:string;sourceId:string;title:string}};
type DetachedPreview={context_detached:true;original_bundle_digest:string;working_bundle_digest:string;original_context:LegacyContext;transformation_version:"legacy-context-detach/1";provenance_status:"UNVERIFIED";current_team_links_verified:false;model_run_performed:false};
export type ImportPreview={valid:true;writes_performed:false;title:string;original_filename:string;pdf_digest:string;bundle_digest:string;bytes:number;destination:"current_team_new_project";sharing_scope:"team_wide"|"restricted";duplicate:null|{project_id:string;revision:number};duplicate_conflict:boolean;legacy_authorship_imported:false;clinical_approval:false;import_preview_digest:string}&Partial<DetachedPreview>;
export type ImportProvenance={schema:"trialboard-import-provenance/1";kind:"legacy_context_detached";original_pdf_digest:string;original_bundle_digest:string;working_bundle_digest:string;original_context:LegacyContext;imported_by:{subject_id:string;username:string};imported_at:string;transformation_version:"legacy-context-detach/1";detachment_statement:"past_research_links_detached_and_original_history_preserved";history_authentication:"imported_non_authenticated_history";verification_status:"UNVERIFIED";current_team_links_verified:false;model_run_performed:false;nested_history:{review:"imported_non_authenticated_history";agent:"imported_non_authenticated_history";design:"imported_non_authenticated_history";meeting:"imported_non_authenticated_history"}};

const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
function fail(message:string):never{throw Error(message);}
function integer(value:unknown,min:number,max:number){return Number.isInteger(value)&&Number(value)>=min&&Number(value)<=max;}
function role(value:unknown):value is TeamMember["role"]{return value==="admin"||value==="reviewer"||value==="viewer";}
export function responseMatches(requestGeneration:number,currentGeneration:number,requestKey:string,currentKey:string){return requestGeneration===currentGeneration&&requestKey===currentKey;}
export function resetImportSelectionConsent(){return {publicAttested:false,contextDetachAcknowledged:false,preview:null};}

function readLegacyContext(value:unknown):LegacyContext{
  const context=obj(value);exact(context,["asset","indication","study","question","receiptId",...(context.document===undefined?[]:["document"])]);
  for(const key of ["asset","indication","study","question","receiptId"])if(typeof context[key]!=="string"||!context[key]||context[key].length>2000)fail("과거 조사 context 응답 형식 오류");
  if(context.document!==undefined){const document=obj(context.document);exact(document,["runId","sourceId","title"]);for(const value of Object.values(document))if(typeof value!=="string"||!value||value.length>2000)fail("과거 조사 context 응답 형식 오류");}
  return context as unknown as LegacyContext;
}

export function readTeamMembers(value:unknown):TeamMember[]{
  const packet=obj(value);exact(packet,["members"]);if(!Array.isArray(packet.members)||packet.members.length>1000)fail("팀 구성원 응답 형식 오류");
  const seen=new Set<string>();return packet.members.map(value=>{const member=obj(value);exact(member,["id","username","role"]);if(typeof member.id!=="string"||!uuid.test(member.id)||seen.has(member.id)||typeof member.username!=="string"||!member.username||member.username.length>120||!role(member.role))fail("팀 구성원 응답 형식 오류");seen.add(member.id);return member as TeamMember;});
}

function readEvent(value:unknown,expectedBaseRevision?:number):ReviewEvent{
  const event=obj(value);exact(event,["event_revision","base_document_revision","kind","text","subject","role","created_at","clinical_approval"]);
  const subject=obj(event.subject);exact(subject,["id","username"]);
  if(!integer(event.event_revision,1,10000)||!integer(event.base_document_revision,1,100)||(expectedBaseRevision!==undefined&&event.base_document_revision!==expectedBaseRevision)||(event.kind!=="note"&&event.kind!=="review_approval")||typeof event.text!=="string"||!event.text.trim()||event.text.length>4000||typeof subject.id!=="string"||!uuid.test(subject.id)||typeof subject.username!=="string"||!subject.username||subject.username.length>120||!role(event.role)||typeof event.created_at!=="string"||!Number.isFinite(Date.parse(event.created_at))||event.clinical_approval!==false)fail("검토 이력 응답 형식 오류");
  return event as unknown as ReviewEvent;
}

export function readReviewFeed(value:unknown,projectId:string,documentRevision:number){
  const packet=obj(value);exact(packet,["project_id","document_revision","events","event_revision"]);
  if(packet.project_id!==projectId||packet.document_revision!==documentRevision||!integer(packet.event_revision,0,10000)||!Array.isArray(packet.events)||packet.events.length>10000)fail("다른 프로젝트의 검토 응답을 폐기했습니다.");
  // The feed is the append-only project timeline. Each event keeps the actual
  // checkpoint revision it was written against; the packet remains bound to the
  // checkpoint currently being viewed and the cursor stays project-global.
  const events=packet.events.map(value=>readEvent(value));
  if(events.some((event,index)=>event.event_revision!==index+1)||(events.at(-1)?.event_revision??0)!==packet.event_revision)fail("검토 이력 응답 형식 오류");
  return {events,event_revision:Number(packet.event_revision)};
}

export function readReviewAppend(value:unknown,projectId:string,documentRevision:number){
  const packet=obj(value);exact(packet,["project_id","document_revision","event_revision","base_document_revision","kind","text","subject","role","created_at","clinical_approval"]);
  if(packet.project_id!==projectId||packet.document_revision!==documentRevision)fail("다른 프로젝트의 검토 응답을 폐기했습니다.");
  const {project_id:_,document_revision:__,...event}=packet;void _;void __;
  return readEvent(event,documentRevision);
}

export function readProjectAccess(value:unknown,projectId:string):ProjectAccess{
  const packet=obj(value);exact(packet,["project_id","sharing_scope","acl_revision","management_source","members","download_revoke_limitation"]);
  if(packet.project_id!==projectId||(packet.sharing_scope!=="team_wide"&&packet.sharing_scope!=="restricted")||!integer(packet.acl_revision,0,10000)||(packet.management_source!=="project_owner"&&packet.management_source!=="team_admin_override")||packet.download_revoke_limitation!==true||!Array.isArray(packet.members)||packet.members.length>100)fail("프로젝트 접근 응답 형식 오류");
  const members=packet.members.map(value=>{const member=obj(value);exact(member,["subject_id","username","access"]);if(typeof member.subject_id!=="string"||!uuid.test(member.subject_id)||typeof member.username!=="string"||!member.username||member.username.length>120||(member.access!=="owner"&&member.access!=="write"&&member.access!=="read"))fail("프로젝트 접근 응답 형식 오류");return member as AccessMember;});
  return {...packet,members} as unknown as ProjectAccess;
}

export function readProjectAccessUpdate(value:unknown,projectId:string):ProjectAccess|ProjectAccessAck{
  const packet=obj(value);
  if(typeof packet.access_revoked==="boolean"){exact(packet,["project_id","sharing_scope","acl_revision","access_revoked"]);if(packet.project_id!==projectId||(packet.sharing_scope!=="team_wide"&&packet.sharing_scope!=="restricted")||!integer(packet.acl_revision,1,10000))fail("프로젝트 접근 응답 형식 오류");return packet as unknown as ProjectAccessAck;}
  return readProjectAccess(value,projectId);
}

export function readImportPreview(value:unknown):ImportPreview{
  const packet=obj(value);const detached=packet.context_detached===true;exact(packet,["valid","writes_performed","title","original_filename","pdf_digest","bundle_digest","bytes","destination","sharing_scope","duplicate","duplicate_conflict","legacy_authorship_imported","clinical_approval","import_preview_digest",...(detached?["context_detached","original_bundle_digest","working_bundle_digest","original_context","transformation_version","provenance_status","current_team_links_verified","model_run_performed"]:[])]);
  const duplicate=packet.duplicate===null?null:obj(packet.duplicate);if(duplicate)exact(duplicate,["project_id","revision"]);
  if(packet.valid!==true||packet.writes_performed!==false||typeof packet.title!=="string"||!packet.title.trim()||typeof packet.original_filename!=="string"||!packet.original_filename||typeof packet.pdf_digest!=="string"||!/^[a-f\d]{64}$/.test(packet.pdf_digest)||typeof packet.bundle_digest!=="string"||!/^[a-f\d]{64}$/.test(packet.bundle_digest)||typeof packet.import_preview_digest!=="string"||!/^[a-f\d]{64}$/.test(packet.import_preview_digest)||!integer(packet.bytes,1,5*1024*1024)||packet.destination!=="current_team_new_project"||(packet.sharing_scope!=="team_wide"&&packet.sharing_scope!=="restricted")||(duplicate!==null&&(typeof duplicate.project_id!=="string"||!uuid.test(duplicate.project_id)||!integer(duplicate.revision,1,100)))||typeof packet.duplicate_conflict!=="boolean"||packet.legacy_authorship_imported!==false||packet.clinical_approval!==false)fail("가져오기 검사 응답 형식 오류");
  if(detached){readLegacyContext(packet.original_context);if(typeof packet.original_bundle_digest!=="string"||!/^[a-f\d]{64}$/.test(packet.original_bundle_digest)||typeof packet.working_bundle_digest!=="string"||!/^[a-f\d]{64}$/.test(packet.working_bundle_digest)||packet.bundle_digest!==packet.original_bundle_digest||typeof packet.import_preview_digest!=="string"||!/^[a-f\d]{64}$/.test(packet.import_preview_digest)||packet.transformation_version!=="legacy-context-detach/1"||packet.provenance_status!=="UNVERIFIED"||packet.current_team_links_verified!==false||packet.model_run_performed!==false)fail("가져오기 검사 응답 형식 오류");}
  return {...packet,duplicate} as unknown as ImportPreview;
}

export function readImportProvenance(value:unknown,projectId:string,revision:number):ImportProvenance|null{
  const packet=obj(value);exact(packet,["project_id","revision","provenance"]);if(packet.project_id!==projectId||packet.revision!==revision)fail("다른 프로젝트의 원본 이력 응답을 폐기했습니다.");
  if(packet.provenance===null)return null;const provenance=obj(packet.provenance);exact(provenance,["schema","kind","original_pdf_digest","original_bundle_digest","working_bundle_digest","original_context","imported_by","imported_at","transformation_version","detachment_statement","history_authentication","verification_status","current_team_links_verified","model_run_performed","nested_history"]);
  const importer=obj(provenance.imported_by);exact(importer,["subject_id","username"]);const history=obj(provenance.nested_history);exact(history,["review","agent","design","meeting"]);
  if(provenance.schema!=="trialboard-import-provenance/1"||provenance.kind!=="legacy_context_detached"||typeof provenance.original_pdf_digest!=="string"||!/^[a-f\d]{64}$/.test(provenance.original_pdf_digest)||typeof provenance.original_bundle_digest!=="string"||!/^[a-f\d]{64}$/.test(provenance.original_bundle_digest)||typeof provenance.working_bundle_digest!=="string"||!/^[a-f\d]{64}$/.test(provenance.working_bundle_digest)||typeof importer.subject_id!=="string"||!uuid.test(importer.subject_id)||typeof importer.username!=="string"||!importer.username||importer.username.length>120||typeof provenance.imported_at!=="string"||!Number.isFinite(Date.parse(provenance.imported_at))||provenance.transformation_version!=="legacy-context-detach/1"||provenance.detachment_statement!=="past_research_links_detached_and_original_history_preserved"||provenance.history_authentication!=="imported_non_authenticated_history"||provenance.verification_status!=="UNVERIFIED"||provenance.current_team_links_verified!==false||provenance.model_run_performed!==false||Object.values(history).some(value=>value!=="imported_non_authenticated_history"))fail("원본 이력 응답 형식 오류");
  readLegacyContext(provenance.original_context);return provenance as unknown as ImportProvenance;
}
