import test from 'node:test';
import assert from 'node:assert/strict';
import {readResearchResult,readResearchStream,safeSourceUrl,researchMarkdown,researchFindingWarnings} from '../src/research.ts';
const id='00000000-0000-4000-8000-000000000001';
const source={id:'paper_123',kind:'PAPER',title:'MOC paper',url:'https://pubmed.ncbi.nlm.nih.gov/123/',text:'MOC exact quote. Not clinical data.',content_level:'ABSTRACT',link_basis:['REGISTRY_REFERENCE_BACKGROUND'],identifiers:{PMID:'123'},published:null,fetched_at:'2026-09-15T00:00:00Z',digest:'a'.repeat(64),pdf_url:null,raw_snapshots:['b'.repeat(64)]};
const fixture=()=>({collection:{id,project_id:'c'.repeat(64),created_at:'2026-09-15T00:00:00Z',status:'COMPLETE',execution_mode:'SCRIPTED_TEST_DOUBLE',request:{search_id:id,nct_id:'NCT00000001',asset:'MOC',indication:'MOC condition',model_consent:true},sources:[structuredClone(source)],coverage:[{channel:'MOC',query:'MOC',status:'OK',fetched:1,total:1,limited:false}],events:[],calls:[],notices:['MOC'],plan:{followup_terms:[],priorities:[{source_id:'paper_123',reason:'MOC reason'}],missing_evidence:[]},review:{findings:[{source_id:'paper_123',quote:'MOC exact quote.',interpretation:'MOC interpretation'}],questions:['MOC question?'],conclusion:'NEEDS_EXPERT_REVIEW'}},changes:{previous_id:null,added:[],changed:[],not_retrieved:[]}});
test('AI mentions of trial without source-text NCT get explicit linkage warning',()=>{const finding={source_id:source.id,quote:'MOC exact quote.',interpretation:'NCT00000001 MOC analysis'};assert.equal(researchFindingWarnings(finding,source,'NCT00000001').length,1);assert.equal(researchFindingWarnings(finding,{...source,text:'NCT00000001 MOC text'},'NCT00000001').length,0);assert.equal(researchFindingWarnings(finding,{...source,content_level:'PDF_AVAILABLE'},'NCT00000001').length,2);});
test('source-linked collection preserves MOC mode, abstract limits and exact citations',()=>{const f=fixture();assert.deepEqual(JSON.parse(JSON.stringify(readResearchResult(JSON.stringify(f)))),f);const md=researchMarkdown(f.collection);assert.match(md,/ABSTRACT/);assert.match(md,/BACKGROUND/);assert.match(md,/MOC exact quote/);});
test('collection reads explicit raw storage scopes without inventing them for historical requests',()=>{
 const old=readResearchResult(JSON.stringify(fixture()));assert.equal(old.collection.request.raw_storage_permissions,undefined);
 const p={collector:'REGISTRY',original_storage:'ALLOW',evidence_reference:'Synthetic permission',reason:'Synthetic only'},f=fixture();
 f.collection.request.raw_storage_permissions=[p];assert.deepEqual(JSON.parse(JSON.stringify(readResearchResult(JSON.stringify(f)).collection.request.raw_storage_permissions)),[p]);
 for(const permissions of [[p,p],[{...p,external_ai:'ALLOW'}],[{...p,original_storage:'DENY'}],[{...p,collector:'ALL'}],null]){f.collection.request.raw_storage_permissions=permissions;assert.throws(()=>readResearchResult(JSON.stringify(f)));}
});
test('collection raw references match the server per-source 100-bound while rejecting duplicates',()=>{
 const f=fixture();f.collection.sources[0].raw_snapshots=Array.from({length:100},(_,i)=>i.toString(16).padStart(64,'0'));
 assert.equal(readResearchResult(JSON.stringify(f)).collection.sources[0].raw_snapshots.length,100);
 f.collection.sources[0].raw_snapshots.push('f'.repeat(64));assert.throws(()=>readResearchResult(JSON.stringify(f)));
 f.collection.sources[0].raw_snapshots=[source.raw_snapshots[0],source.raw_snapshots[0]];assert.throws(()=>readResearchResult(JSON.stringify(f)));
});
const currentFixture=(status='OK')=>{const f=fixture(),query='TITLE_ABS:"MOC" AND (adverse discontinuation) AND SRC:MED';f.collection.plan={followups:[{term:'adverse discontinuation',intent:'CONTRARIAN'}],priorities:[{source_id:'paper_123',reason:'MOC reason'}],missing_evidence:[]};f.collection.coverage.push({channel:'Europe PMC / PubMed',query,status,fetched:status==='OK'?1:0,total:status==='FAILED'?null:status==='EMPTY'?0:1,limited:false});f.collection.followup_executions=[{term:'adverse discontinuation',intent:'CONTRARIAN',origin:'MODEL',query,coverage_index:1,status,attempted:status!=='SKIPPED'}];return f;};
test('current records bind contrarian intent to the actual query and coverage',()=>{const f=currentFixture();assert.deepEqual(JSON.parse(JSON.stringify(readResearchResult(JSON.stringify(f)).collection.followup_executions)),f.collection.followup_executions);assert.match(researchMarkdown(f.collection),/실패·유해·중단 신호 탐색: OK \/ 질의 시도/);});
test('failed followup remains an attempted failure, not successful retrieval',()=>{const f=currentFixture('FAILED');assert.equal(readResearchResult(JSON.stringify(f)).collection.followup_executions[0].status,'FAILED');assert.match(researchMarkdown(f.collection),/FAILED \/ 질의 시도/);});
test('legacy plans remain readable without invented contrarian provenance',()=>{const f=fixture();assert.match(researchMarkdown(readResearchResult(JSON.stringify(f)).collection),/구조화된 의도·실행 provenance 없음/);});
for(const [name,mutate] of [
 ['mislabeled intent',f=>f.collection.plan.followups[0].intent='EVIDENCE_GAP'],
 ['query mismatch',f=>f.collection.followup_executions[0].query='TITLE_ABS:"MOC" AND (positive) AND SRC:MED'],
 ['coverage mismatch',f=>f.collection.followup_executions[0].status='EMPTY'],
 ['skipped contrarian claimed complete',f=>{f.collection.coverage[1].status='SKIPPED';f.collection.followup_executions[0].status='SKIPPED';f.collection.followup_executions[0].attempted=false;}],
]) test(`reject current ${name}`,()=>{const f=currentFixture();mutate(f);assert.throws(()=>readResearchResult(JSON.stringify(f)));});
for(const [name,mutate] of [
 ['untrusted URL',f=>f.collection.sources[0].url='http://localhost/'],
 ['duplicate source',f=>f.collection.sources.push(structuredClone(source))],
 ['unsupported citation',f=>f.collection.review.findings[0].quote='Invented'],
 ['unknown priority',f=>f.collection.plan.priorities[0].source_id='nope'],
 ['malformed plan',f=>f.collection.plan.followup_terms={}],
 ['invented approval',f=>f.collection.review.conclusion='APPROVED'],
 ['unknown execution mode',f=>f.collection.execution_mode='MAGIC'],
 ['invalid coverage',f=>f.collection.coverage[0].fetched=-1],
 ['bad date',f=>f.collection.created_at='not date'],
 ['bad snapshot',f=>f.collection.sources[0].raw_snapshots=['invalid']],
 ['bad changes',f=>f.changes.added=null],
 ['bad identifiers',f=>f.collection.sources[0].identifiers={x:{}}],
]) test(`reject ${name}`,()=>{const f=fixture();mutate(f);assert.throws(()=>readResearchResult(JSON.stringify(f)));});
test('approved sources only, no query, fragment, auth, port or path escape',()=>{for(const url of ['https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/a.pdf','https://clinicaltrials.gov/study/NCT00000001'])assert.equal(safeSourceUrl(url),true);for(const url of ['javascript:alert(1)','https://evil.invalid/a.pdf','https://pubmed.ncbi.nlm.nih.gov:9000/123/','https://u@pubmed.ncbi.nlm.nih.gov/123/','https://pubmed.ncbi.nlm.nih.gov/123/?x=1','https://cdn.clinicaltrials.gov/large-docs/01/NCT00000001/../../x.pdf'])assert.equal(safeSourceUrl(url),false);});
const events=()=>['STARTED','SEARCH','SOURCE','COMPLETE'].map((stage,i)=>({run_id:id,sequence:i+1,stage,elapsed_ms:i*100,message:'MOC 실제 상태 테스트'}));
const stream=es=>new Response(es.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
test('ordered bounded SSE returns stored run ID',async()=>{const seen=[];assert.equal(await readResearchStream(stream(events()),e=>seen.push(e)),id);assert.equal(seen.length,4);});
test('split UTF8 and heartbeat streams work',async()=>{const bytes=new TextEncoder().encode(': waiting\n\n'+events().map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));const r=new Response(new ReadableStream({start(c){for(const b of bytes)c.enqueue(Uint8Array.of(b));c.close();}}),{headers:{'content-type':'text/event-stream'}});assert.equal(await readResearchStream(r,()=>{}),id);});
test('reject missing completion, reordered events, cross-run and malformed plans',async()=>{for(const es of [events().slice(0,-1),events().reverse(),events().map((e,i)=>i===2?{...e,run_id:id.replace('0001','0002')}:e),[{...events()[0],stage:'COMPLETE'}],[events()[0],{...events()[1],stage:'AI_PLAN_READY',plan:{}}]])await assert.rejects(readResearchStream(stream(es),()=>{}));});
