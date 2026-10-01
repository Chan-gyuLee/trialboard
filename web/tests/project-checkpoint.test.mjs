import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {newReview,digest} from "../src/field-review.ts";
import {reviewBackup} from "../src/field-review-restore.ts";
import {newDraft,draftFromBrief} from "../src/design-brief.ts";
import {draftBackup} from "../src/design-draft.ts";
import {readDesignResult} from "../src/design-result.ts";
import {restoreReview} from "../src/field-review-restore.ts";
import {newMeeting,recordNote,packetJson} from "../src/meeting-packet.ts";
import {checkpointBody,importCheckpointBody,projectFile,projectModelBinding,readBundle,readProjectReceipt,readUsagePolicyHistory,sourceVersionBody,validateProject} from "../src/project-checkpoint.ts";

const pdf=new TextEncoder().encode("%PDF-SYNTHETIC-CONTRACT-ONLY");
const source={schemaVersion:"pdf-evidence/1",name:"MOC.pdf",sha256:await digest(new TextDecoder().decode(pdf)),byteLength:pdf.length,extractor:"test",status:"NO_TEXT",coordinateSystem:"normalized_top_left_rotated_viewport",pages:[{number:1,width:100,height:100,rotation:0,status:"NO_TEXT",spans:[]}]};
const review=newReview(source),draft=newDraft();draft.plans[0].per_arm="0.";
const bundle={schema:"trialboard-project/1",source,notes:[],reviewRaw:reviewBackup(review,source),draftRaw:await draftBackup(draft,review,source),meetingRaw:null,agentRaw:null,context:null};
const receipt={project_id:"12345678-1234-1234-1234-123456789012",revision:1,title:"MOC",created_at:"2026-09-16T00:00:00Z",pdf_digest:source.sha256};
const usage={original_storage:"ALLOW",internal_search:"UNKNOWN",external_ai:"UNKNOWN",training:"UNKNOWN",evidence_reference:"synthetic-test",reason:"Synthetic local storage fixture."};
const policyAuthor={subject_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",username:"synthetic-admin",role:"admin"};
const policy=(project_id=receipt.project_id,pdf_digest=source.sha256,policy_revision=1)=>({project_id,pdf_digest,policy_revision,original_storage:"ALLOW",internal_search:"UNKNOWN",external_ai:"DENY",training:"UNKNOWN",evidence_reference:"synthetic-test",reason:"Synthetic policy fixture.",author:policyAuthor,asserted_at:"2026-09-30T00:00:00+00:00",verification_status:"USER_ATTESTED_UNVERIFIED",training_capability:"CAPABILITY_ABSENT"});

test("partial draft and PDF survive project roundtrip without becoming executable",async()=>{
 const body=JSON.parse(await checkpointBody("MOC",new File([pdf],"MOC.pdf"),bundle,null));
 const record={...receipt,bundle_digest:await digest(body.bundle_json),bundle_json:body.bundle_json,pdf_base64:body.pdf_base64};
 const restored=await projectFile(record);assert.equal(await restored.file.text(),new TextDecoder().decode(pdf));
 assert.deepEqual((await validateProject(restored.bundle,source)).draft,draft);
 assert.equal(body.consent,true);assert.equal(body.expected_revision,0);assert.equal(body.project_id,null);
 assert.equal(body.public_authorized_non_sensitive,undefined);
 const teamBody=JSON.parse(await checkpointBody("MOC",new File([pdf],"MOC.pdf"),bundle,null,true));
 assert.equal(teamBody.public_authorized_non_sensitive,true);
 const sourceReceipt={...receipt,bundle_digest:"b".repeat(64),sharing_scope:"restricted"};
 const forkBody=JSON.parse(await checkpointBody("Fork",new File([pdf],"MOC.pdf"),bundle,null,true,"restricted",[],sourceReceipt));
 assert.equal(forkBody.source_project_id,receipt.project_id);assert.equal(forkBody.source_project_revision,1);assert.equal(forkBody.sharing_scope,"restricted");
 assert.equal((await validateProject(restored.bundle,source)).session,null);
});
for(const [name,change] of Object.entries({
 schema:p=>p.schema="approved",extra:p=>p.clinicalApproval=true,notes:p=>p.notes=[{}],context:p=>p.context={apiKey:"not-a-key"},wrongReview:p=>p.reviewRaw=p.reviewRaw.replace(source.sha256,"b".repeat(64)),wrongDraft:p=>p.draftRaw=p.draftRaw.replace(source.sha256,"b".repeat(64)),wrongAgent:p=>p.agentRaw="{}",wrongMeeting:p=>p.meetingRaw="{}",
}))test(`reject invalid checkpoint: ${name}`,async()=>{const p=structuredClone(bundle);change(p);await assert.rejects(async()=>validateProject(readBundle(JSON.stringify(p)),source));});
test("different extraction or PDF rejects restore, not silently replacing citations",async()=>{
 await assert.rejects(validateProject(bundle,{...source,extractor:"changed"}));
 await assert.rejects(validateProject(bundle,{...source,sha256:"b".repeat(64)}));
 const raw=JSON.stringify(bundle),record={...receipt,bundle_json:raw,bundle_digest:await digest(raw),pdf_base64:btoa("%PDF-WRONG")};
 await assert.rejects(projectFile(record));await assert.rejects(projectFile({...record,bundle_digest:"a".repeat(64)}));
});
test("duplicate JSON keys are rejected",()=>assert.throws(()=>readBundle('{"schema":"a","schema":"b"}')));

test("usage-policy readers bind receipt, target, digest, and contiguous immutable history",()=>{
 const entry1=policy(),entry2={...policy(receipt.project_id,source.sha256,2),original_storage:"DENY",asserted_at:"2026-09-30T01:00:00+00:00"};
 const response={current:{...entry2,can_manage:true},history:[entry2,entry1]};
 assert.equal(readUsagePolicyHistory(response,{project_id:receipt.project_id,pdf_digest:source.sha256}).current.policy_revision,2);
 assert.equal(readProjectReceipt({...receipt,bundle_digest:"b".repeat(64),usage_policy:{...entry2,can_manage:true}}).usage_policy.policy_revision,2);
 assert.throws(()=>readProjectReceipt({...receipt,bundle_digest:"b".repeat(64),usage_policy:{...entry2,project_id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",can_manage:true}}));
 assert.throws(()=>readProjectReceipt({...receipt,bundle_digest:"b".repeat(64),usage_policy:{...entry2,pdf_digest:"b".repeat(64),can_manage:true}}));
 assert.throws(()=>readUsagePolicyHistory(response,{project_id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",pdf_digest:source.sha256}));
 assert.throws(()=>readUsagePolicyHistory(response,{project_id:receipt.project_id,pdf_digest:"b".repeat(64)}));
 assert.throws(()=>readUsagePolicyHistory({...response,history:[entry1,entry2]},{project_id:receipt.project_id,pdf_digest:source.sha256}));
 assert.throws(()=>readUsagePolicyHistory({...response,history:[entry2,entry2]},{project_id:receipt.project_id,pdf_digest:source.sha256}));
 assert.throws(()=>readUsagePolicyHistory({...response,current:{...response.current,reason:"different head"}},{project_id:receipt.project_id,pdf_digest:source.sha256}));
});

test("model binding requires the exact receipt digest and an ALLOW policy revision",()=>{
 const allowed={...policy(),external_ai:"ALLOW",can_manage:true};
 assert.deepEqual(projectModelBinding({...receipt,bundle_digest:"b".repeat(64),usage_policy:allowed}),{project_id:receipt.project_id,review_revision:1,pdf_digest:source.sha256,policy_revision:1});
 assert.equal(projectModelBinding({...receipt,bundle_digest:"b".repeat(64),sharing_scope:"restricted",usage_policy:allowed}),null);
 assert.equal(projectModelBinding({...receipt,bundle_digest:"b".repeat(64),usage_policy:{...allowed,external_ai:"DENY"}}),null);
 assert.equal(projectModelBinding({...receipt,bundle_digest:"b".repeat(64),usage_policy:{...allowed,pdf_digest:"b".repeat(64)}}),null);
 assert.equal(projectModelBinding(null),null);
});

test("usage-policy readers reject fake claims and only accept empty UNKNOWN revision zero",()=>{
 const unknown={project_id:receipt.project_id,pdf_digest:source.sha256,policy_revision:0,original_storage:"UNKNOWN",internal_search:"UNKNOWN",external_ai:"UNKNOWN",training:"UNKNOWN",evidence_reference:null,reason:"No asserted project usage policy is recorded.",author:null,asserted_at:null,verification_status:"USER_ATTESTED_UNVERIFIED",training_capability:"CAPABILITY_ABSENT"};
 assert.equal(readUsagePolicyHistory({current:{...unknown,can_manage:true},history:[]},{project_id:receipt.project_id,pdf_digest:source.sha256}).history.length,0);
 for(const current of [
  {...unknown,can_manage:true,original_storage:"ALLOW"},
  {...unknown,can_manage:true,evidence_reference:"fabricated"},
  {...unknown,can_manage:true,author:policyAuthor},
  {...unknown,can_manage:true,reason:"fabricated"},
 ])assert.throws(()=>readUsagePolicyHistory({current,history:[]},{project_id:receipt.project_id,pdf_digest:source.sha256}));
 for(const changed of [
  {...policy(),author:{...policyAuthor,role:"owner"}},
  {...policy(),author:{...policyAuthor,role:"viewer"}},
  {...policy(),author:{...policyAuthor,subject_id:"not-an-id"}},
  {...policy(),evidence_reference:""},
  {...policy(),asserted_at:"not-a-time"},
  {...policy(),invented:true},
 ])assert.throws(()=>readUsagePolicyHistory({current:{...changed,can_manage:true},history:[changed]},{project_id:receipt.project_id,pdf_digest:source.sha256}));
 assert.doesNotThrow(()=>readProjectReceipt({...receipt,bundle_digest:"b".repeat(64)}));
});

test("legacy import body preserves exact selected bundle bytes and explicit detach fields",async()=>{
 const contextual={...bundle,context:{asset:"a",indication:"i",study:"NCT00000000",question:"q",receiptId:"foreign"}};
 const raw=`${JSON.stringify(contextual,null,2)}\n`;
 const request=JSON.parse(await importCheckpointBody("Imported",new File([pdf],"MOC.pdf"),raw,"restricted",[],usage,true,"a".repeat(64)));
 assert.equal(request.bundle_json,raw);assert.equal(request.context_detachment_acknowledged,true);assert.equal(request.import_preview_digest,"a".repeat(64));assert.equal(request.public_authorized_non_sensitive,true);
});

test("source version request and receipt are strictly bound to the selected head",async()=>{
 const parent={...receipt,bundle_digest:"b".repeat(64),sharing_scope:"restricted",source_version:{version_id:null,is_series_head:true,series_head_revision:0,predecessor_project_id:null,predecessor_review_revision:null},can_create_source_version:true};
 const body=JSON.parse(await sourceVersionBody("New source",new File([pdf],"MOC.pdf"),bundle,parent,usage));
 assert.equal(body.predecessor_project_id,parent.project_id);assert.equal(body.predecessor_review_revision,1);assert.equal(body.expected_series_head_revision,0);assert.equal(body.confirmation,true);
 assert.equal(body.sharing_scope,undefined);assert.equal(body.access_members,undefined);
 assert.deepEqual(body.usage_policy,usage);
 assert.equal(readProjectReceipt(parent).source_version.is_series_head,true);
 assert.throws(()=>readProjectReceipt({...parent,hidden_count:2}));
 assert.throws(()=>readProjectReceipt({...parent,source_version:{...parent.source_version,predecessor_project_id:parent.project_id}}));
 assert.throws(()=>readProjectReceipt({...parent,source_version:{...parent.source_version,version_id:"wrong"}}));
});

test("whole design comparison and KOL note revisions restore together",async()=>{
 const root=fileURLToPath(new URL("../../",import.meta.url));
 const f=JSON.parse(execFileSync("uv",["run","python","-c",`import json,sys
sys.path.insert(0,'tests')
from test_design_compare import run
from test_field_revalidation import sample
f=sample()
print(json.dumps({'source':f['source']['source'],'report':run(f)}))`],{cwd:root,encoding:"utf8",timeout:30000,maxBuffer:2_000_000}));
 const review=restoreReview(JSON.stringify(f.report.revalidation.review),f.source);
 const result=await readDesignResult(JSON.stringify(f.report),review,f.source);
 const notes=recordNote(newMeeting(result),result,"statistics",{status:"FOLLOW_UP",answer:"MOC answer",owner:"MOC owner",nextAction:"Check population",reason:"MOC only"},"2026-09-16T00:00:00.000Z");
 const p={...bundle,source:f.source,reviewRaw:reviewBackup(review,f.source),draftRaw:await draftBackup(draftFromBrief(result.brief),review,f.source),meetingRaw:packetJson(result,notes)};
 const restored=await validateProject(readBundle(JSON.stringify(p)),f.source);
 assert.deepEqual(restored.session.notes,notes);assert.equal(restored.session.result.reportKey,result.reportKey);
 const changed=draftFromBrief(result.brief);changed.plans[0].label="changed after calculation";
 await assert.rejects(validateProject({...p,draftRaw:await draftBackup(changed,review,f.source)},f.source));
});
