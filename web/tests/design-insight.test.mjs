import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {restoreReview} from '../src/field-review-restore.ts';
import {readDesignResult} from '../src/design-result.ts';
import {designInsight,compareDesignRuns,changeMarkdown,percentagePoint} from '../src/design-insight.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const fixtures=JSON.parse(execFileSync('uv',['run','python','-c',`
import json,sys
sys.path.insert(0,'tests')
from test_design_compare import run, brief_for
from test_field_revalidation import sample, revise
f=sample(); b=brief_for(f); normal=run(f,b)
b['plans'][1]['per_arm']=80
edited=run(f,b)
revise(f['review']['rows'][0]['fields']['reported_rate'],decision='held')
print(json.dumps({'source':f['source']['source'],'normal':normal,'edited':edited,'blocked':run(f)}))
`],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:8_000_000}));
async function result(name='normal') {
 const raw=structuredClone(fixtures[name]);
 const review=restoreReview(JSON.stringify(raw.revalidation.review),fixtures.source);
 return readDesignResult(JSON.stringify(raw),review,fixtures.source);
}
test('briefing uses exact validated engine rows and tradeoffs without mutation',async()=>{
 const r=await result(),copy=JSON.stringify(r),insight=designInsight(r,'plateau');
 assert.equal(insight.kind,'calculated'); assert.equal(insight.allUnsafe,false);
 assert.deepEqual(insight.tradeoff,r.tradeoffs.find(t=>t.scenario_id==='plateau'));
 assert.deepEqual(insight.rows.map(r=>r.simulation),r.simulations.filter(s=>s.scenarioId==='plateau'));
 assert.equal(designInsight(r,'unsafe').allUnsafe,true);assert.equal(JSON.stringify(r),copy);
 assert.throws(()=>designInsight(r,'missing'));assert.throws(()=>designInsight(r,'plateau','missing'));
});
test('exact safety threshold is not labelled unsafe',async()=>{
 const r=await result();r.brief.scenarios[1].adverse_event[0]=r.brief.scenarios[1].maximum_adverse_event_rate;
 assert.equal(designInsight(r,'unsafe').allUnsafe,false);
});
test('blocked result provides no comparison metrics',async()=>{
 const r=await result('blocked'),i=designInsight(r,r.brief.scenarios[0].id);
 assert.equal(i.kind,'blocked');assert.equal(i.tradeoff,null);assert.deepEqual(i.rows,[]);
});
test('real recalculation reports sample change and exact before/after probabilities',async()=>{
 const a=await result(),b=await result('edited'),diff=compareDesignRuns(a,b);
 assert.equal(diff.comparable,true);assert.equal(diff.changes.length,1);
 assert.deepEqual([diff.changes[0].before,diff.changes[0].after],['60명','80명']);
 assert.equal(diff.effects.length,4);
 for(const e of diff.effects){const old=a.simulations.find(s=>s.planId===e.planId&&s.scenarioId===e.scenarioId),now=b.simulations.find(s=>s.planId===e.planId&&s.scenarioId===e.scenarioId);for(const key of ['correct','unsafe','noSelection'])assert.deepEqual(e[key],{before:old[key],after:now[key],delta:now[key]-old[key]});}
});
for(const [name,mutate] of [
 ['source',r=>r.brief.source_digest='other'],['review',r=>r.brief.review_content_digest='other'],
 ['question',r=>r.brief.question+=' other'],['arms',r=>r.brief.arms[0].observation_ids=['other']],
 ['engine',r=>r.raw.engine_digest='other'],['blocked',r=>r.blockers.push({code:'BLOCKED'})],
])test(`different ${name} suppresses cross-run numeric deltas`,async()=>{
 const a=await result(),b=structuredClone(a);mutate(b);const diff=compareDesignRuns(a,b);
 assert.equal(diff.comparable,false);assert.deepEqual(diff.effects,[]);
});
test('matches identities rather than array position, omits missing pairs',async()=>{
 const a=await result(),b=structuredClone(a);b.simulations.reverse();b.simulations.pop();
 const diff=compareDesignRuns(a,b);assert.equal(diff.effects.length,3);assert.ok(diff.effects.every(e=>['correct','unsafe','noSelection'].every(key=>e[key].delta===0)));
});
test('all editable scenario inputs tracked, confirmation hashes not treated as edits',async()=>{
 const a=await result(),b=structuredClone(a);
 a.brief.scenarios[0].provenance={kind:'ai_proposed_hypothetical',proposal_id:'p1',evidence_ids:['obs-0'],reviewed_input_digest:'a'};
 b.brief.scenarios[0].provenance={...a.brief.scenarios[0].provenance,reviewed_input_digest:'b'};
 assert.equal(compareDesignRuns(a,b).changes.length,0);
 b.brief.scenarios[0].response[0]=.44;b.brief.scenarios[0].adverse_event[0]=.1;
 b.brief.scenarios[0].maximum_adverse_event_rate=.4;b.brief.scenarios[0].adverse_event_penalty=.9;
 b.brief.scenarios[0].rationale='changed';b.brief.seed=10;b.brief.repetitions=1000;
 assert.equal(compareDesignRuns(a,b).changes.length,7);
});
test('export escapes labels, identifies runs, states limits and exact deltas',async()=>{
 const a=await result(),b=await result('edited');b.brief.plans[1].label='<script>|`\nother';
 const text=changeMarkdown(a,b);assert.ok(text.includes(a.runId));assert.ok(text.includes(b.runId));
 assert.ok(text.includes('&lt;script&gt;\\|\\` other'));assert.ok(!text.includes('<script>'));
 assert.match(text,/임상 권고\/인과효과\/전문가 승인 아님/);assert.match(text,/백업이 아닙니다/);
 assert.equal(percentagePoint(.12),'+12.0%p');assert.equal(percentagePoint(-.1),'−10.0%p');
});
