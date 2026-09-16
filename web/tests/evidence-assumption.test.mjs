import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonical, digest, exportReview } from "../src/field-review.ts";
import { restoreReview } from "../src/field-review-restore.ts";
import { draftFromBrief, briefFromDraft } from "../src/design-brief.ts";
import { draftBackup, restoreDesignInput } from "../src/design-draft.ts";
import { assumptionEvidence, recordEvidenceAssumption } from "../src/evidence-assumption.ts";
const f=JSON.parse(execFileSync("uv",["run","python","-c",`
import json,sys
sys.path.insert(0,'tests')
from test_field_revalidation import sample
from test_design_compare import brief_for
f=sample()
print(json.dumps({'source':f['source']['source'],'review':f['review'],'brief':brief_for(f)}))
`],{cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8',timeout:30000}));
const source=f.source,review=restoreReview(JSON.stringify(f.review),source),draft=draftFromBrief(f.brief);
const choice={armId:draft.arms[0].id,observationId:draft.arms[0].observation_ids[0],metric:'response',value:'0.41',reason:'合成 test: different population; review sensitivity range',acknowledged:true};
const sid=draft.scenarios[0].id;
test('explicit input changes only one assumption and appends evidence/version/before-after rationale',async()=>{
 const original=canonical({draft,review,source});const next=await recordEvidenceAssumption(draft,review,source,sid,choice);
 assert.equal(next.scenarios[0].response[0],'0.41');assert.equal(next.scenarios[0].response[1],draft.scenarios[0].response[1]);
 assert.deepEqual(next.scenarios[0].adverse_event,draft.scenarios[0].adverse_event);
 assert.ok(next.scenarios[0].rationale.includes(await digest(canonical(exportReview(review,source)))));
 assert.ok(next.scenarios[0].rationale.includes(choice.observationId));assert.ok(next.scenarios[0].rationale.includes('→ 0.41'));
 assert.equal(next.scenarios[0].provenance,'user_declared_hypothetical');assert.equal(canonical({draft,review,source}),original);
 const restored=await restoreDesignInput(await draftBackup(next,review,source),review,source);assert.deepEqual(restored.draft,next);
 const brief=await briefFromDraft(next,review,source);assert.equal(brief.scenarios[0].rationale,next.scenarios[0].rationale);
});
for(const [name,patch] of [['no confirmation',{acknowledged:false}],['no reason',{reason:''}],['short reason',{reason:'yes'}],['too long reason',{reason:'x'.repeat(701)}],['blank value',{value:''}],['out of range',{value:'1.01'}],['negative',{value:'-1'}],['scientific notation',{value:'1e-3'}],['unknown arm',{armId:'missing'}],['unknown observation',{observationId:'missing'}],['foreign observation',{observationId:draft.arms[1].observation_ids[0]}],['unknown target',{metric:'survival'}],['unchanged value',{value:draft.scenarios[0].response[0]}]]) test(`reject ${name} without modifying draft`,async()=>{
 const before=canonical(draft);await assert.rejects(recordEvidenceAssumption(draft,review,source,sid,{...choice,...patch}));assert.equal(canonical(draft),before);
});
for(const [name,mutate] of [['held',r=>r.rows[0].fields.reported_rate.decision='held'],['unreviewed',r=>r.rows[0].fields.population.decision='unreviewed'],['missing denominator',r=>r.rows[0].fields.denominator.current.value=null],['zero denominator',r=>r.rows[0].fields.denominator.current.value='0'],['invalid citation',r=>r.rows[0].fields.denominator.current.citation.quote='unrelated']]) test(`reject incomplete evidence: ${name}`,async()=>{
 const r=structuredClone(review);mutate(r);await assert.rejects(recordEvidenceAssumption(draft,r,source,sid,choice));
});
test('changed PDF, missing scenario and overflow rationale are blocked',async()=>{
 await assert.rejects(recordEvidenceAssumption(draft,review,{...source,sha256:'f'.repeat(64)},sid,choice));
 await assert.rejects(recordEvidenceAssumption(draft,review,source,'missing',choice));
 const d=structuredClone(draft);d.scenarios[0].rationale='x'.repeat(2000);await assert.rejects(recordEvidenceAssumption(d,review,source,sid,choice),/2,000/);
});
test('evidence preview never fills an assumption or returns an estimated probability',()=>{
 const p=assumptionEvidence(draft,review,source,choice.armId,choice.observationId);assert.deepEqual(Object.keys(p),['arm','row']);
});
