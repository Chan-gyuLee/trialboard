import test from 'node:test';
import assert from 'node:assert/strict';
import {openPdfSession} from '../src/pdf-session.ts';
import {validatePageSelection,reviewPageSelection,pdfPage,evidenceExport,evidenceMarkdown} from '../src/pdf-contract.ts';
import {selectedHandoffFixture} from './research-handoff-fixture.mjs';
import {handoffAvailability,loadResearchHandoff} from '../src/research-handoff.ts';
import {locate} from '../src/field-review.ts';
import {reviewBackup,restoreReview} from '../src/field-review-restore.ts';
import {draftBackup} from '../src/design-draft.ts';
import {validateProject,readBundle} from '../src/project-checkpoint.ts';
import {pdfAgentInput} from '../src/pdf-agent.ts';
const signal=()=>new AbortController().signal;
function parser(numPages=80){
 let destroyed=0;const read=[],task={destroy:async()=>{destroyed++;}};
 task.promise=Promise.resolve({numPages,loadingTask:task,getPage:async n=>{read.push(n);return {getViewport:()=>({width:100,height:100,rotation:0,transform:[1,0,0,-1,0,100]}),getTextContent:async()=>({items:[],styles:{}}),cleanup(){}};}});
 return {read,create:()=>task,destroyed:()=>destroyed};
}
test('selected loader reads only 48 and 73 of 80 without renumbering or fabricated gap pages',async()=>{
 const p=parser(),progress=[];
 const loaded=await openPdfSession(new File(['%PDF-test'],'MOC.pdf'),signal(),n=>progress.push(n),p.create,'test',1000,{totalPages:80,pageNumbers:[48,73]});
 assert.deepEqual(p.read,[48,73]);assert.deepEqual(progress,[48,73]);assert.equal(loaded.source.schemaVersion,'pdf-evidence-selected/1');assert.equal(loaded.source.totalPages,80);
 assert.deepEqual(loaded.source.pages.map(p=>p.number),[48,73]);assert.equal(pdfPage(loaded.source,1),undefined);
 await loaded.destroy();assert.equal(p.destroyed(),1);
});
test('selected loader rejects changed total pages and frees its worker',async()=>{
 const p=parser(79);
 await assert.rejects(openPdfSession(new File(['%PDF-test'],'MOC.pdf'),signal(),()=>{},p.create,'test',1000,{totalPages:80,pageNumbers:[48,73]}),/쪽수가 다릅니다/);
 assert.deepEqual(p.read,[]);assert.equal(p.destroyed(),1);
});
for(const [name,selection] of Object.entries({empty:{totalPages:80,pageNumbers:[]},duplicate:{totalPages:80,pageNumbers:[48,48]},unordered:{totalPages:80,pageNumbers:[73,48]},zero:{totalPages:80,pageNumbers:[0]},outside:{totalPages:80,pageNumbers:[81]},fraction:{totalPages:80,pageNumbers:[48.5]},tooMany:{totalPages:80,pageNumbers:Array.from({length:41},(_,i)=>i+1)},tooLong:{totalPages:201,pageNumbers:[48]},invalidTotal:{totalPages:80.5,pageNumbers:[48]}}))test(`invalid selected range rejected: ${name}`,()=>assert.throws(()=>validatePageSelection(selection)));
async function linked(){
 const f=await selectedHandoffFixture();let selected,destroyed=0;
 const request=async path=>path.endsWith('/automation')?Response.json(f.done.automation):new Response(f.bytes,{headers:{'Content-Type':'application/pdf','X-Source-Sha256':f.source.sha256}});
 const loader=async(_file,_signal,_progress,selection)=>{selected=selection;return {source:f.source,pdf:{},destroy:async()=>{destroyed++;}};};
 return {...f,request,loader,selected:()=>selected,destroyed:()=>destroyed};
}
test('long saved handoff preserves original citations and starts unreviewed, with no model calls',async()=>{
 const f=await linked();assert.equal(handoffAvailability(f.done).ready,true);
 const out=await loadResearchHandoff(f.done,signal(),()=>{},f.request,f.loader);
 assert.deepEqual(f.selected(),{totalPages:80,pageNumbers:[48,73]});
 const field=out.project.review.rows[0].fields.dose;
 assert.equal(field.current.citation.page,48);assert.equal(locate(f.source,field.current.citation).page,48);assert.equal(field.decision,'unreviewed');
 assert.equal(locate(f.source,{...field.current.citation,page:1}),null);
 const raw=reviewBackup(out.project.review,f.source),restored=restoreReview(raw,f.source);assert.equal(restored.rows[0].fields.dose.current.citation.page,48);
 const bundle={schema:'trialboard-project/1',source:f.source,notes:[],context:out.context,reviewRaw:raw,draftRaw:await draftBackup(out.project.draft,out.project.review,f.source),meetingRaw:null,agentRaw:out.project.agentRaw};
 const project=await validateProject(readBundle(JSON.stringify(bundle)),f.source);
 assert.equal(project.agentRaw,out.project.agentRaw);assert.deepEqual(reviewPageSelection(f.source),f.selected());
 assert.match(evidenceExport(f.source,[]).limitations.at(-1),/80쪽 중 2쪽/);assert.match(evidenceMarkdown(f.source,[]),/전체 80쪽 중 2쪽/);
 const wrong=structuredClone(f.source);wrong.totalPages=79;await assert.rejects(validateProject(bundle,wrong));
});
test('long handoff rejects an incorrectly renumbered loader result and releases it',async()=>{
 const f=await linked();f.source.schemaVersion='pdf-evidence/1';delete f.source.totalPages;
 await assert.rejects(loadResearchHandoff(f.done,signal(),()=>{},f.request,f.loader),/선택 페이지/);assert.equal(f.destroyed(),1);
});
test('notes include neighbors on original page, never array ordinal',async()=>{
 const f=await selectedHandoffFixture(),s=f.source.pages[0].spans[0];
 const note={spanId:s.id,page:48,sourceDigest:f.source.sha256,quote:s.text,box:s.box,locationStatus:'USER_ATTESTED_VISUAL_MATCH',meaningStatus:'NOT_ASSESSED'};
 const context=Object.fromEntries(['asset','indication','study','question'].map(k=>[k,f.done.automation.report.input[k]]));
 const input=pdfAgentInput(f.source,[note],context);
 assert.ok(input.spans.length);assert.ok(input.spans.every(s=>s.page===48));
 assert.throws(()=>pdfAgentInput(f.source,[{...note,page:1}],context));
});
test('coverage mismatch cannot start a selected handoff',async()=>{
 const f=await selectedHandoffFixture();f.done.automation.document.coverage.retainedPages=[1,2];
 assert.equal(handoffAvailability(f.done).ready,false);
});
