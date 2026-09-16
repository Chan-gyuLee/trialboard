import test from 'node:test';
import assert from 'node:assert/strict';
import {pdfCandidates} from '../src/pdf-candidates.ts';
import {pdfCandidateInput} from '../src/pdf-agent.ts';
const context={asset:'MOC drug',study:'NCT00000001',indication:'MOC cancer',question:'MOC question'};
const span=(id,text)=>({id,page:1,text,box:[0,0,1,1]});
const source={sha256:'a'.repeat(64),pages:[{number:1,spans:[span('before','MOC introduction'),span('dose','MOC drug 20 mg once daily'),span('response','Objective response rate 30% in an evaluable cohort'),span('safety','Grade 3 adverse events in safety population'),span('after','Data cutoff at 12 months')]}]};
test('candidate search is deterministic, explained and does not mutate or attest source',()=>{
 const before=structuredClone(source),candidates=pdfCandidates(source,context);
 assert.equal(candidates[0].spanId,'dose');assert.ok(candidates[0].reasons.includes('용량·투여 단위'));
 assert.deepEqual(candidates,pdfCandidates(source,context));assert.deepEqual(source,before);
 assert.ok(candidates.every(c=>!Object.hasOwn(c,'clinicalApproval')&&!Object.hasOwn(c,'userAttestedAt')));
});
test('explicit candidates include exact neighboring spans once, no synthesized evidence notes',()=>{
 const i=pdfCandidateInput(source,['response','safety'],context);
 assert.equal(i.provenance,'user_pdf_export_unverified');assert.equal(i.spans.length,5);
 assert.equal(i.spans[0].text,source.pages[0].spans[0].text);assert.equal(i.spans[0].source_digest,source.sha256);
 assert.ok(i.spans.every(s=>s.locator===null));
});
test('category filtering happens before the top-20 cap and never claims clinical relevance',()=>{
 const s={...source,pages:[{number:1,spans:[...Array.from({length:25},(_,i)=>span(`d${i}`,'MOC drug 20 mg safety population')),...source.pages[0].spans]}]};
 assert.equal(pdfCandidates(s,context).some(c=>c.spanId==='response'),false);
 assert.deepEqual(pdfCandidates(s,context,'반응 평가변수').map(c=>c.spanId),['response']);
 assert.deepEqual(pdfCandidates(s,context,'unknown'),[]);
});
test('study literal filter and wider context preserve exact spans and enforce budget',()=>{
 const s={...source,pages:[{number:1,spans:Array.from({length:50},(_,i)=>span(`s${i}`,i===10?'NCT00000001':'20 mg'))}]};
 assert.deepEqual(pdfCandidates(s,context,'시험명 문구').map(c=>c.spanId),['s10']);
 assert.equal(pdfCandidateInput(s,['s10'],context,6).spans.length,13);
 assert.equal(pdfCandidateInput(s,['s0'],context,6).spans.length,7);
 assert.throws(()=>pdfCandidateInput(s,['s6','s19','s32','s45'],context,6));
 assert.throws(()=>pdfCandidateInput(s,['s10'],context,100));
});
for(const ids of [[],['no-such-span'],['dose','dose']])test(`invalid selection ${JSON.stringify(ids)}`,()=>assert.throws(()=>pdfCandidateInput(source,ids,context)));
test('missing context blocks model preparation',()=>assert.throws(()=>pdfCandidateInput(source,['dose'],{...context,study:''})));
test('scanned and oversized spans do not become candidates',()=>{
 const s={...source,pages:[{number:1,spans:[{...span('scan','20 mg'),box:null},span('big','20 mg '.repeat(500)),span('unrelated','MOC bibliography')]}]};
 assert.equal(pdfCandidates(s,context).length,0);assert.throws(()=>pdfCandidateInput(s,['scan'],context));
});
test('context expansion respects span and byte budgets including neighbors',()=>{
 const s={...source,pages:[{number:1,spans:Array.from({length:45},(_,i)=>span(`s${i}`,'20 mg '.repeat(200)))}]};
 assert.throws(()=>pdfCandidateInput(s,Array.from({length:45},(_,i)=>`s${i}`),context));
 assert.equal(pdfCandidates(s,context).length,20);
 const large={...source,pages:[{number:1,spans:[span('a','MOC 20 mg'),span('b','a'.repeat(2001))]}]};
 assert.throws(()=>pdfCandidateInput(large,['a'],context));
});
test('selection retains source ordering instead of ranking and respects page boundary',()=>{
 const s={...source,pages:[...source.pages,{number:2,spans:[{...span('p2','20 mg'),page:2}]}]};
 assert.deepEqual(pdfCandidateInput(s,['p2','dose'],context).spans.map(s=>s.id),['before','dose','response','safety','p2']);
});
