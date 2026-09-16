import test from 'node:test';
import assert from 'node:assert/strict';
import {auditSourceLinkage,linkageMarkdown} from '../src/research-linkage.ts';
const nct='NCT00000001';
const source={id:'paper_1',kind:'PAPER',title:'MOC paper',text:'MOC abstract.',content_level:'ABSTRACT',link_basis:['DRUG_SEARCH'],identifiers:{},digest:'a'.repeat(64)};
const audit=(patch={})=>auditSourceLinkage({...source,...patch},nct);

for(const [name,patch,status] of [
 ['selected text',{text:'MOC NCT00000001 cohort'},'SELECTED_MENTION'],
 ['multiple trials',{text:'MOC NCT00000001 and NCT00000002'},'MULTIPLE_TRIALS'],
 ['only other trial',{text:'MOC NCT00000002'},'OTHER_TRIAL'],
 ['no identity from search',{link_basis:['NCT_SEARCH','AI_FOLLOWUP']},'UNRESOLVED'],
 ['registry document',{kind:'PROTOCOL',content_level:'PDF_AVAILABLE',link_basis:['REGISTRY_DOCUMENT']},'REGISTRY_LINK'],
 ['registry result reference',{link_basis:['REGISTRY_REFERENCE_RESULT']},'REGISTRY_LINK'],
 ['background citation is not study result',{link_basis:['REGISTRY_REFERENCE_BACKGROUND']},'UNRESOLVED'],
 ['drug regulator even with selected NCT',{kind:'REGULATORY',text:'MOC NCT00000001'},'DRUG_LEVEL'],
 ['derived bibliography is not study identity',{link_basis:['REGISTRY_REFERENCE_DERIVED']},'UNRESOLVED'],
])test(`scope classification: ${name}`,()=>{const a=audit(patch);assert.equal(a.status,status);assert.equal(a.clinicalVerified,false);assert.equal(a.sourceDigest,source.digest);assert.ok(a.questions.length);});

test('exact boundaries, case, deduplication and original quote preservation',()=>{
 const text='MOC nct00000001, NCT00000001; xNCT00000002 NCT000000013 NCT00000004x';
 const a=audit({text});assert.deepEqual(a.mentionedNcts,[nct]);
 assert.ok(a.quotes.every(q=>q.field==='text'&&text.includes(q.quote)));
 assert.ok(a.quotes.some(q=>q.quote.includes('nct00000001')));
});
test('title-only mention remains unverified with its precise field',()=>{
 const a=audit({title:'MOC NCT00000001'});assert.equal(a.selectedMention,true);
 assert.equal(a.quotes[0].field,'title');assert.equal(a.clinicalVerified,false);
});
test('negation is not treated as verified identity',()=>{
 const a=audit({text:'This is NOT the NCT00000001 population.'});assert.equal(a.status,'SELECTED_MENTION');
 assert.equal(a.clinicalVerified,false);assert.ok(a.questions.some(q=>q.includes('분석집단')));
});
test('pooled/subgroup/dose expansion signals carry exact evidence and questions',()=>{
 const text='MOC pooled safety analysis. Subgroups and dose-expansion cohort.';
 const a=audit({text});assert.equal(a.cohortSignals.length,3);
 assert.ok(a.quotes.every(q=>text.includes(q.quote)));assert.ok(a.questions.some(q=>q.includes('환자 중복')));
});
test('no keyword is not proof of homogeneous population',()=>{
 const a=audit();assert.equal(a.cohortSignals.length,0);assert.equal(a.clinicalVerified,false);
 assert.match(linkageMarkdown([source],nct),/동일성 보장 아님/);
});
test('other NCT in a drug-level document still generates a conflicting-trial question',()=>{
 const a=audit({kind:'REGULATORY',text:'MOC NCT00000002'});
 assert.equal(a.status,'DRUG_LEVEL');assert.ok(a.questions.some(q=>q.includes('NCT00000002')));
});
test('quotes bounded, source unchanged, deterministic result and no query/url contamination',()=>{
 const s={...source,text:Array.from({length:30},(_,i)=>`NCT${String(i+1).padStart(8,'0')}`).join(' '),url:'https://example.test/NCT99999999',link_basis:['NCT_SEARCH'],identifiers:{search:'NCT88888888'}};
 const before=structuredClone(s),a=auditSourceLinkage(s,nct);
 assert.equal(a.quotes.length,10);assert.equal(a.mentionedNcts.length,30);assert.deepEqual(a,auditSourceLinkage(s,nct));assert.deepEqual(s,before);
 assert.ok(a.quotes.every(q=>q.quote.length<=146));
});
test('invalid selected NCT rejected',()=>{for(const id of ['abc','NCT1','NCT000000011','nct00000001'])assert.throws(()=>auditSourceLinkage(source,id));});
test('export includes source hash, evidence scope and verification disclaimer',()=>{
 const md=linkageMarkdown([{...source,text:'MOC NCT00000002 cohort'}],nct);
 assert.match(md,/다른 NCT만 발견/);assert.match(md,/새 AI 실행/);assert.match(md,/동일 코호트 검증이 아닙니다/);assert.ok(md.includes(source.digest));
});
