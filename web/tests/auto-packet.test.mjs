import test from 'node:test';
import assert from 'node:assert/strict';
import {autoPacketMarkdown} from '../src/auto-packet.ts';
const done={result:{collection:{id:'MOC-run',request:{asset:'MOC drug',nct_id:'NCT00000001',indication:'MOC tumor'},created_at:'2026-09-16',status:'COMPLETE',execution_mode:'SCRIPTED_TEST_DOUBLE',coverage:[],review:null,sources:[],notices:[]}}};
test('MOC export labels synthetic records and never implies simulation or absence of results',()=>{
 const out=autoPacketMarkdown(done);assert.ok(out.startsWith('MOC'));assert.ok(out.includes('설계 시뮬레이션 미실행'));assert.ok(out.includes('결과가 없다는 뜻이 아닙니다.'));
});
test('MOC export preserves original sparse pages and separately reports extraction failure',()=>{
 const out=autoPacketMarkdown({...done,automationError:'MOC interruption',document:{coverage:{totalPages:43,retainedPages:[1,42,43],omittedPages:[2,3],noTextPages:[]}}});
 assert.ok(out.includes('1, 42, 43'));assert.ok(out.includes('MOC interruption'));assert.ok(out.includes('독립 검증하지 않았습니다.'));
});
test('MOC export keeps class denominator separate from overall denominator and preserves annotations',()=>{
 const out=autoPacketMarkdown({...done,registryResults:{sourceUrl:'MOC',snapshotDigest:'a'.repeat(64),notice:'MOC',limited:false,safety:[],outcomes:[{title:'MOC',groupTitle:'MOC',groupId:'OG0',value:'2',unit:'months',denominators:[{value:'12',unit:'Participants'}],denominatorScope:'CLASS',overallDenominators:[{value:'41',unit:'Participants'}],spread:'0.5',comment:'MOC annotation',locator:'/MOC/class'}]}});
 for(const text of ['보고 분모: 12 Participants','분모 범위: 하위 항목별','전체 분모(참고·대체하지 않음): 41 Participants','산포값: 0.5','원문 주석: MOC annotation'])assert.ok(out.includes(text),text);
});
test('MOC registry export keeps pooled group context, zero counts and original pointer',()=>{
 const out=autoPacketMarkdown({...done,registryResults:{sourceUrl:'https://clinicaltrials.gov/study/NCT00000001',snapshotDigest:'a'.repeat(64),notice:'MOC grouped data',limited:false,outcomes:[{title:'MOC ORR',groupTitle:'MOC pooled',groupId:'OG0',groupDescription:'10 mg or 20 mg',population:'MOC single cohort',window:'Week 12',definition:'MOC response',classTitle:'',categoryTitle:'',parameter:'NUMBER',dispersion:'95% CI',lower:'1',upper:'3',value:'2',unit:'percentage of participants',denominators:[{value:'41',unit:'Participants'}],locator:'/MOC/original'}],safety:[{groupTitle:'MOC safety',groupId:'EG0',groupDescription:'MOC dose',metric:'serious adverse events',affected:0,atRisk:21,window:'Week 12',description:'MOC original',locator:'/MOC/safety'}]}});
 for(const text of ['MOC pooled','MOC single cohort','41 Participants','/MOC/original','0 / 21','용량별로 분할하지'])assert.ok(out.includes(text),text);
});
