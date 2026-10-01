import test from "node:test";
import assert from "node:assert/strict";
import {readImportPreview,readImportProvenance,readProjectAccess,readProjectAccessUpdate,readReviewAppend,readReviewFeed,readTeamMembers,resetImportSelectionConsent,responseMatches} from "../src/team-collaboration.ts";

const project="12345678-1234-4234-8234-123456789012",subject="22345678-1234-4234-8234-123456789012";
const event={event_revision:1,base_document_revision:2,kind:"note",text:"synthetic note",subject:{id:subject,username:"alice"},role:"reviewer",created_at:"2026-09-30T00:00:00Z",clinical_approval:false};

test("review readers bind responses to project and review revision",()=>{
  assert.deepEqual(readReviewFeed({project_id:project,document_revision:2,events:[event],event_revision:1},project,2).events,[event]);
  assert.equal(readReviewAppend({project_id:project,document_revision:2,...event},project,2).event_revision,1);
  assert.throws(()=>readReviewFeed({project_id:"32345678-1234-4234-8234-123456789012",document_revision:2,events:[event],event_revision:1},project,2));
  assert.throws(()=>readReviewAppend({project_id:project,document_revision:3,...event},project,2));
});

test("review feed keeps a global cursor across checkpoint revisions",()=>{
  const older={...event,base_document_revision:1};
  const newer={...event,event_revision:2,base_document_revision:2,text:"second revision note"};
  assert.deepEqual(readReviewFeed({project_id:project,document_revision:2,events:[older,newer],event_revision:2},project,2).events,[older,newer]);
  assert.deepEqual(readReviewFeed({project_id:project,document_revision:1,events:[older,newer],event_revision:2},project,1).events,[older,newer]);
});

test("review readers reject unbounded or forged event fields",()=>{
  for(const change of [{event_revision:1.5},{kind:"clinical_approval"},{clinical_approval:true},{base_document_revision:0},{base_document_revision:101},{subject:{id:"forged",username:"alice"}},{role:"owner"}])assert.throws(()=>readReviewFeed({project_id:project,document_revision:2,events:[{...event,...change}],event_revision:1},project,2));
  assert.throws(()=>readReviewFeed({project_id:project,document_revision:2,events:[event],event_revision:2},project,2));
  assert.throws(()=>readReviewFeed({project_id:project,document_revision:2,events:[event,{...event,text:"duplicate"}],event_revision:1},project,2));
  assert.throws(()=>readReviewFeed({project_id:project,document_revision:2,events:[event,{...event,event_revision:3,text:"gap"}],event_revision:3},project,2));
});

test("generation and receipt identity jointly discard stale responses",()=>{
  assert.equal(responseMatches(4,4,`${project}:2`,`${project}:2`),true);
  assert.equal(responseMatches(3,4,`${project}:2`,`${project}:2`),false);
  assert.equal(responseMatches(4,4,`${project}:1`,`${project}:2`),false);
});

test("member and ACL readers expose only bounded public contract",()=>{
  assert.equal(readTeamMembers({members:[{id:subject,username:"alice",role:"admin"}]})[0].username,"alice");
  const access=readProjectAccess({project_id:project,sharing_scope:"restricted",acl_revision:1,management_source:"project_owner",members:[{subject_id:subject,username:"alice",access:"owner"}],download_revoke_limitation:true},project);
  assert.equal(access.members[0].access,"owner");
  assert.throws(()=>readTeamMembers({members:[{id:subject,username:"alice",role:"admin",password_hash:"secret"}]}));
  assert.throws(()=>readProjectAccess({...access,project_id:"32345678-1234-4234-8234-123456789012"},project));
  assert.equal(readProjectAccessUpdate({project_id:project,sharing_scope:"restricted",acl_revision:2,access_revoked:true},project).access_revoked,true);
  assert.throws(()=>readProjectAccessUpdate({project_id:project,sharing_scope:"restricted",acl_revision:2,access_revoked:true,members:[]},project));
});

test("import preview reader rejects hidden identities and malformed conflicts",()=>{
  const preview={valid:true,writes_performed:false,title:"Synthetic",original_filename:"sample.pdf",pdf_digest:"a".repeat(64),bundle_digest:"b".repeat(64),bytes:120,destination:"current_team_new_project",sharing_scope:"restricted",duplicate:null,duplicate_conflict:true,legacy_authorship_imported:false,clinical_approval:false,import_preview_digest:"d".repeat(64)};
  assert.equal(readImportPreview(preview).duplicate_conflict,true);
  assert.throws(()=>readImportPreview({...preview,project_id:project}));
  assert.throws(()=>readImportPreview({...preview,duplicate:{project_id:"hidden",revision:1}}));
});

test("detached import preview and provenance readers are strict and project-bound",()=>{
  const context={asset:"legacy asset",indication:"legacy indication",study:"NCT00000000",question:"legacy question",receiptId:"foreign-receipt",document:{runId:"foreign-run",sourceId:"foreign-source",title:"Legacy source"}};
  const preview={valid:true,writes_performed:false,title:"Synthetic",original_filename:"sample.pdf",pdf_digest:"a".repeat(64),bundle_digest:"b".repeat(64),bytes:120,destination:"current_team_new_project",sharing_scope:"restricted",duplicate:null,duplicate_conflict:false,legacy_authorship_imported:false,clinical_approval:false,import_preview_digest:"d".repeat(64),context_detached:true,original_bundle_digest:"b".repeat(64),working_bundle_digest:"c".repeat(64),original_context:context,transformation_version:"legacy-context-detach/1",provenance_status:"UNVERIFIED",current_team_links_verified:false,model_run_performed:false};
  assert.equal(readImportPreview(preview).working_bundle_digest,"c".repeat(64));
  assert.throws(()=>readImportPreview({...preview,current_team_links_verified:true}));
  assert.throws(()=>readImportPreview({...preview,original_context:{...context,authorization:"forged"}}));
  const history={review:"imported_non_authenticated_history",agent:"imported_non_authenticated_history",design:"imported_non_authenticated_history",meeting:"imported_non_authenticated_history"};
  const provenance={schema:"trialboard-import-provenance/1",kind:"legacy_context_detached",original_pdf_digest:"a".repeat(64),original_bundle_digest:"b".repeat(64),working_bundle_digest:"c".repeat(64),original_context:context,imported_by:{subject_id:subject,username:"alice"},imported_at:"2026-09-30T00:00:00Z",transformation_version:"legacy-context-detach/1",detachment_statement:"past_research_links_detached_and_original_history_preserved",history_authentication:"imported_non_authenticated_history",verification_status:"UNVERIFIED",current_team_links_verified:false,model_run_performed:false,nested_history:history};
  assert.equal(readImportProvenance({project_id:project,revision:1,provenance},project,1)?.original_context.receiptId,"foreign-receipt");
  assert.equal(readImportProvenance({project_id:project,revision:1,provenance:null},project,1),null);
  assert.throws(()=>readImportProvenance({project_id:"32345678-1234-4234-8234-123456789012",revision:1,provenance},project,1));
  assert.throws(()=>readImportProvenance({project_id:project,revision:1,provenance:{...provenance,approval:true}},project,1));
});

test("file replacement resets both independent import consents and stale preview",()=>{
  assert.deepEqual(resetImportSelectionConsent(),{publicAttested:false,contextDetachAcknowledged:false,preview:null});
});
