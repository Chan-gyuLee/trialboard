import test from 'node:test';
import assert from 'node:assert/strict';
import {researchTelemetry,readResearchStream,coverageStopLabel} from '../src/research.ts';
import {researchProgress,contentLabel} from '../src/research-progress.ts';
import {replayEvents} from '../src/activity-model.ts';
const id='00000000-0000-4000-8000-000000000001';
const inventory={total:2,REGISTRY_TEXT:0,ABSTRACT:1,METADATA:0,PDF_AVAILABLE:1};
const card={id:'paper_123',title:'MOC paper',kind:'PAPER',url:'https://pubmed.ncbi.nlm.nih.gov/123/',content_level:'ABSTRACT',link_basis:['DRUG_SEARCH']};
const event=(stage,sequence,extra={})=>({run_id:id,stage,sequence,elapsed_ms:sequence*100,message:'MOC event',...extra});
test('bounded page receipts retain the stop reason in live and replay data',()=>{
 const coverage={channel:'PMC',query:'MOC',status:'FAILED',total:55,fetched:20,limited:true,pages:1,stop_reason:'REQUEST_FAILED'};
 const e=event('GAP',1,{coverage});
 assert.deepEqual(researchTelemetry(e).coverage,coverage);
 assert.deepEqual(replayEvents({id,events:[e]})[0].research.coverage,coverage);
 assert.match(coverageStopLabel(coverage),/보존/);
 for(const patch of [{pages:3},{pages:-1},{pages:1.5},{stop_reason:'ALL_PAPERS_VERIFIED'},{stop_reason:'toString'}])assert.throws(()=>researchTelemetry({...e,coverage:{...coverage,...patch}}));
 assert.doesNotThrow(()=>researchTelemetry({...e,coverage:{...coverage,pages:null,stop_reason:null}}));
});
test('telemetry distinguishes stored source counts from model inputs and PDF links',()=>{
 const e=event('SOURCE',2,{inventory,sources:[card],input_sources:['paper_123'],anchor_count:3});
 const detail=researchTelemetry(e);assert.deepEqual(detail.inventory,inventory);assert.equal(detail.input_sources.length,1);
 assert.equal(detail.sources[0].content_level,'ABSTRACT');assert.match(contentLabel('PDF_AVAILABLE'),/미검토/);
});
test('reject forged counts, oversized inputs, unsafe source URLs and malformed receipts',()=>{
 for(const extra of [{inventory:{...inventory,total:99}},{inventory:{...inventory,ABSTRACT:-1}},{input_sources:['a','a']},{input_sources:Array.from({length:101},(_,i)=>String(i))},{sources:[{...card,url:'https://evil.test/'}]},{sources:[{...card,content_level:'FULL_TEXT_VERIFIED'}]},{coverage:{channel:'PMC',query:'MOC',status:'OK',total:1,fetched:2,limited:false}},{anchor_count:-1}])assert.throws(()=>researchTelemetry(event('SOURCE',2,extra)));
});
test('new telemetry survives replay only at its recorded time; old events do not gain details',()=>{
 const es=[event('SEARCH',1,{query:'MOC',channel:'PMC'}),event('SOURCE',2,{sources:[card],inventory})];
 const collection={id,events:es};
 assert.equal(researchProgress(replayEvents(collection).slice(0,1)).inventory,undefined);
 assert.equal(researchProgress(replayEvents(collection)).artifacts.sources.length,1);
 assert.equal(replayEvents({id,events:[event('SOURCE',1,{sources:[{...card,url:'javascript:alert(1)'}]})]})[0].research.sources,undefined);
 assert.equal(replayEvents({id,events:[event('SOURCE',1)]})[0].research.inventory,undefined);
});
test('parallel requests retain individual receipts; totals are never summed',()=>{
 const es=[event('SEARCH',1,{channel:'PMC',query:'drug'}),event('SEARCH',2,{channel:'PMC',query:'NCT'}),event('SOURCE',3,{channel:'PMC',query:'NCT',coverage:{channel:'PMC',query:'NCT',status:'OK',total:23,fetched:20,limited:true}}),event('SOURCE',4,{channel:'PMC',query:'drug',coverage:{channel:'PMC',query:'drug',status:'FAILED',total:null,fetched:0,limited:false}})];
 const state=researchProgress(es.map(research=>({stage:'RESEARCH',research})));
 assert.equal(state.requests.length,2);assert.equal(state.requests.find(r=>r.query==='NCT').receipt.total,23);
 assert.equal(state.requests.find(r=>r.query==='drug').receipt.status,'FAILED');assert.equal(state.inventory,undefined);
});
test('live stream fails closed on invalid receipt',async()=>{
 const es=[event('STARTED',1),event('SOURCE',2,{inventory:{...inventory,total:0}}),event('COMPLETE',3)];
 await assert.rejects(readResearchStream(new Response(es.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}}),()=>{}));
});
test('a repeated search keeps both attempts and does not inherit an old success',()=>{
 const receipt={channel:'PMC',query:'MOC',status:'OK',total:1,fetched:1,limited:false};
 const es=[event('SEARCH',1,{channel:'PMC',query:'MOC'}),event('SOURCE',2,{channel:'PMC',query:'MOC',coverage:receipt}),event('SEARCH',3,{channel:'PMC',query:'MOC'})];
 const state=researchProgress(es.map(research=>({stage:'RESEARCH',research})));
 assert.equal(state.requests.length,2);assert.equal(state.requests[0].receipt,undefined);assert.equal(state.requests[1].receipt.status,'OK');
});
