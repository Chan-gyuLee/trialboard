import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {restoreReview} from '../src/field-review-restore.ts';
import {evidenceScope,scopePacket,scopeMarkdown,scopeSelection} from '../src/evidence-scope.ts';
const f=JSON.parse(execFileSync('uv',['run','python','-c',`import json,sys
sys.path.insert(0,'tests')
from test_field_revalidation import sample
f=sample()
print(json.dumps({'source':f['source']['source'],'review':f['review']}))`],{cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8',timeout:30000}));
const source=f.source,review=restoreReview(JSON.stringify(f.review),source);
test('scope audit preserves raw values, exact citations and original review',async()=>{
 const before=structuredClone(review),a=await scopePacket(review,source);
 assert.equal(a.clinicalApproval,false);assert.equal(a.rows.length,4);assert.equal(a.rows[0].cells.length,9);
 assert.match(a.reviewDigest,/^[a-f0-9]{64}$/);assert.deepEqual(review,before);
 assert.ok(a.rows[0].cells.every(c=>c.status==='RECORDED'));
 assert.equal(a.rows[0].cells.find(c=>c.field==='cohort').value,review.rows[0].fields.cohort.current.value);
});
for(const [state,change] of [
 ['MISSING',c=>{c.current.value=null;c.current.citation=null;}],['HELD',c=>c.decision='held'],
 ['UNREVIEWED',c=>c.decision='unreviewed'],['INVALID_CITATION',c=>c.current.citation.quote='not in the PDF'],
 ['INVALID_CITATION',c=>c.current.value='value not in citation'],
])test(`scope status ${state} never becomes approval`,()=>{
 const r=structuredClone(review);change(r.rows[0].fields.cohort);const a=evidenceScope(r,source);
 assert.equal(a.rows[0].cells.find(c=>c.field==='cohort').status,state);assert.ok(a.unresolvedCells>0);assert.equal(a.clinicalApproval,false);
});
test('selection does not leak unselected observations and invalid selections fail',()=>{
 assert.equal(evidenceScope(review,source,undefined,[]).rows.length,0);
 assert.deepEqual(evidenceScope(review,source,undefined,['obs-1']).rows.map(r=>r.id),['obs-1']);
 for(const ids of [['unknown'],['obs-1','obs-1']])assert.throws(()=>evidenceScope(review,source,undefined,ids));
 assert.throws(()=>evidenceScope(review,{...source,sha256:'0'.repeat(64)}));
});
test('display selection tolerates partially restored drafts without changing or approving them',()=>{
 const ids=['','old-project-row','obs-1','obs-1'];const before=[...ids];
 assert.deepEqual(scopeSelection(review,ids),{ids:['obs-1'],missingLinks:2});
 assert.deepEqual(ids,before);assert.deepEqual(scopeSelection({...review,rows:[]},ids),{ids:[],missingLinks:4});
 assert.deepEqual(scopeSelection(review),{ids:undefined,missingLinks:0});
});
test('literal differences remain findings, not proof of clinical non-equivalence',()=>{
 const r=structuredClone(review);r.rows[0].fields.population.current.value='different wording';
 const a=evidenceScope(r,source);assert.ok(a.differences.some(d=>d.field==='population'));
 assert.match(scopeMarkdown(a),/불일치 확정 아님/);assert.match(scopeMarkdown(a),/자료마감일/);
});
test('search context is kept separate and cannot manufacture an observation NCT',()=>{
 const context={asset:'MOC',study:'NCT00000001',indication:'MOC',receiptId:'MOC',question:'MOC',document:{runId:'MOC',sourceId:'MOC',title:'<script>MOC</script>'}};
 const a=evidenceScope(review,source,context);assert.ok(a.rows.every(r=>r.trialSignal==='NO_MENTION'));
 assert.notEqual(a.context,context);assert.match(scopeMarkdown(a),/&lt;script&gt;/);
});
test('changing source review changes the audit digest; restore recomputes same scope',async()=>{
 const a=await scopePacket(review,source),r=structuredClone(review);r.rows[0].fields.population.decision='held';
 assert.notEqual(a.reviewDigest,(await scopePacket(r,source)).reviewDigest);
 assert.deepEqual(a,await scopePacket(restoreReview(JSON.stringify(f.review),source),source));
});
