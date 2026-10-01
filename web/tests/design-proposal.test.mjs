import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {readProposal, consumeProposalStream, requestDesignProposal} from "../src/design-proposal.ts";
import {acknowledgeProposal, proposalAcknowledged, proposalReviewDigest, draftFromBrief, briefFromDraft} from "../src/design-brief.ts";
import {readDesignResult} from "../src/design-result.ts";
import {restoreReview} from "../src/field-review-restore.ts";
import {draftBackup, restoreDesignInput} from "../src/design-draft.ts";

const cwd=fileURLToPath(new URL("../../",import.meta.url));
const fixture=JSON.parse(execFileSync("uv",["run","python","-c",`
import base64,json,sys
sys.path.insert(0,'tests')
from test_design_proposal import propose, acknowledge
from test_design_compare import run
from test_field_revalidation import sample
from trialboard.agent.design_compare import DesignBrief, proposal_review_digest
f=sample(imported=True); p=propose(f); b=acknowledge(p['brief'])
edge=acknowledge(p['brief']);edge['scenarios'][0]['response']=[0.0,1e-7]
edge=acknowledge(edge)
print(json.dumps(dict(proposal=p, approved=b, result=run(f,b), pending=run(f,p['brief']),pdf=base64.b64encode(f['pdf']).decode(),agent=f['agent'].decode(),
source=f['source']['source'], review=f['review'], edge=edge, edge_digest=proposal_review_digest(DesignBrief.model_validate(edge)))))
`],{cwd,encoding:"utf8",maxBuffer:8000000}));
const source=fixture.source, review=restoreReview(JSON.stringify(fixture.review),source);
const constraints={objective:"표본수 비교",max_per_arm:80};
const read=p=>readProposal(JSON.stringify(p),review,source,constraints,"SCRIPTED_TEST_DOUBLE");

test("Python proposal -> browser review -> exact Python accepted input",async()=>{
  const p=await read(fixture.proposal);
  assert.equal(await proposalAcknowledged(p.brief),false);
  const confirmed=await acknowledgeProposal(p.brief);
  assert.deepEqual(confirmed,fixture.approved);
  assert.equal(await proposalAcknowledged(confirmed),true);
  assert.equal(await proposalReviewDigest(fixture.edge),fixture.edge_digest);
  const result=await readDesignResult(JSON.stringify(fixture.result),review,source,confirmed);
  assert.equal(result.simulations.length,4);
  assert.equal((await readDesignResult(JSON.stringify(fixture.pending),review,source)).simulations.length,0);
});
test("origin and acknowledgement survive draft save/restore",async()=>{
  const d=draftFromBrief(fixture.approved), raw=await draftBackup(d,review,source);
  const restored=(await restoreDesignInput(raw,review,source)).draft;
  assert.deepEqual(restored,d);
  assert.equal(await proposalAcknowledged(await briefFromDraft(restored,review,source)),true);
  restored.plans[0].per_arm="31";
  assert.equal(await proposalAcknowledged(await briefFromDraft(restored,review,source)),false);
});
for(const [name,mutate] of Object.entries({
  clinical:r=>r.clinical_approval=true,
  approved:r=>r.user_approved=true,
  stale:r=>r.review_content_digest="0".repeat(64),
  constraints:r=>r.constraints.max_per_arm=90,
  source:r=>r.brief.scenarios[0].provenance.evidence_ids=["invented"],
  impersonation:r=>r.brief.scenarios[0].provenance="user_declared_hypothetical",
  selfApproval:r=>r.brief.scenarios[0].provenance.reviewed_input_digest="0".repeat(64),
  failedWithBrief:r=>r.status="FAILED",
}))test(`reject ${name}`,async()=>{const p=structuredClone(fixture.proposal);mutate(p);await assert.rejects(read(p));});

function stream(text){return new Response(text,{headers:{"content-type":"text/event-stream"}});}
test("real stage events and result are consumed without fake intermediate steps",async()=>{
  const events=[],raw=await consumeProposalStream(stream(': waiting\n\ndata: {"type":"progress","stage":"REVALIDATING_EVIDENCE"}\n\ndata: {"type":"result","result":{"status":"NEEDS_EVIDENCE"}}\n\n'),e=>events.push(e));
  assert.deepEqual(events,["REVALIDATING_EVIDENCE"]);assert.equal(JSON.parse(raw).status,"NEEDS_EVIDENCE");
});
test("disconnected, unknown-stage and error streams fail closed",async()=>{
  for(const text of ['', 'data: {"type":"progress","stage":"APPROVED"}\n\n','data: {"type":"error","code":"FAILED"}\n\n'])await assert.rejects(consumeProposalStream(stream(text),()=>{}));
});
test("no consent or nonlocal origin makes zero requests",async()=>{
  let calls=0;
  for(const [origin,consent] of [["http://127.0.0.1:5173",false],["https://example.com",true]])await assert.rejects(requestDesignProposal({origin,consent,fetcher:()=>{calls++;}}));
  assert.equal(calls,0);
});
test("proposal request carries the exact project policy binding",async()=>{
  const calls=[],binding={project_id:"12345678-1234-4234-8234-123456789012",review_revision:2,pdf_digest:source.sha256,policy_revision:4};
  const fetcher=async(url,options)=>{calls.push({url,options});if(url.includes("capabilities"))return Response.json({enabled:true,configured:true,max_calls:1,persisted:false,transport:"LOOPBACK_ONLY",clinical_approval:false,provider:"CODEX_CHATGPT"});return new Response('data: {"type":"error","code":"STOP"}\n\n',{headers:{"content-type":"text/event-stream"}});};
  const bytes=Uint8Array.from(atob(fixture.pdf),c=>c.charCodeAt(0));
  await assert.rejects(requestDesignProposal({origin:"http://127.0.0.1:5173",consent:true,review,source,pdf:new File([bytes],"synthetic.pdf"),agentRaw:fixture.agent,constraints,signal:new AbortController().signal,onProgress:()=>{},fetcher,modelBinding:binding}));
  assert.equal(calls.length,2);const body=JSON.parse(calls[1].options.body);assert.deepEqual(body.model_binding,binding);assert.equal(body.public_authorized_non_sensitive,true);
});
