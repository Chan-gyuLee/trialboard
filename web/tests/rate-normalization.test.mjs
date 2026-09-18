import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {normalizedRate,reviewedRates} from '../src/rate-normalization.ts';
import {addRow,decide,exportReview,newReview,reviewMarkdown,validateCheckedValue} from '../src/field-review.ts';
import {restoreReview,reviewBackup} from '../src/field-review-restore.ts';
import {readResult} from '../src/revalidation-result.ts';
import {readRecritique} from '../src/recritique-result.ts';
const box={x:.3,y:.7,width:.04,height:.03};
const source={schemaVersion:'pdf-evidence/1',sha256:'a'.repeat(64),name:'MOC.pdf',pages:[{number:1,spans:[{id:'p1-i0',page:1,item:0,text:'36',box},{id:'p1-i1',page:1,item:1,text:'%',box:{...box,x:.345,width:.02}}]}]};
const value=()=>({value:'36',citation:{spanId:'p1-i0',page:1,quote:'36'},supporting:[{spanId:'p1-i1',page:1,quote:'%',role:'unit'}],normalization:{method:'adjacent-percent/1',display:'36%',unitSpanId:'p1-i1',pointEstimateAttested:true,sameGroupAttested:true}});
const recorded=()=>decide(addRow(newReview(source),'one','reported_percentage'),source,'one','reported_rate','corrected',value(),'MOC adjacent-unit check',1,true);
test('separate interpretation preserves raw quote and v3 history through backup and Markdown',()=>{
 const r=recorded();assert.equal(r.schemaVersion,'pdf-field-review/3');
 assert.equal(r.rows[0].fields.reported_rate.current.value,'36');assert.equal(normalizedRate(value(),source),'36%');
 assert.deepEqual(reviewedRates(r,source),{one:'36%'});
 assert.deepEqual(exportReview(restoreReview(reviewBackup(r,source),source),source),exportReview(r,source));
 assert.match(reviewMarkdown(r,source),/사용자 해석: 36%/);
 assert.equal(exportReview(r,source).clinicalApproval,false);
});
test('no implicit unit attachment or synthetic combined quote; no count reconstruction',()=>{
 const v=value();delete v.normalization;
 assert.equal(normalizedRate(v,source),null);
 assert.throws(()=>validateCheckedValue(source,'reported_percentage','reported_rate',v));
 assert.throws(()=>validateCheckedValue(source,'reported_percentage','reported_rate',{...value(),value:'36%'}));
 assert.throws(()=>validateCheckedValue(source,'reported_percentage','events',value()));
 assert.throws(()=>validateCheckedValue(source,'event_count','reported_rate',value()));
});
test('method/display/attestation and exact metadata keys reject tampering and coercion',()=>{
 for(const change of [{display:'37%'},{method:'auto/1'},{pointEstimateAttested:1},{sameGroupAttested:'true'},{sameGroupAttested:false},{unitSpanId:'missing'},{extra:true}]){
  const v=value();Object.assign(v.normalization,change);assert.throws(()=>normalizedRate(v,source));
 }
 for(const n of [null,{},[]])assert.throws(()=>normalizedRate({...value(),normalization:n},source));
});
test('rejects nonadjacent unit, percent column header, wrong literal, cross-page and confidence level',()=>{
 for(const patch of [{box:{...box,x:.6}},{box:{...box,y:.2}},{text:'ORR, %'},{page:2},{text:'mg'},{box:null}]){
  const s=structuredClone(source);Object.assign(s.pages[0].spans[1],patch);assert.throws(()=>normalizedRate(value(),s));
 }
 for(const text of ['95% CI','confidence interval','p value','신뢰구간']){
  const s=structuredClone(source);s.pages[0].spans.push({id:'p1-i2',item:2,page:1,text,box:{...box,x:.2,width:.09}});assert.throws(()=>normalizedRate(value(),s));
 }
});
test('held rows excluded; export/restore reject downgrade or historical manipulation',()=>{
 const r=recorded(),held=decide(r,source,'one','reported_rate','held',value(),'Wait for expert',1,false);
 assert.deepEqual(reviewedRates(held,source),{});
 for(const version of ['pdf-field-review/1','pdf-field-review/2']){
  const bad=structuredClone(r);bad.schemaVersion=version;assert.throws(()=>exportReview(bad,source));
  const packet=exportReview(r,source);packet.schemaVersion=version;assert.throws(()=>restoreReview(JSON.stringify(packet),source));
 }
 const bad=structuredClone(held);bad.rows[0].fields.reported_rate.history[0].after.normalization.display='96%';assert.throws(()=>exportReview(bad,source));
});
test('Python v3 revalidation and AI critique interoperate; normalized result cannot be substituted',async()=>{
 const script="import sys,json;sys.path.insert(0,'tests');from test_rate_normalization import normalized_fixture;from test_recritique import execute,Answer;f=normalized_fixture();print(json.dumps({'fixture':f['review'],'source':f['source']['source'],'result':execute(f,Answer())}))";
 const data=JSON.parse(execFileSync('uv',['run','python','-c',script],{encoding:'utf8',maxBuffer:8*1024*1024}));
 const r=restoreReview(JSON.stringify(data.fixture),data.source);
 assert.equal(readResult(JSON.stringify(data.result.revalidation),r,data.source).acceptedIds.length,4);
 assert.equal((await readRecritique(JSON.stringify(data.result),r,data.source)).status,'COMPLETED');
 for(const rates of [{},{'obs-0':'96%'},{'obs-0':'36%',extra:'20%'}]){
  const bad=structuredClone(data.result);bad.revalidation.normalized_rates=rates;
  assert.throws(()=>readResult(JSON.stringify(bad.revalidation),r,data.source));
  await assert.rejects(readRecritique(JSON.stringify(bad),r,data.source));
 }
});
