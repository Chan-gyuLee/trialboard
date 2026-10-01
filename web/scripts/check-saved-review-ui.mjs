// Synthetic intercepted API only; mounts actual components, never calls a model.
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../../video/node_modules/playwright/index.mjs';

const output=await mkdtemp(join(tmpdir(),'trialboard-saved-review-ui-'));
const run='12345678-1234-4234-8234-123456789012',attempt='22345678-1234-4234-8234-123456789012',digest='a'.repeat(64),sid='paper:synthetic';
const session={authenticated:true,subject:{id:run,username:'Synthetic reviewer'},team:{id:run,name:'Synthetic QA'},role:'reviewer',permission_epoch:1,absolute_expires_at:Math.floor(Date.now()/1000)+28800,idle_expires_at:Math.floor(Date.now()/1000)+1800,session_context:'b'.repeat(64)};
const basePolicy={resource_kind:'SOURCE_TEXT',run_id:run,source_id:sid,source_digest:digest,policy_revision:1,original_storage:'ALLOW',internal_search:'ALLOW',external_ai:'ALLOW',training:'DENY',evidence_reference:'Synthetic permission only',reason:'Synthetic fixture',asserted_by:run,created_at:'2026-10-01T00:00:00Z',verification:'USER_ATTESTED_UNVERIFIED'};
const summary={run_id:run,attempt_id:attempt,status:'COMPLETED',created_at:'2026-10-01T00:00:00Z',completed_at:'2026-10-01T00:00:01Z',model_calls:1};
const quote='합성 공개 자료의 원문 구간입니다.';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disk-cache-size=1048576']});
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let revision=1,writes=0,completed=false,revoke=false,delay=false,release=null,unfinished=false,usageRevoked=false,usageReads=0;
 const artifact=()=>({...summary,schema:'research-saved-review/1',mode:'SAVED_REVIEW_ONLY',asserted_by:run,context:{asset:'합성 약물',indication:'합성 질환',nct_id:'NCT00000001'},source_bindings:[{source_id:sid,source_digest:digest,policy_revision:revision}],sources:[{source_id:sid,source_digest:digest,title:'허가된 합성 출처'}],collector_calls:0,plan_calls:0,execution_mode:'SCRIPTED_TEST_DOUBLE',model:'synthetic',response_id:'fake',input_tokens:10,output_tokens:20,review:{findings:[{source_id:sid,quote,interpretation:'선택한 저장 자료에 한정한 합성 해석입니다.'}],questions:['다음 회의에서 추가 근거를 확인할까요?'],conclusion:'NEEDS_EXPERT_REVIEW'},citation_bindings:[{anchor_id:'synthetic-anchor',source_id:sid,source_digest:digest,start:0,end:Array.from(quote).length,offset_unit:'UNICODE_CODE_POINTS'}],error_code:null,notices:['새 검색과 PDF 다운로드는 실행하지 않았습니다.']});
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let status=200,data={};
  if(path==='/api/access-mode')data={mode:'team',tls:false,production_ready:false};
  else if(path==='/api/auth/session')data=session;
  else if(path==='/api/auth/csrf')data={csrf_token:'c'.repeat(43)};
  else if(path.endsWith('/source-metadata'))data={run_id:run,resource_kind:'SOURCE_TEXT',can_manage:true,sources:[{source_id:sid,source_digest:digest,title:'허가된 합성 출처',usage_policy:{...basePolicy,policy_revision:revision}},{source_id:'paper:denied',source_digest:'d'.repeat(64),title:'허가되지 않은 출처',usage_policy:{...basePolicy,source_id:'paper:denied',source_digest:'d'.repeat(64),external_ai:'DENY'}}]};
  else if(path.endsWith('/review-attempts'))data={run_id:run,attempts:unfinished?[{...summary,status:'RUNNING',completed_at:null,model_calls:0}]:completed?[summary]:[]};
  else if(path.endsWith('/review-usage')){
   usageReads++;
   const empty={observed_model_calls:0,observed_input_tokens:0,observed_output_tokens:0,input_unknown_attempts:0,output_unknown_attempts:0};
   if(usageRevoked){status=403;data={detail:'BLOCKED'};}else data={schema:'research-saved-review-usage/1',scope:'SAVED_REVIEW_ONLY',run_id:run,as_of:'2026-10-01T00:00:00Z',attempts_total:3,completed_attempts:1,failed_attempts:1,cancelled_attempts:0,unfinished_attempts:1,usage_by_mode:{DACON_RESPONSES:{...empty,observed_model_calls:1,input_unknown_attempts:1,output_unknown_attempts:1},SCRIPTED_TEST_DOUBLE:{...empty,observed_model_calls:1,observed_input_tokens:10,observed_output_tokens:20},COLLECTORS_ONLY:empty}};
  }
  else if(path.endsWith(`/review-attempts/${attempt}`)){if(revoke){status=403;data={detail:'BLOCKED'};}else data=artifact();}
  else if(path.endsWith('/review-saved')){
   writes++;const body=req.postDataJSON();assert.deepEqual(Object.keys(body).sort(),['model_consent','source_bindings']);assert.equal(body.model_consent,true);assert.deepEqual(body.source_bindings,[{source_id:sid,source_digest:digest,policy_revision:revision}]);
   if(writes===1){revision=2;status=409;data={detail:'SOURCE_POLICY_VERSION_CONFLICT'};}
   else{
    if(delay)await new Promise(resolve=>{release=resolve;});completed=true;
    const event=(sequence,type)=>({schema:'research-saved-review-event/1',run_id:run,attempt_id:attempt,sequence,type,message:'합성 상태'});
    await route.fulfill({status:200,contentType:'text/event-stream',body:[event(1,'STARTED'),event(2,'COMPLETE')].map(e=>`data: ${JSON.stringify(e)}\n\n`).join('')});return;
   }
  }else if(path.endsWith('/runs')||path.endsWith('/searches'))data=[];
  else if(path.endsWith('/capabilities'))data={enabled:false};else status=404;
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:5173');
 await page.evaluate(async run=>{
  const r=await import('/node_modules/.vite/deps/react.js'),React=r.default??r;
  const d=await import('/node_modules/.vite/deps/react-dom_client.js'),createRoot=(d.default??d).createRoot;
  const mui=await import('/node_modules/.vite/deps/@mui_material.js'),{theme}=await import('/src/theme.ts');
  const code=await(await fetch('/src/SavedResearchReview.tsx')).text(),url=code.match(/from "([^\"]*\/AccessShell\.tsx[^\"]*)"/)[1];
  const {default:AccessShell}=await import(url),{ReviewTools}=await import('/src/ReviewNavigation.tsx');
  document.querySelector('#root')?.remove();const root=document.createElement('div');root.id='saved-review-qa';document.body.append(root);
  createRoot(root).render(React.createElement(mui.ThemeProvider,{theme},React.createElement(AccessShell,{},key=>React.createElement('main',{key,style:{padding:16,maxWidth:1000,margin:'auto'}},React.createElement(ReviewTools,{history:[{id:run,request:{asset:'합성 약물',nct_id:'NCT00000001'},status:'PARTIAL',created_at:'2026-10-01T00:00:00Z'}],disabled:false,onOpen:()=>{},onManual:()=>{}})))));
 },run);
 const root=page.locator('#saved-review-qa');
 await root.getByRole('button',{name:/최근 검토/}).click();
 await root.getByRole('button',{name:'저장 자료로 다시 검토',exact:true}).focus();await page.keyboard.press('Enter');
 const permitted=root.getByRole('checkbox',{name:'허가된 합성 출처',exact:true}),denied=root.getByRole('checkbox',{name:'허가되지 않은 출처',exact:true});
 await permitted.waitFor();assert(await denied.isDisabled());assert.equal(writes,0);
 await root.getByRole('region',{name:'저장 재검토 사용량'}).getByText('대회 API 관측 기록',{exact:true}).waitFor();assert.equal(usageReads,1);
 const consent=()=>root.getByRole('checkbox',{name:/선택한 .*외부 AI/}),runButton=root.getByRole('button',{name:'선택한 자료 검토 · AI 1회',exact:true});
 await permitted.check();assert(await runButton.isDisabled());await consent().check();await runButton.click();
 await root.getByText(/출처 지문·이용조건이 바뀌었거나/).waitFor();assert(await permitted.isChecked());assert.equal(writes,1);
 await root.getByRole('button',{name:'출처·실행 기록 새로고침',exact:true}).click();await permitted.waitFor();await page.waitForTimeout(100);
 assert(!await permitted.isChecked());assert(!await consent().isChecked());
 await permitted.check();await consent().check();await runButton.click();
 await root.getByRole('region',{name:'저장 자료 재검토 결과'}).waitFor();assert.equal(writes,2);assert.equal(await root.getByText(quote,{exact:true}).count(),1);
 assert(!await consent().isChecked());await page.screenshot({path:join(output,`saved-${width}.png`),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 revoke=true;await root.locator('summary').filter({hasText:'재검토 실행 기록'}).click();await root.getByRole('button',{name:/검토 완료.*호출 1회/}).click();
 await root.getByText('현재 이용조건 또는 권한으로 이 결과를 볼 수 없습니다.',{exact:true}).waitFor();assert.equal(await root.getByText(quote,{exact:true}).count(),0);
 revoke=false;delay=true;await consent().check();await runButton.click();
 for(let i=0;i<50&&!release;i++)await page.waitForTimeout(20);assert(release);
 await root.getByRole('button',{name:'대기 중단',exact:true}).click();release();await page.waitForTimeout(100);
 assert.equal(await root.getByText(quote,{exact:true}).count(),0);assert.equal(writes,3);assert.deepEqual(errors,[]);
 unfinished=true;await root.getByRole('button',{name:'출처·실행 기록 새로고침',exact:true}).click();
 await root.getByText(/종료 기록이 없는 요청은/).waitFor();
 assert.equal(await root.getByRole('button',{name:/종료 기록 없음.*호출 수 미확정/}).count(),1);
 assert.equal(await root.getByRole('button',{name:/호출 0회/}).count(),0);assert.equal(writes,3);
 const usage=root.getByRole('region',{name:'저장 재검토 사용량'});
 await usage.getByText('대회 API 관측 기록',{exact:true}).waitFor();
 assert.equal(await usage.getByText(/입력 1건 \/ 출력 1건/).count(),1);
 assert.equal(await usage.getByText(/종료 기록 없는 1건은/).count(),1);
 assert.equal(await usage.getByText('테스트 모형 기록 (실사용과 별도)',{exact:true}).count(),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:join(output,`unfinished-${width}.png`),fullPage:true});
 usageRevoked=true;await root.getByRole('button',{name:'출처·실행 기록 새로고침',exact:true}).click();
 await usage.getByText('현재 권한으로 사용량을 확인할 수 없습니다.',{exact:true}).waitFor();
 assert.equal(await usage.getByText('대회 API 관측 기록',{exact:true}).count(),0);assert.equal(writes,3);
 console.log(JSON.stringify({width,writes,deniedDisabled:true,explicitConsent:true,conflictPreserved:true,revocationCleared:true,cancelledResultIgnored:true,unfinishedUsageNotAssumed:true,overflow:false,pageerrors:errors}));await page.close();
}}finally{await browser.close();}
console.log(JSON.stringify({output}));
