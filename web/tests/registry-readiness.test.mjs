import test from 'node:test';
import assert from 'node:assert/strict';
import {readReadiness} from '../src/registry-readiness.ts';
const tables={snapshotDigest:'a'.repeat(64),limited:false,outcomes:[{locator:'/MOC/0',groupId:'OG0',groupTitle:'MOC 10 mg'},{locator:'/MOC/1',groupId:'OG1',groupTitle:'MOC 20 mg'}],safety:[]};
const series={id:'a'.repeat(24),family:'RESPONSE',title:'MOC ORR',context:'MOC week 12',status:'REVIEW_CANDIDATE',issues:[],valueKind:'REPORTED_PERCENTAGE',groups:tables.outcomes.map(r=>({label:r.groupTitle,groupId:r.groupId,locator:r.locator}))};
const packet={schema:'registry-readiness/1',snapshotDigest:tables.snapshotDigest,status:'NEEDS_EVIDENCE',method:'DETERMINISTIC_RULES',clinicalApproved:false,simulationExecuted:false,responseCandidate:true,safetyCandidate:false,questions:['MOC missing safety?'],steps:['MOC rule check'],series:[series]};
test('MOC structural candidate remains unapproved and does not invent a simulation',()=>{const p=readReadiness(packet,tables);assert.equal(p.status,'NEEDS_EVIDENCE');assert.equal(p.clinicalApproved,false);});
for(const [name,change] of [
 ['wrong snapshot',p=>p.snapshotDigest='b'.repeat(64)],['fake approval',p=>p.clinicalApproved=true],
 ['fake simulation',p=>p.simulationExecuted=true],['fake model claim',p=>p.method='LLM'],
 ['false ready',p=>p.status='EXPERT_REVIEW_REQUIRED'],['unknown row',p=>p.series[0].groups[0].locator='/other'],
 ['swapped group',p=>p.series[0].groups[0].groupId='OG1'],['candidate with blocker',p=>p.series[0].issues=['DENOMINATOR_UNRESOLVED']],
 ['prototype issue',p=>p.series[0].issues=['__proto__']],['false aggregate',p=>p.safetyCandidate=true],
])test(`MOC readiness rejects ${name}`,()=>{const p=structuredClone(packet);change(p);assert.throws(()=>readReadiness(p,tables));});
