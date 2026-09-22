import test from 'node:test';
import assert from 'node:assert/strict';
import {handoffFixture} from './research-handoff-fixture.mjs';
import {handoffAvailability,loadResearchHandoff} from '../src/research-handoff.ts';
import {reviewProgress} from '../src/review-progress.ts';
import {reviewBackup} from '../src/field-review-restore.ts';
import {draftBackup} from '../src/design-draft.ts';
import {validateProject,readBundle} from '../src/project-checkpoint.ts';
const signal=()=>new AbortController().signal;
async function setup(){
 const f=await handoffFixture();const calls=[];let destroyed=0;
 const request=async(path,options)=>{calls.push({path,options});return path.endsWith('/automation')?Response.json(f.done.automation):new Response(f.bytes,{headers:{'Content-Type':'application/pdf','X-Source-Sha256':f.source.sha256}});};
 const loader=async()=>({source:f.source,pdf:{},destroy:async()=>{destroyed++;}});
 return {...f,calls,request,loader,destroyed:()=>destroyed};
}
test('saved handoff reads only exact cache, keeps every field unreviewed and blank probabilities',async()=>{
 const f=await setup(),before=JSON.stringify(f.done),progress=[];
 const out=await loadResearchHandoff(f.done,signal(),p=>progress.push(p),f.request,f.loader);
 assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>!c.options.method));assert.ok(f.calls[1].path.endsWith('/cached?sha256='+f.source.sha256));
 assert.equal(out.project.review.rows.length,4);assert.ok(out.project.review.rows.every(r=>Object.values(r.fields).every(c=>c.decision==='unreviewed'&&!c.history.length)));
 assert.equal(out.project.draft.question,f.done.automation.report.input.question);assert.equal(out.project.draft.arms.length,0);
 assert.ok(out.project.draft.plans.every(p=>p.per_arm===''));assert.equal(out.context.document.sourceId,'doc_1');
 assert.equal(JSON.stringify(f.done),before);assert.ok(progress.length>=3);assert.equal(f.destroyed(),0);
});
for(const [name,mutate] of [
 ['no automation',d=>d.automation=null],['missing observations',d=>d.automation.report.attempts.at(-1).extraction.observations=[]],
 ['over 200 pages',d=>d.automation.document.coverage.totalPages=201],['unfinished',d=>d.automation.status='RUNNING'],
 ['plan only',d=>d.automation.status='PLAN_DOCUMENT_SAVED'],['no PDF link',d=>d.result.collection.sources[0].pdf_url=null],
 ['unknown page count',d=>delete d.automation.document.coverage.totalPages],
])test(`unavailable ${name} cannot fetch or invent a handoff`,async()=>{
 const f=await setup();mutate(f.done);assert.equal(handoffAvailability(f.done).ready,false);
 await assert.rejects(loadResearchHandoff(f.done,signal(),()=>{},f.request,f.loader));assert.equal(f.calls.length,0);
});
test('changed saved report is rejected before PDF read',async()=>{
 const f=await setup(),saved=structuredClone(f.done.automation);saved.report.run_id='other';
 await assert.rejects(loadResearchHandoff(f.done,signal(),()=>{},async()=>Response.json(saved),f.loader),/바뀌었습니다/);
});
for(const name of ['missing cache','wrong bytes','wrong header','oversize'])test(`fails closed: ${name}`,async()=>{
 const f=await setup();let parsed=false;
 const req=async(path,o)=>path.endsWith('/automation')?f.request(path,o):name==='missing cache'?new Response('',{status:404}):new Response(name==='oversize'?new Uint8Array(5_000_001):name==='wrong bytes'?'%PDF-wrong':f.bytes,{headers:{'Content-Type':'application/pdf','X-Source-Sha256':name==='wrong header'?'0'.repeat(64):f.source.sha256}});
 await assert.rejects(loadResearchHandoff(f.done,signal(),()=>{},req,async()=>{parsed=true;return f.loader();}));assert.equal(parsed,false);
});
test('mismatched parsed text releases PDF instead of replacing existing review',async()=>{
 const f=await setup();f.source.pages[0].spans[0].text='wrong text';
 await assert.rejects(loadResearchHandoff(f.done,signal(),()=>{},f.request,f.loader));assert.equal(f.destroyed(),1);
});
test('abort before read and during parsing never yields a review',async()=>{
 const f=await setup(),c=new AbortController();c.abort();await assert.rejects(loadResearchHandoff(f.done,c.signal,()=>{},f.request,f.loader));assert.equal(f.calls.length,0);
 const d=new AbortController();await assert.rejects(loadResearchHandoff(f.done,d.signal,()=>{},f.request,async()=>{const pdf=await f.loader();d.abort();return pdf;}));assert.equal(f.destroyed(),1);
});
test('review queue counts recorded values without treating missing fields as approved',async()=>{
 const f=await setup(),out=await loadResearchHandoff(f.done,signal(),()=>{},f.request,f.loader),r=out.project.review;
 const initial=reviewProgress(r,f.source);assert.equal(initial.checked,0);assert.ok(initial.waiting>0);assert.equal(initial.next.field,'dose');assert.ok(initial.missing>0);
 const row=r.rows.find(r=>r.id===initial.next.rowId);row.fields.dose.decision='confirmed';
 const next=reviewProgress(r,f.source);assert.equal(next.checked,1);assert.equal(next.waiting,initial.waiting-1);assert.notEqual(next.next.rowId,initial.next.rowId);
 row.fields.denominator.decision='held';row.fields.events.current.citation=null;
 assert.equal(reviewProgress(r,f.source).held,1);assert.equal(reviewProgress(r,f.source).noCitation,1);
 assert.throws(()=>reviewProgress(r,{...f.source,sha256:'other'}));
});
test('handoff review, original extraction and research context survive project checkpoint validation',async()=>{
 const f=await setup(),out=await loadResearchHandoff(f.done,signal(),()=>{},f.request,f.loader);
 const bundle={schema:'trialboard-project/1',source:f.source,notes:[],context:out.context,reviewRaw:reviewBackup(out.project.review,f.source),agentRaw:out.project.agentRaw,
  draftRaw:await draftBackup(out.project.draft,out.project.review,f.source),meetingRaw:null};
 const restored=await validateProject(readBundle(JSON.stringify(bundle)),f.source);
 assert.equal(restored.agentRaw,out.project.agentRaw);
 const {exportMetadata,...restoredContent}=restored.review;
 assert.deepEqual(restoredContent,out.project.review);assert.equal(exportMetadata.sourceName,f.source.name);
 assert.equal(restored.draft.question,out.project.draft.question);assert.equal(restored.session,null);
});
