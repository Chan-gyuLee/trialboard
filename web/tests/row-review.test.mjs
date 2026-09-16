import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {restoreReview} from '../src/field-review-restore.ts';
import {confirmRow,reviewableRow} from '../src/row-review.ts';
import {designHandoff} from '../src/design-handoff.ts';
const f=JSON.parse(execFileSync('uv',['run','python','-c',`import json,sys
sys.path.insert(0,'tests')
from test_field_revalidation import sample
f=sample(imported=True)
print(json.dumps({'source':f['source']['source'],'review':f['review'],'agent':f['agent'].decode()}))`],{cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8',timeout:30000}));
const source=f.source,review=restoreReview(JSON.stringify(f.review),source),rowId=review.rows[0].id;
test('explicit row confirmation records reported fields only and preserves all other rows',()=>{
 const before=structuredClone(review),keys=reviewableRow(review,source,rowId,1);
 const next=confirmRow(review,source,rowId,1,'MOC automated UI contract check',true);
 for(const k of keys){assert.equal(next.rows[0].fields[k].decision,'confirmed');assert.equal(next.rows[0].fields[k].history.length,review.rows[0].fields[k].history.length+1);}
 assert.deepEqual(next.rows[0].fields.reported_rate,review.rows[0].fields.reported_rate);
 assert.deepEqual(next.rows.slice(1),review.rows.slice(1));assert.deepEqual(review,before);
});
for(const [name,change,page,reason,ack] of [
 ['no acknowledgement',()=>{},1,'MOC check',false],['no reason',()=>{},1,'',true],
 ['not rendered',()=>{},null,'MOC check',true],['wrong page',()=>{},2,'MOC check',true],
 ['held',r=>r.rows[0].fields.population.decision='held',1,'MOC check',true],
 ['missing denominator',r=>r.rows[0].fields.denominator.current.value=null,1,'MOC check',true],
 ['bad quote',r=>r.rows[0].fields.window.current.citation.quote='wrong quote',1,'MOC check',true],
 ['history full',r=>r.rows[0].fields.definition.history=Array(40).fill(r.rows[0].fields.definition.history[0]),1,'MOC check',true],
])test(`row confirmation rejects ${name} atomically`,()=>{const r=structuredClone(review);change(r);const before=structuredClone(r);assert.throws(()=>confirmRow(r,source,rowId,page,reason,ack));assert.deepEqual(r,before);});
test('row preview rejects another PDF',()=>assert.throws(()=>reviewableRow(review,{...source,sha256:'0'.repeat(64)},rowId,1)));
test('normal handoff links current row IDs and question but never generates probabilities',async()=>{
 const d=await designHandoff(review,source,f.agent);assert.equal(d.question,JSON.parse(f.agent).input.question);
 assert.equal(d.arms.length,2);assert.equal(d.arms.flatMap(a=>a.observation_ids).length,4);
 assert.ok(d.plans.every(p=>p.per_arm===''));assert.ok(d.scenarios[0].response.every(v=>v===''));
});
for(const name of ['missing record','different record','different source','unregistered MOC'])test(`design handoff rejects ${name}`,async()=>{
 await assert.rejects(designHandoff(review,name==='different source'?{...source,sha256:'f'.repeat(64)}:source,name==='missing record'?null:name==='different record'?f.agent+' ':f.agent,name==='unregistered MOC'));
});
