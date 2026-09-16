import test from 'node:test';
import assert from 'node:assert/strict';
import {validateResearchResume} from '../src/research-resume.ts';
const id='12345678-1234-1234-1234-123456789012',nct='NCT00000001';
const context={receiptId:id,study:nct,asset:'MOC drug',indication:'MOC cancer',question:'MOC'};
const receipt={id,query:'MOC',created_at:'2026-09-16T00:00:00Z',digest:'a'.repeat(64),mode:'LIVE_PUBLIC',clinical_verified:false,total_count:1,fetched_count:1,truncated:false,studies:[{nct_id:nct,url:`https://clinicaltrials.gov/study/${nct}`,title:'MOC',conditions:['MOC cancer'],phases:[],status:'MOC',updated:null,sponsor:null,enrollment:null,interventions:[],arms:[],primary_outcomes:[],documents:[],results_available:false}]};
const c={id,created_at:receipt.created_at,request:{search_id:id,nct_id:nct,asset:'MOC drug',indication:'MOC cancer',model_consent:false},status:'COMPLETE',execution_mode:'COLLECTORS_ONLY',calls:[],notices:[],events:[],coverage:[],sources:[{id:'paper_1',kind:'PAPER',title:'MOC paper',text:'MOC',url:'https://pubmed.ncbi.nlm.nih.gov/123/',pdf_url:null,digest:'a'.repeat(64),link_basis:[],content_level:'ABSTRACT',fetched_at:receipt.created_at,published:null,identifiers:{},raw_snapshots:[]}],plan:null,review:null};
const research={collection:c,changes:{previous_id:null,added:[],changed:[],not_retrieved:[]}};
const doc={...context,document:{runId:id,sourceId:'paper_1',title:'MOC paper'}};
test('return to exact collection and document does not trigger a search',()=>{
 const r=validateResearchResume(doc,receipt,JSON.stringify(research));assert.equal(r.result.collection.sources[0].id,'paper_1');assert.equal(r.receipt.id,id);
 assert.equal(validateResearchResume(context,receipt).result,null);
});
for(const [name,change] of [
 ['receipt',x=>x.receiptId='00000000-0000-0000-0000-000000000000'],['trial',x=>x.study='NCT00000002'],['condition',x=>x.indication='wrong'],['drug',x=>x.asset='wrong'],['run',x=>x.document.runId='wrong'],['source',x=>x.document.sourceId='wrong'],['title',x=>x.document.title='wrong'],
])test(`reject wrong ${name} before replacing state`,()=>{const d=structuredClone(doc);change(d);assert.throws(()=>validateResearchResume(d,receipt,JSON.stringify(research)));});
test('missing research record is not silently ignored',()=>assert.throws(()=>validateResearchResume(doc,receipt)));
