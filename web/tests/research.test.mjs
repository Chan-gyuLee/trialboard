import test from 'node:test';
import assert from 'node:assert/strict';
import {readResearchResult,readResearchStream,safeSourceUrl,researchMarkdown,researchFindingWarnings} from '../src/research.ts';
const id='00000000-0000-4000-8000-000000000001';
const source={id:'paper_123',kind:'PAPER',title:'MOC paper',url:'https://pubmed.ncbi.nlm.nih.gov/123/',text:'MOC exact quote. Not clinical data.',content_level:'ABSTRACT',link_basis:['REGISTRY_REFERENCE_BACKGROUND'],identifiers:{PMID:'123'},published:null,fetched_at:'2026-09-15T00:00:00Z',digest:'a'.repeat(64),pdf_url:null,raw_snapshots:['b'.repeat(64)]};
const fixture=()=>({collection:{id,project_id:'c'.repeat(64),created_at:'2026-09-15T00:00:00Z',status:'COMPLETE',execution_mode:'SCRIPTED_TEST_DOUBLE',request:{search_id:id,nct_id:'NCT00000001',asset:'MOC',indication:'MOC condition',model_consent:true},sources:[structuredClone(source)],coverage:[{channel:'MOC',query:'MOC',status:'OK',fetched:1,total:1,limited:false}],events:[],calls:[],notices:['MOC'],plan:{followup_terms:[],priorities:[{source_id:'paper_123',reason:'MOC reason'}],missing_evidence:[]},review:{findings:[{source_id:'paper_123',quote:'MOC exact quote.',interpretation:'MOC interpretation'}],questions:['MOC question?'],conclusion:'NEEDS_EXPERT_REVIEW'}},changes:{previous_id:null,added:[],changed:[],not_retrieved:[]}});
test('AI mentions of trial without source-text NCT get explicit linkage warning',()=>{const finding={source_id:source.id,quote:'MOC exact quote.',interpretation:'NCT00000001 MOC analysis'};assert.equal(researchFindingWarnings(finding,source,'NCT00000001').length,1);assert.equal(researchFindingWarnings(finding,{...source,text:'NCT00000001 MOC text'},'NCT00000001').length,0);assert.equal(researchFindingWarnings(finding,{...source,content_level:'PDF_AVAILABLE'},'NCT00000001').length,2);});
test('source-linked collection preserves MOC mode, abstract limits and exact citations',()=>{const f=fixture();assert.deepEqual(JSON.parse(JSON.stringify(readResearchResult(JSON.stringify(f)))),f);const md=researchMarkdown(f.collection);assert.match(md,/ABSTRACT/);assert.match(md,/BACKGROUND/);assert.match(md,/MOC exact quote/);});
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
