import test from 'node:test';
import assert from 'node:assert/strict';
import {readRegistryResults,loadRegistryResults} from '../src/registry-results.ts';
const result={collection:{id:'MOC-run',request:{nct_id:'NCT00000001'}}};
const row={title:'MOC ORR',groupId:'OG0',groupTitle:'MOC pooled',groupDescription:'10 mg or 20 mg',population:'MOC single cohort',window:'MOC week 12',definition:'MOC objective response',parameter:'NUMBER',unit:'percentage of participants',classTitle:'',categoryTitle:'',value:'26.8',lower:'14.2',upper:'42.9',dispersion:'95% Confidence Interval',denominators:[{unit:'Participants',value:'41'}],locator:'/studies/0/resultsSection/outcomeMeasuresModule/outcomeMeasures/0/classes/0/categories/0/measurements/0'};
const packet={schema:'registry-result-tables/1',runId:'MOC-run',nctId:'NCT00000001',snapshotDigest:'a'.repeat(64),sourceUrl:'https://clinicaltrials.gov/study/NCT00000001',outcomes:[row],safety:[],clinicalVerified:false,computedRates:false,limited:false,notice:'MOC unverified posted values'};
test('MOC pooled value, original denominator and locator restored without deriving event counts',()=>{
 const out=readRegistryResults(packet,result);assert.equal(out.outcomes.length,1);assert.equal(out.outcomes[0].value,'26.8');assert.equal(out.outcomes[0].denominators[0].value,'41');assert.equal(out.computedRates,false);
});
for(const [label,patch] of [['wrong trial',{nctId:'NCT00000002'}],['wrong run',{runId:'other'}],['untrusted link',{sourceUrl:'https://evil.invalid/'}],['false approval',{clinicalVerified:true}],['invented rate',{computedRates:true}]])test(`MOC rejects ${label}`,()=>assert.throws(()=>readRegistryResults({...packet,...patch},result)));
test('MOC rejects malformed confidence interval and negative safety counts',()=>{
 assert.throws(()=>readRegistryResults({...packet,outcomes:[{...row,lower:{}}]},result));
 assert.throws(()=>readRegistryResults({...packet,safety:[{groupId:'EG0',groupTitle:'MOC dose',groupDescription:'',metric:'serious adverse events',window:'',description:'',locator:'/test',affected:-1,atRisk:21}]},result));
});
test('MOC load only reads saved result endpoint and does not trigger model work',async()=>{
 let calls=0;const out=await loadRegistryResults(result,new AbortController().signal,async(path,options)=>{calls++;assert.equal(options.method,undefined);assert.ok(path.endsWith('/result-tables'));return Response.json(packet);});assert.equal(calls,1);assert.equal(out.outcomes.length,1);
});
