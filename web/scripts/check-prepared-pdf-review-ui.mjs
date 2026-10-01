// Actual TEAM-context components, synthetic intercepted API; no real parser or model.
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../../video/node_modules/playwright/index.mjs';
import {canonical,digest} from '../src/field-review.ts';
import {serverPdfLimits} from '../src/server-pdf-preparation.ts';
const output=await mkdtemp(join(tmpdir(),'trialboard-pdf-review-ui-'));
const run='12345678-1234-4234-8234-123456789012',pid='22345678-1234-4234-8234-123456789012',aid='32345678-1234-4234-8234-123456789012';
const content={schema:'research-pdf-preparation/1',mode:'SERVER_PDF_TEXT_ONLY',run_id:run,preparation_id:pid,source_id:'paper:synthetic',source_digest:'a'.repeat(64),pdf_sha256:'b'.repeat(64),policy_revision:1,asserted_by:run,created_at:'2026-10-01T00:00:00Z',extractor:'pdfplumber/synthetic',pages:[{page:1,text:'합성 PDF 원문 🧪 대상 집단과 관찰 조건을 함께 확인합니다.'}],limits:serverPdfLimits,model_calls:0,verification:'SERVER_EXTRACTED_NOT_CLINICALLY_VERIFIED',notices:['합성 자료입니다.']};
const prepared={...content,preparation_digest:await digest(canonical(content))};
const anchor={preparation_digest:prepared.preparation_digest,page:1,start:0,end:Array.from(content.pages[0].text).length};
const finding={anchor_id:await digest(canonical(anchor)),page:1,start:0,end:anchor.end,quote:content.pages[0].text,interpretation:'원문에 명시한 관찰 조건을 전문가가 확인해야 합니다.'};
const summary={run_id:run,attempt_id:aid,status:'COMPLETED',created_at:content.created_at,completed_at:'2026-10-01T00:00:01Z',model_calls:1};
const result={...summary,schema:'research-pdf-review/1',mode:'PREPARED_PDF_REVIEW_ONLY',asserted_by:run,preparation_id:pid,preparation_digest:prepared.preparation_digest,source_id:prepared.source_id,source_digest:prepared.source_digest,pdf_sha256:prepared.pdf_sha256,policy_revision:2,execution_mode:'SCRIPTED_TEST_DOUBLE',model:'synthetic',response_id:'synthetic',input_tokens:4,output_tokens:6,review:{findings:[finding],questions:['관찰 조건의 근거를 추가로 확인할까요?'],conclusion:'NEEDS_EXPERT_REVIEW'},error_code:null,notices:['임상 검증이 아닌 합성 시험 결과입니다.']};
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disk-cache-size=1048576']});
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let writes=0,complete=false,revoke=false,badQuote=false,delay=false,release=null,unfinished=false,viewer=false,sourceUsage=0;
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;let data={},status=200;
  if(path==='/api/access-mode')data={mode:'team',tls:false,production_ready:false};
  else if(path==='/api/auth/session')data={authenticated:true,subject:{id:run,username:'합성 검토자'},team:{id:run,name:'PDF 검토 QA'},role:viewer?'viewer':'reviewer',permission_epoch:1,absolute_expires_at:Math.floor(Date.now()/1000)+28800,idle_expires_at:Math.floor(Date.now()/1000)+1800,session_context:'c'.repeat(64)};
  else if(path==='/api/auth/csrf')data={csrf_token:'d'.repeat(43)};
  else if(path.endsWith('/pdf-review-attempts')){assert.equal(url.searchParams.get('preparation_id'),pid);data={run_id:run,preparation_id:pid,attempts:unfinished?[{...summary,status:'RUNNING',completed_at:null,model_calls:0}]:complete?[summary]:[]};}
  else if(path.endsWith(`/pdf-review-attempts/${aid}`)){
   if(revoke){status=403;data={detail:'BLOCKED'};}else data=badQuote?{...result,review:{...result.review,findings:[{...finding,quote:'만들어낸 인용문'}]}}:result;
  }else if(path.endsWith('/pdf-review-usage')){
   const empty={observed_model_calls:0,observed_input_tokens:0,observed_output_tokens:0,input_unknown_attempts:0,output_unknown_attempts:0};
   data={schema:'research-pdf-review-usage/1',scope:'PREPARED_PDF_REVIEW_ONLY',run_id:run,as_of:content.created_at,attempts_total:unfinished?2:complete?1:0,completed_attempts:complete?1:0,failed_attempts:0,cancelled_attempts:0,unfinished_attempts:unfinished?1:0,usage_by_mode:{DACON_RESPONSES:empty,SCRIPTED_TEST_DOUBLE:complete?{...empty,observed_model_calls:1,observed_input_tokens:4,observed_output_tokens:6}:empty,COLLECTORS_ONLY:empty}};
  }else if(path.endsWith('/review-usage')){sourceUsage++;status=500;}
  else if(path.endsWith('/review-prepared-pdf')){
   writes++;assert.deepEqual(req.postDataJSON(),{model_consent:true,preparation_id:pid,preparation_digest:prepared.preparation_digest,policy_revision:2});
   if(writes===1){status=409;data={detail:'PDF_POLICY_VERSION_CONFLICT'};}else{
    if(delay)await new Promise(resolve=>{release=resolve;});complete=true;
    const event=(sequence,type)=>({schema:'research-pdf-review-event/1',run_id:run,attempt_id:aid,sequence,type,message:'합성 상태'});
    await route.fulfill({status:200,contentType:'text/event-stream',body:[event(1,'STARTED'),event(2,'COMPLETE')].map(e=>`data: ${JSON.stringify(e)}\n\n`).join('')});return;
   }
  }else if(path.endsWith('/runs')||path.endsWith('/searches'))data=[];
  else if(path.endsWith('/capabilities'))data={enabled:false};else status=404;
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:5173');
 await page.evaluate(async prepared=>{
  const r=await import('/node_modules/.vite/deps/react.js'),React=r.default??r;
  const d=await import('/node_modules/.vite/deps/react-dom_client.js'),createRoot=(d.default??d).createRoot;
  const mui=await import('/node_modules/.vite/deps/@mui_material.js'),{theme}=await import('/src/theme.ts');
  const code=await(await fetch('/src/PreparedPdfReview.tsx')).text(),url=code.match(/from "([^\"]*\/AccessShell\.tsx[^\"]*)"/)[1];
  const {default:AccessShell}=await import(url),{default:Component}=await import('/src/PreparedPdfReview.tsx');
  document.querySelector('#root')?.remove();const container=document.createElement('div');container.id='pdf-review-qa';document.body.append(container);const root=createRoot(container);
  window.pdfReviewRender=(extra={},shellKey='reviewer')=>root.render(React.createElement(React.StrictMode,{},React.createElement(mui.ThemeProvider,{theme},React.createElement(AccessShell,{key:shellKey},key=>React.createElement('main',{key,style:{padding:16,maxWidth:1000,margin:'auto'}},React.createElement(Component,{prepared,policyRevision:2,externalAllowed:false,disabled:false,...extra}))))));
  window.pdfReviewRender();
 },prepared);
 const root=page.locator('#pdf-review-qa'),runButton=root.getByRole('button',{name:'이 준비본 검토 · AI 1회',exact:true}),consent=root.getByRole('checkbox',{name:/한 번 보내는 데 동의/});
 await root.getByRole('region',{name:'PDF 본문 검토 사용량'}).getByText('대회 API 관측 기록',{exact:true}).waitFor();
 assert(await runButton.isDisabled());assert(await consent.isDisabled());assert.equal(writes,0);
 await page.evaluate(()=>window.pdfReviewRender({externalAllowed:true}));
 assert(await runButton.isDisabled());await consent.check();await runButton.click();
 await root.getByText(/준비본·이용조건이 바뀌었거나/).waitFor();assert.equal(writes,1);
 await root.getByRole('button',{name:'PDF 검토 기록 새로고침',exact:true}).click();await page.waitForTimeout(100);assert(!await consent.isChecked());
 await consent.check();await runButton.click();await root.getByRole('region',{name:'PDF AI 검토 결과'}).waitFor();
 assert.equal(writes,2);assert(!await consent.isChecked());assert.equal(await root.getByText(finding.quote,{exact:true}).count(),1);
 await page.screenshot({path:join(output,`result-${width}.png`),fullPage:true});
 await root.locator('summary').filter({hasText:'이 준비본의 검토 기록'}).click();
 badQuote=true;await root.getByRole('button',{name:/검토 완료.*호출 1회/}).click();
 await root.getByRole('alert').filter({hasText:/인용|준비본/}).waitFor();assert.equal(await root.getByRole('region',{name:'PDF AI 검토 결과'}).count(),0);
 badQuote=false;revoke=true;await root.getByRole('button',{name:/검토 완료.*호출 1회/}).click();
 await root.getByText('현재 PDF 권한 또는 이용조건으로 이 결과를 볼 수 없습니다.',{exact:true}).waitFor();assert.equal(await root.getByText(finding.quote,{exact:true}).count(),0);
 revoke=false;delay=true;await consent.check();await runButton.click();
 for(let i=0;i<50&&!release;i++)await page.waitForTimeout(20);assert(release);
 await root.getByRole('button',{name:'PDF 검토 대기 중단',exact:true}).click();release();await page.waitForTimeout(100);
 assert.equal(await root.getByRole('region',{name:'PDF AI 검토 결과'}).count(),0);assert.equal(writes,3);
 unfinished=true;await root.getByRole('button',{name:'PDF 검토 기록 새로고침',exact:true}).click();
 await root.getByText(/종료 기록이 없는 요청은/).waitFor();assert.equal(await root.getByRole('button',{name:/종료 기록 없음.*호출 수 미확정/}).count(),1);
 await root.getByText(/종료 기록 없는 1건은/).waitFor();assert.equal(sourceUsage,0);
 viewer=true;await page.evaluate(()=>window.pdfReviewRender({externalAllowed:true},'viewer'));
 await root.getByText('읽기 전용입니다. 검토 실행은 검토자 또는 팀 관리자만 할 수 있습니다.',{exact:true}).waitFor();
 assert(await consent.isDisabled());assert(await runButton.isDisabled());assert.equal(writes,3);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({width,writes,strictMode:true,explicitConsent:true,scopeSeparated:true,forgedQuoteRejected:true,revocationCleared:true,cancelLateIgnored:true,unfinishedUnknown:true,viewerReadOnly:true,overflow:false,pageerrors:errors}));await page.close();
}}finally{await browser.close();}
console.log(JSON.stringify({output}));
