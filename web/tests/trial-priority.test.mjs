import test from 'node:test';
import assert from 'node:assert/strict';
import {trialPriority} from '../src/trial-priority.ts';
import {chooseCandidate,researchCandidates} from '../src/auto-review.ts';
import {readScoutReceipt} from '../src/evidence-scout.ts';
const study=(patch={})=>({nct_id:'NCT00000001',url:'https://clinicaltrials.gov/study/NCT00000001',title:'MOC trial',conditions:['MOC tumor'],phases:[],status:'UNKNOWN',updated:null,sponsor:null,enrollment:null,interventions:[{name:'MOCdrug',type:'DRUG'}],arms:[],primary_outcomes:[],results_available:false,documents:[],...patch});
const receipt=(studies,query='MOCdrug')=>({id:'00000000-0000-4000-8000-000000000001',query,created_at:'2026-09-16T00:00:00Z',digest:'a'.repeat(64),total_count:studies.length,fetched_count:studies.length,truncated:false,studies,mode:'LIVE_PUBLIC',clinical_verified:false});
const arms=(a,b)=>[{label:a,description:null},{label:b}];
test('MOC separate target dose arms beat access-only result and document counts',()=>{
 const access=study({results_available:true,documents:[{},{}]});
 const dose=study({nct_id:'NCT00000002',arms:arms('MOCdrug: 10 mg daily','MOCdrug 20 mg daily')});
 const chosen=chooseCandidate(receipt([access,dose]));
 assert.equal(chosen.study.nct_id,dose.nct_id);assert.equal(chosen.priority.tier,2);
 assert.deepEqual(chosen.priority.quotes.map(q=>q.text),['MOCdrug: 10 mg','MOCdrug 20 mg']);
 assert.match(chosen.reason,/무작위배정·동일 환자군/);assert.equal(chosen.priority.version,'dose-start/1');
});
for(const [label,a,b] of [
 ['partner drug','MOCdrug with partner 10 mg','MOCdrug with partner 20 mg'],
 ['alias','ALIAS 10 mg','ALIAS 20 mg'],
 ['substring','preMOCdrug 10 mg','MOCdruglike 20 mg'],
 ['same dose','MOCdrug 10 mg','MOCdrug 10.0 mg'],
 ['units','MOCdrug 10 mg/kg','MOCdrug 20 mg/kg'],
 ['spaced units','MOCdrug 10 mg / kg','MOCdrug 20 mg / kg'],
 ['tablets','MOCdrug 1 tablet','MOCdrug 2 tablets'],
 ['zero','MOCdrug 0 mg','MOCdrug 20 mg'],
])test(`MOC ${label} cannot prove distinct target mg arms`,()=>assert.equal(trialPriority(study({arms:arms(a,b)}),'MOCdrug').tier,0));
test('MOC within-arm dose reduction and contradictory fields do not create two dose arms',()=>{
 for(const group of [[{label:'MOCdrug 10 mg or MOCdrug 20 mg'}],[{label:'MOCdrug 10 mg',description:'reduce to MOCdrug 5 mg'},{label:'MOCdrug 20 mg'}]]){
  assert.equal(trialPriority(study({arms:group}),'MOCdrug').tier,0);
 }
});
test('MOC Unicode spaces and case preserve exact observed strings',()=>{
 const p=trialPriority(study({arms:arms('mocDRUG 10\u00a0mg','MOCdrug: 20 mg')}),'MOCdrug');
 assert.equal(p.tier,2);assert.equal(p.quotes[0].text,'mocDRUG 10\u00a0mg');
});
test('MOC single-drug dose title is weaker than distinct arm cues',()=>{
 const s=study({title:'MOCdrug dose-ranging study'});assert.equal(trialPriority(s,'MOCdrug').tier,1);
 assert.equal(trialPriority({...s,interventions:[...s.interventions,{name:'Partner',type:'DRUG'}]},'MOCdrug').tier,0);
 assert.equal(trialPriority({...s,title:'Partner dose-ranging study'},'MOCdrug').tier,0);
});
test('MOC priority never crosses confirmed indication or explicit NCT',()=>{
 const s=study(),d=study({nct_id:'NCT00000002',conditions:['Other tumor'],arms:arms('MOCdrug 10 mg','MOCdrug 20 mg')});
 assert.equal(chooseCandidate(receipt([s,d])),undefined);
 assert.equal(chooseCandidate(receipt([s,d]),{asset:'MOCdrug',indication:'MOC tumor'}).study.nct_id,s.nct_id);
 assert.equal(chooseCandidate(receipt([s,d],'NCT00000001')).study.nct_id,s.nct_id);
});
test('MOC tie order is deterministic; no raw source changes or false clinical verification',()=>{
 const a=study(),b=study({nct_id:'NCT00000002'}),r=receipt([b,a]),before=structuredClone(r);
 assert.equal(chooseCandidate(r).study.nct_id,a.nct_id);assert.deepEqual(r,before);
 assert.equal(r.clinical_verified,false);assert.match(researchCandidates(r)[0].reason,/確認|확인하지 못해/);
});
test('malformed arm descriptions rejected at receipt boundary; null remains compatible',()=>{
 assert.ok(readScoutReceipt(receipt([study({arms:[{label:'MOC',description:null}]})])));
 for(const value of [123,{},[]])assert.throws(()=>readScoutReceipt(receipt([study({arms:[{label:'MOC',description:value}]})])));
});
