import test from 'node:test';
import assert from 'node:assert/strict';
import {checkPdfInput} from '../src/pdf-input-check.ts';
const input=(texts)=>({asset:'MOC drug',study:'NCT00000001',indication:'MOC',question:'MOC',spans:texts.map((text,i)=>({id:`p${i}`,page:1,text}))});
test('reports literal signals, never clinical approval or input mutation',()=>{
 const i=input(['MOC drug NCT00000001','N = 10; response rate 30% at 6 months']);const before=structuredClone(i),r=checkPdfInput(i);
 assert.ok(r.checks.every(c=>c.found));assert.equal(r.clinicalApproval,false);assert.deepEqual(i,before);assert.equal(r.spanCount,2);
});
test('does not replace missing trial with requested context or manufacture aliases',()=>{
 const r=checkPdfInput(input(['MOC brand NCT00000002']));assert.equal(r.checks[0].found,false);assert.equal(r.checks[1].found,false);assert.deepEqual(r.ncts,['NCT00000002']);
});
test('split table unit flags context without adding a percent or numerator',()=>{
 const i=input(['Objective response rate, %','36 (28, 45)','N = 124']);const r=checkPdfInput(i),rate=r.checks.find(c=>c.id==='rate');
 assert.equal(rate.found,false);assert.match(rate.detail,/별도 문구/);assert.deepEqual(rate.spanIds,['p0']);assert.equal(i.spans[1].text,'36 (28, 45)');
});
test('count evidence does not require a percentage to be valid',()=>{
 const r=checkPdfInput(input(['3 events among 10 patients']));assert.equal(r.checks.find(c=>c.id==='denominator').found,true);assert.match(r.checks.find(c=>c.id==='rate').detail,/사건 수/);
});
test('confidence level in a table header is not counted as an observed rate',()=>{
 for(const text of ['ORR, % (95% CI)','95% confidence interval','CI: 95%','95％ 신뢰구간']) {
  const rate=checkPdfInput(input([text,'36 (28, 45)'])).checks.find(c=>c.id==='rate');
  assert.equal(rate.found,false,text);assert.match(rate.detail,/별도 문구/);
 }
 assert.equal(checkPdfInput(input(['ORR 36% (95% CI 28–45)'])).checks.find(c=>c.id==='rate').found,true);
});
test('trial boundaries and casing, duplicate mentions and multiple trials',()=>{
 const r=checkPdfInput(input(['XNCT00000001 NCT000000011','nct00000002 NCT00000002 NCT00000003']));
 assert.equal(r.checks[0].found,false);assert.deepEqual(r.ncts,['NCT00000002','NCT00000003']);
 assert.equal(checkPdfInput(input(['nct00000001'])).checks[0].found,true);
});
test('empty selection stays unknown; byte count is UTF-8, not a readiness score',()=>{
 const empty=checkPdfInput(input([]));assert.ok(empty.checks.every(c=>!c.found));assert.equal(empty.textBytes,0);
 const r=checkPdfInput(input(['자료마감']));assert.equal(r.textBytes,12);assert.equal(r.checks.find(c=>c.id==='time').found,true);
});
