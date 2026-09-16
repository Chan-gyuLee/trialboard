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
import {checkpointBody,projectFile,readBundle,validateProject} from "../src/project-checkpoint.ts";

const pdf=new TextEncoder().encode("%PDF-SYNTHETIC-CONTRACT-ONLY");
const source={schemaVersion:"pdf-evidence/1",name:"MOC.pdf",sha256:await digest(new TextDecoder().decode(pdf)),byteLength:pdf.length,extractor:"test",status:"NO_TEXT",coordinateSystem:"normalized_top_left_rotated_viewport",pages:[{number:1,width:100,height:100,rotation:0,status:"NO_TEXT",spans:[]}]};
const review=newReview(source),draft=newDraft();draft.plans[0].per_arm="0.";
const bundle={schema:"trialboard-project/1",source,notes:[],reviewRaw:reviewBackup(review,source),draftRaw:await draftBackup(draft,review,source),meetingRaw:null,agentRaw:null,context:null};
const receipt={project_id:"12345678-1234-1234-1234-123456789012",revision:1,title:"MOC",created_at:"2026-09-16T00:00:00Z",pdf_digest:source.sha256};

test("partial draft and PDF survive project roundtrip without becoming executable",async()=>{
 const body=JSON.parse(await checkpointBody("MOC",new File([pdf],"MOC.pdf"),bundle,null));
 const record={...receipt,bundle_digest:await digest(body.bundle_json),bundle_json:body.bundle_json,pdf_base64:body.pdf_base64};
 const restored=await projectFile(record);assert.equal(await restored.file.text(),new TextDecoder().decode(pdf));
 assert.deepEqual((await validateProject(restored.bundle,source)).draft,draft);
 assert.equal(body.consent,true);assert.equal(body.expected_revision,0);assert.equal(body.project_id,null);
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
