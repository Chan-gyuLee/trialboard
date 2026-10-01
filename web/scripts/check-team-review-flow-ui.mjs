// Actual React UI, intercepted synthetic APIs only. No collector/model/service calls.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../../video/node_modules/playwright/index.mjs';
import {canonical} from '../src/field-review.ts';
const output=await mkdtemp(join(tmpdir(),'trialboard-team-flow-ui-'));
const run='12345678-1234-4234-8234-123456789012',attempt='22345678-1234-4234-8234-123456789012',sid='paper:synthetic',sd='a'.repeat(64),rawSha='b'.repeat(64);
const pdf=Buffer.concat([await readFile('web/public/data/moc/SYNTHETIC-DEMO-NOT-CLINICAL.pdf'),Buffer.from('\n% Synthetic workflow transport fixture, not clinical evidence.\n')]),pdfSha=createHash('sha256').update(pdf).digest('hex');
const session={authenticated:true,subject:{id:run,username:'Synthetic reviewer'},team:{id:run,name:'Synthetic QA'},role:'reviewer',permission_epoch:1,absolute_expires_at:Math.floor(Date.now()/1000)+28800,idle_expires_at:Math.floor(Date.now()/1000)+1800,session_context:'b'.repeat(64)};
const basePolicy={resource_kind:'SOURCE_TEXT',run_id:run,source_id:sid,source_digest:sd,policy_revision:0,original_storage:'UNKNOWN',internal_search:'UNKNOWN',external_ai:'UNKNOWN',training:'UNKNOWN',evidence_reference:null,reason:null,asserted_by:null,created_at:null,verification:'UNVERIFIED'};
const summary={run_id:run,attempt_id:attempt,status:'COMPLETED',created_at:'2026-10-01T00:00:00Z',completed_at:'2026-10-01T00:00:01Z',model_calls:1};
const quote='원문에 포함된 합성 근거입니다.';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disk-cache-size=1048576']});
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1100}}),errors=[],unexpected=[];page.on('pageerror',e=>errors.push(e.message));
 let sourcePolicy={...basePolicy},rawPolicy={...basePolicy,resource_kind:'RAW_SNAPSHOT',snapshot_digest:rawSha},writes=0,models=0,handoffs=0,pdfGets=0,completed=false,release=null,multi=false,deny=false,releasePolicy=null,releasePdf=null,pausePdf=false;
 const artifact=()=>({...summary,schema:'research-saved-review/1',mode:'SAVED_REVIEW_ONLY',asserted_by:run,context:{asset:'합성 약물',indication:'합성 질환',nct_id:'NCT00000001'},source_bindings:[{source_id:sid,source_digest:sd,policy_revision:1}],sources:[{source_id:sid,source_digest:sd,title:'검토할 합성 출처'}],collector_calls:0,plan_calls:0,execution_mode:'SCRIPTED_TEST_DOUBLE',model:'synthetic',response_id:'fake',input_tokens:10,output_tokens:20,review:{findings:[{source_id:sid,quote,interpretation:'선택한 자료에 한정한 합성 해석입니다.'}],questions:['분모와 관찰기간을 추가 확인할까요?'],conclusion:'NEEDS_EXPERT_REVIEW'},citation_bindings:[{anchor_id:'synthetic-anchor',source_id:sid,source_digest:sd,start:0,end:Array.from(quote).length,offset_unit:'UNICODE_CODE_POINTS'}],error_code:null,notices:['합성 자료로 흐름만 확인합니다.']});
 const packet=()=>({schema:'research-saved-review-handoff/1',run_id:run,attempt_id:attempt,artifact_digest:createHash('sha256').update(canonical(artifact())).digest('hex'),context:{search_id:run,...artifact().context},sources:[{source_id:sid,source_digest:sd,title:'검토할 합성 출처',url:'https://pubmed.ncbi.nlm.nih.gov/12345678/',pdf_url:'https://www.accessdata.fda.gov/drugsatfda_docs/label/2021/214665s000lbl.pdf',content_level:'PDF_AVAILABLE'}],artifact:artifact(),clinical_verified:false});
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;let data={},status=200;
  if(path==='/api/access-mode')data={mode:'team',tls:false,production_ready:false};
  else if(path==='/api/auth/session')data=session;
  else if(path==='/api/auth/csrf')data={csrf_token:'c'.repeat(43)};
  else if(path.endsWith('/source-metadata'))data={run_id:run,resource_kind:'SOURCE_TEXT',can_manage:true,sources:[{source_id:sid,source_digest:sd,title:'검토할 합성 출처',usage_policy:sourcePolicy}]};
  else if(path.endsWith('/raw-metadata'))data={run_id:run,resource_kind:'RAW_SNAPSHOT',can_manage:true,sources:[{source_id:sid,source_digest:sd,title:'검토할 합성 출처',snapshots:[{snapshot_digest:rawSha,byte_length:2,usage_policy:rawPolicy}]}]};
  else if(path.endsWith('/usage-policy')||path.endsWith('/raw-usage-policy')){
   assert.equal(req.method(),'POST');writes++;const raw=path.endsWith('/raw-usage-policy'),body=req.postDataJSON(),old=raw?rawPolicy:sourcePolicy;
   assert.equal(body.expected_policy_revision,0);assert.equal(body.internal_search,'UNKNOWN');assert.equal(body.training,'UNKNOWN');
   if(writes===1)await new Promise(resolve=>{releasePolicy=resolve;});
   const {expected_policy_revision,...values}=body,next={...old,...values,policy_revision:1,created_at:'2026-10-01T00:00:00Z',asserted_by:run,verification:'USER_ATTESTED_UNVERIFIED'};
   if(raw)rawPolicy=next;else sourcePolicy=next;data={current:next,history:[next],can_manage:true};
  }
  else if(path.endsWith('/review-attempts'))data={run_id:run,attempts:completed?[summary]:[]};
  else if(path.endsWith(`/review-attempts/${attempt}`))data=artifact();
  else if(path.endsWith('/handoff')){handoffs++;assert.equal(req.method(),'GET');data=packet();}
  else if(path.endsWith('/review-usage')){
   const empty={observed_model_calls:0,observed_input_tokens:0,observed_output_tokens:0,input_unknown_attempts:0,output_unknown_attempts:0};
   data={schema:'research-saved-review-usage/1',scope:'SAVED_REVIEW_ONLY',run_id:run,as_of:'2026-10-01T00:00:00Z',attempts_total:0,completed_attempts:0,failed_attempts:0,cancelled_attempts:0,unfinished_attempts:0,usage_by_mode:{DACON_RESPONSES:empty,SCRIPTED_TEST_DOUBLE:empty,COLLECTORS_ONLY:empty}};
  }
  else if(path.endsWith('/review-saved')){
   models++;assert.equal(writes,2);assert.deepEqual(req.postDataJSON(),{model_consent:true,source_bindings:[{source_id:sid,source_digest:sd,policy_revision:1}]});
   await new Promise(resolve=>{release=resolve;});completed=true;
   const event=(sequence,type)=>({schema:'research-saved-review-event/1',run_id:run,attempt_id:attempt,sequence,type,message:'합성 상태'});
   await route.fulfill({status:200,contentType:'text/event-stream',body:[event(1,'STARTED'),event(2,'COMPLETE')].map(e=>`data: ${JSON.stringify(e)}\n\n`).join('')});return;
  }
  else if(path.endsWith('/pdf-metadata')){
   const version=sha=>({pdf_sha256:sha,byte_length:pdf.length,binding_status:'EXACT',usage_policy:{...sourcePolicy,resource_kind:'PDF_BYTES',pdf_sha256:sha,external_ai:'UNKNOWN'}});
   data={run_id:run,resource_kind:'PDF_BYTES',can_manage:true,sources:[{source_id:sid,source_digest:sd,title:'검토할 합성 출처',download_available:true,cached_versions:[version(pdfSha),...(multi?[version('e'.repeat(64))]:[])]}]};
  }
  else if(path.endsWith('/cached')){assert.equal(req.method(),'GET');assert.equal(url.searchParams.get('sha256'),pdfSha);pdfGets++;if(pausePdf)await new Promise(resolve=>{releasePdf=resolve;});if(deny){status=403;}else{await route.fulfill({status:200,contentType:'application/pdf',headers:{'X-Source-Sha256':pdfSha},body:pdf});return;}}
  else if(path.endsWith('/runs')||path.endsWith('/searches')||path==='/api/projects')data=[];
  else if(path==='/api/reviews/defaults'||path==='/api/teams/current/members')status=404; // Initial application shell, before isolated component mount.
  else if(path.endsWith('/capabilities'))data={enabled:false};
  else{unexpected.push(`${req.method()} ${path}`);status=404;}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:5173');
 await page.evaluate(async run=>{
  const r=await import('/node_modules/.vite/deps/react.js'),React=r.default??r;
  const d=await import('/node_modules/.vite/deps/react-dom_client.js'),createRoot=(d.default??d).createRoot;
  const mui=await import('/node_modules/.vite/deps/@mui_material.js'),{theme}=await import('/src/theme.ts');
  const code=await(await fetch('/src/TeamReviewWorkflow.tsx')).text(),url=code.match(/from "([^\"]*\/AccessShell\.tsx[^\"]*)"/)[1];
  const {default:AccessShell}=await import(url),{default:Flow}=await import('/src/TeamReviewWorkflow.tsx'),{default:Pdf}=await import('/src/TeamCollectedPdf.tsx'),{default:Workspace}=await import('/src/PdfWorkspace.tsx');
  document.querySelector('#root')?.remove();const root=document.createElement('div');root.id='team-flow-qa';document.body.append(root);
  function Content(){const [context,setContext]=React.useState(null),[workspace,setWorkspace]=React.useState(false);window.showWorkspace=()=>setWorkspace(true);return React.createElement('main',{style:{padding:16,maxWidth:1000,margin:'auto'}},workspace?React.createElement(Workspace,{scoutContext:context}):context?React.createElement(Pdf,{...context.document,disabled:false,onBusy:b=>{window.pdfBusy=b;},onOpen:async file=>{window.openedPdf={size:file.size,type:file.type};}}):React.createElement(Flow,{runId:run,onBusy:b=>{window.reviewBusy=b;},onIntake:c=>{window.flowContext=c;setContext(c);}}));}
  createRoot(root).render(React.createElement(mui.ThemeProvider,{theme},React.createElement(AccessShell,{},key=>React.createElement(Content,{key}))));
 },run);
 const root=page.locator('#team-flow-qa');
 await root.getByRole('checkbox',{name:'검토할 합성 출처',exact:true}).check();assert.equal(writes,0);assert.equal(models,0);
 const approve=root.getByRole('button',{name:'이용조건 기록 후 검토로',exact:true});assert(await approve.isDisabled());
 await root.getByLabel('선택 자료의 허가 근거',{exact:true}).fill('합성 허가 문서');await root.getByLabel('선택 자료의 확인 사유',{exact:true}).fill('비민감 합성 자료의 테스트 검토');
 await root.getByRole('checkbox',{name:'선택한 출처 텍스트의 저장·조회와 외부 AI 전송 허가를 확인했습니다.',exact:true}).check();
 await root.getByRole('checkbox',{name:'연결된 수집 원본에도 저장·조회와 외부 AI 전송 허가가 적용됨을 확인했습니다.',exact:true}).check();
 await page.screenshot({path:join(output,`prepare-${width}.png`),fullPage:true});await approve.click();
 for(let n=0;n<100&&!releasePolicy;n++)await page.waitForTimeout(20);assert(releasePolicy);assert.equal(await page.evaluate(()=>window.reviewBusy),true);assert(await approve.isDisabled());assert(await root.getByRole('button',{name:'목록 다시 확인',exact:true}).isDisabled());releasePolicy();
 const ai=root.getByRole('button',{name:'선택한 자료 검토 · AI 1회',exact:true});await ai.waitFor();assert.equal(writes,2);assert.equal(models,0);assert(await ai.isDisabled());
 assert(await root.getByRole('checkbox',{name:'검토할 합성 출처',exact:true}).isChecked());
 await root.getByRole('checkbox',{name:/선택한 .*외부 AI/}).check();await ai.click();
 for(let n=0;n<100&&!release;n++)await page.waitForTimeout(20);assert(release);assert.equal(await page.evaluate(()=>window.reviewBusy),true);
 assert(await root.getByRole('button',{name:'자료 선택으로 돌아가기',exact:true}).isDisabled());assert(await root.getByRole('button',{name:'목록 다시 확인',exact:true}).isDisabled());release();
 await root.getByRole('region',{name:'저장 자료 재검토 결과'}).waitFor();await root.getByRole('button',{name:'KOL·원문 연결 정보 확인',exact:true}).click();
 await root.getByLabel('회의 준비 메모',{exact:true}).fill('다음 회의에서 분모를 확인합니다.');assert.equal(handoffs,1);assert.equal(models,1);
 const download=page.waitForEvent('download');await root.getByRole('button',{name:'근거·질문·회의 메모 내려받기',exact:true}).click();const file=await download;
 const content=await readFile(await file.path(),'utf8');assert(content.includes(quote));assert(content.includes('다음 회의에서 분모를 확인합니다.'));assert(content.includes('SCRIPTED_TEST_DOUBLE')===false);assert(content.includes('합성 테스트 모델'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:join(output,`result-${width}.png`),fullPage:true});
 await root.getByRole('button',{name:'이 문맥으로 원문·수치 검토',exact:true}).click();
 const openPdf=root.getByRole('button',{name:'선택한 저장 PDF로 검토',exact:true});await openPdf.waitFor();await openPdf.click();await page.waitForFunction(()=>window.openedPdf);assert.equal(pdfGets,1);
 assert.deepEqual(await page.evaluate(()=>window.openedPdf),{size:pdf.length,type:'application/pdf'});assert.equal((await page.evaluate(()=>window.flowContext)).study,'NCT00000001');
 multi=true;await root.getByRole('button',{name:'원문 목록 다시 확인',exact:true}).click();await root.getByRole('combobox',{name:'검토할 PDF 버전'}).waitFor();await page.waitForTimeout(100);assert(await openPdf.isDisabled());
 await root.getByRole('combobox',{name:'검토할 PDF 버전'}).click();await page.getByRole('option').filter({hasText:pdfSha.slice(0,16)}).click();
 deny=true;await openPdf.click();await root.getByText('PDF 저장·조회 허가 또는 접근 권한이 변경되었습니다. 이용조건을 확인하세요.',{exact:true}).waitFor();assert.equal(pdfGets,2);
 assert.equal(models,1);assert.equal(writes,2);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:join(output,`pdf-${width}.png`),fullPage:true});
 multi=false;deny=false;pausePdf=true;await page.evaluate(()=>window.showWorkspace());await root.getByRole('button',{name:'선택한 저장 PDF로 검토',exact:true}).click();
 for(let n=0;n<100&&!releasePdf;n++)await page.waitForTimeout(20);assert(releasePdf);assert.equal(await root.locator('input[type=file]').first().evaluate(el=>Boolean(el.closest('[inert]'))),false); // ProjectShelf has its own disabled lock.
 assert.equal(await root.locator('.pdf-file-bar').evaluate(el=>Boolean(el.closest('[inert]'))),true);releasePdf();
 await root.getByRole('region',{name:'이 PDF의 수집 출처',exact:true}).waitFor();await root.getByRole('button',{name:'03 필드 검토',exact:true}).click();
 await root.getByRole('button',{name:'04 설계 비교·KOL',exact:true}).click();
 assert.equal(await root.getByRole('region',{name:'이 PDF의 수집 출처',exact:true}).getByText('합성 약물 · NCT00000001',{exact:true}).count(),1);
 assert.equal(models,1);assert.equal(writes,2);assert.equal(pdfGets,3);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:join(output,`workspace-${width}.png`),fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 console.log(JSON.stringify({width,writes,models,handoffs,pdfGets,busyGuard:true,multiVersionSelection:true,revocationBlocked:true,actualPdfWorkspace:true,overflow:false}));await page.close();
}}finally{await browser.close();}
console.log(JSON.stringify({output}));
