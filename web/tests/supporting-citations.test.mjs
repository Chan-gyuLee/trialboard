import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {addRow,attachSupporting,decide,exportReview,newReview,reviewMarkdown,validateCheckedValue,validateSupporting} from '../src/field-review.ts';
import {restoreReview,reviewBackup} from '../src/field-review-restore.ts';
import {reviewableRow} from '../src/row-review.ts';
import {readRecritique} from '../src/recritique-result.ts';
const box={x:.1,y:.1,width:.5,height:.1};
const source={schemaVersion:'pdf-evidence/1',sha256:'a'.repeat(64),name:'MOC.pdf',pages:[{number:1,spans:['Dose 40 mg','Table 1. Synthetic cohort','Unit: mg','Footnote: MOC only','N = 100','36','ORR, % (95% CI)'].map((text,i)=>({id:`p1-i${i}`,page:1,item:i,text,box}))}]};
const primary={value:'40 mg',citation:{spanId:'p1-i0',page:1,quote:'Dose 40 mg'}};
const withSupport=()=>attachSupporting(source,primary,source.pages[0].spans[1],'header');
const recorded=()=>decide(addRow(newReview(source),'one','event_count'),source,'one','dose','corrected',withSupport(),'MOC relation checked',1,true);
test('support preserves literal value and primary cite; immutable and unapproved',()=>{
 const next=withSupport();assert.deepEqual(next.citation,primary.citation);assert.equal(next.value,'40 mg');assert.equal(primary.supporting,undefined);
 assert.equal(next.supporting[0].role,'header');assert.equal(exportReview(recorded(),source).clinicalApproval,false);
});
test('support history uses v2; backup and restore preserve exact JSON including removal history',()=>{
 const review=recorded();assert.equal(review.schemaVersion,'pdf-field-review/2');
 assert.deepEqual(exportReview(restoreReview(reviewBackup(review,source),source),source),exportReview(review,source));
 const removed=decide(review,source,'one','dose','corrected',primary,'Remove unrelated header',1,true);
 assert.equal(removed.rows[0].fields.dose.current.supporting,undefined);assert.equal(removed.rows[0].fields.dose.history[1].before.supporting.length,1);
 assert.deepEqual(exportReview(restoreReview(reviewBackup(removed,source),source),source),exportReview(removed,source));
 assert.match(reviewMarkdown(review,source),/보조 근거 \(표 머리글\)/);
});
test('rejects missing primary, duplicate primary/support, wrong role, altered quote, no box and cross-page',()=>{
 for(const value of [{...withSupport(),citation:null},{...withSupport(),value:null},{...withSupport(),supporting:[]},{...withSupport(),supporting:[{...primary.citation,role:'unit'}]},{...withSupport(),supporting:[...withSupport().supporting,...withSupport().supporting]},{...withSupport(),supporting:[{...withSupport().supporting[0],role:'approved'}]},{...withSupport(),supporting:[{...withSupport().supporting[0],quote:'invented'}]},{...withSupport(),supporting:[{...withSupport().supporting[0],page:2}]}])assert.throws(()=>validateSupporting(source,value));
 const noBox=structuredClone(source);noBox.pages[0].spans[1].box=null;assert.throws(()=>validateSupporting(noBox,withSupport()));
});
test('four-link bound does not silently drop a fragment',()=>{
 let v=primary;for(let i=1;i<=4;i++)v=attachSupporting(source,v,source.pages[0].spans[i],'context');
 assert.throws(()=>attachSupporting(source,v,source.pages[0].spans[5],'context'));assert.equal(v.supporting.length,4);
});
test('support cannot synthesize percentage or count; approval still requires primary display and attestation',()=>{
 const rate=attachSupporting(source,{value:'36%',citation:{spanId:'p1-i5',page:1,quote:'36'}},source.pages[0].spans[6],'unit');
 assert.throws(()=>validateCheckedValue(source,'reported_percentage','reported_rate',rate));
 assert.throws(()=>validateCheckedValue(source,'reported_percentage','events',{...rate,value:'36'}));
 for(const [page,attested] of [[null,true],[2,true],[1,false]])assert.throws(()=>decide(addRow(newReview(source),'one','event_count'),source,'one','dose','corrected',withSupport(),'MOC',page,attested));
 assert.throws(()=>reviewableRow(recorded(),source,'one',1),/개별 필드/);
});
test('v1 reader compatibility and explicit downgrade/tampered history rejection',()=>{
 const legacy=addRow(newReview(source),'one','event_count');assert.deepEqual(exportReview(restoreReview(reviewBackup(legacy,source),source),source),exportReview(legacy,source));
 const packet=exportReview(recorded(),source);packet.schemaVersion='pdf-field-review/1';assert.throws(()=>restoreReview(JSON.stringify(packet),source));
 const bad=exportReview(recorded(),source);bad.rows[0].fields.dose.current.supporting[0].role='unit';assert.throws(()=>restoreReview(JSON.stringify(bad),source));
});
test('Python v2 revalidation and critique match browser reader; tampered link is rejected',async()=>{
 const script="import sys,json;sys.path.insert(0,'tests');from test_supporting_citations import linked;from test_recritique import execute,Answer;f=linked(imported=True);print(json.dumps({'fixture':f['review'],'source':f['source']['source'],'result':execute(f,Answer())}))";
 const data=JSON.parse(execFileSync('uv',['run','python','-c',script],{encoding:'utf8',maxBuffer:8*1024*1024}));
 const r=restoreReview(JSON.stringify(data.fixture),data.source);
 assert.equal((await readRecritique(JSON.stringify(data.result),r,data.source)).status,'COMPLETED');
 const changed=structuredClone(data.result);changed.revalidation.review.rows[0].fields.dose.current.supporting[0].role='unit';
 await assert.rejects(readRecritique(JSON.stringify(changed),r,data.source));
});
