// TEAM collection-only actual UI, synthetic APIs; no external data, provider or real accounts.
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../../video/node_modules/playwright/index.mjs';
const output=await mkdtemp(join(tmpdir(),'trialboard-team-collection-ui-'));
const id='00000000-0000-4000-8000-000000000001',run='00000000-0000-4000-8000-000000000002',source='a'.repeat(64),raw='b'.repeat(64);
const study={nct_id:'NCT00000001',title:'합성 시험',url:'https://clinicaltrials.gov/study/NCT00000001',conditions:['Synthetic tumor'],phases:['PHASE2'],status:'COMPLETED',updated:null,sponsor:null,enrollment:null,interventions:[{name:'SyntheticDrug',type:'DRUG'}],arms:[],primary_outcomes:[],results_available:true,documents:[]};
const receipt={id,query:'SyntheticDrug',created_at:'2026-10-01T00:00:00Z',digest:'c'.repeat(64),total_count:1,fetched_count:1,truncated:false,studies:[study],mode:'LIVE_PUBLIC',clinical_verified:false};
const policy={resource_kind:'SOURCE_TEXT',run_id:run,source_id:'registry_NCT00000001',source_digest:source,policy_revision:0,original_storage:'UNKNOWN',internal_search:'UNKNOWN',external_ai:'UNKNOWN',training:'UNKNOWN',evidence_reference:null,reason:null,asserted_by:null,created_at:null,verification:'UNVERIFIED'};
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disk-cache-size=1048576']});
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));let posts=[],viewer=false,unexpectedAI=false;
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let status=200,data={};if(req.method()==='POST')posts.push({path,body:req.postDataJSON()});
  if(path==='/api/access-mode')data={mode:'team',tls:false,production_ready:false};
  else if(path==='/api/auth/session')data={authenticated:true,subject:{id,username:'합성 검토자'},team:{id,name:'TEAM 수집 QA'},role:viewer?'viewer':'reviewer',permission_epoch:1,absolute_expires_at:Math.floor(Date.now()/1000)+28800,idle_expires_at:Math.floor(Date.now()/1000)+1800,session_context:'d'.repeat(64)};
  else if(path==='/api/auth/csrf')data={csrf_token:'e'.repeat(43)};
  else if(path==='/api/evidence-scout/capabilities')data={enabled:true,persisted:true,source:'ClinicalTrials.gov API v2',limit:20,model_calls:0};
  else if(path==='/api/evidence-scout/search'){
   await route.fulfill({status:200,contentType:'application/x-ndjson',body:['SEARCHING','COLLECTED','SAVING','COMPLETE'].map(stage=>JSON.stringify({stage,...(stage==='COMPLETE'?{receipt}:{message:'합성 시험 검색'})})+'\n').join('')});return;
  }else if(path==='/api/research/run'){
   await route.fulfill({status:200,contentType:'text/event-stream',body:['STARTED',unexpectedAI?'AI_PLAN':'SEARCH','COMPLETE'].map((stage,i)=>'data: '+JSON.stringify({run_id:run,sequence:i+1,elapsed_ms:i*100,stage,message:'허가한 합성 자료 수집 기록'})+'\n\n').join('')});return;
  }else if(path.endsWith('/source-metadata'))data={run_id:run,resource_kind:'SOURCE_TEXT',can_manage:true,sources:[{source_id:policy.source_id,source_digest:source,title:'합성 시험등록 출처',usage_policy:policy}]};
  else if(path.endsWith('/raw-metadata'))data={run_id:run,resource_kind:'RAW_SNAPSHOT',can_manage:true,sources:[{source_id:policy.source_id,source_digest:source,title:'합성 시험등록 출처',snapshots:[{snapshot_digest:raw,byte_length:2,usage_policy:{...policy,resource_kind:'RAW_SNAPSHOT',snapshot_digest:raw}}]}]};
  else if(path.endsWith('/runs')||path.endsWith('/searches'))data=[];
  else if(path.endsWith('/capabilities'))data={enabled:false,configured:false};else status=404;
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:5173');
 await page.evaluate(async()=>{
  const r=await import('/node_modules/.vite/deps/react.js'),React=r.default??r;
  const d=await import('/node_modules/.vite/deps/react-dom_client.js'),createRoot=(d.default??d).createRoot;
  const mui=await import('/node_modules/.vite/deps/@mui_material.js'),{theme}=await import('/src/theme.ts');
  const code=await(await fetch('/src/AutoReview.tsx')).text(),url=code.match(/from "([^\"]*\/AccessShell\.tsx[^\"]*)"/)[1];
  const {default:AccessShell}=await import(url),{default:Component}=await import('/src/AutoReview.tsx'),{default:Manual}=await import('/src/ResearchPanel.tsx');
  document.querySelector('#root')?.remove();const container=document.createElement('div');container.id='team-collection-qa';document.body.append(container);const root=createRoot(container),noop=()=>{};
  window.teamCollectionRender=(shellKey='reviewer',mode='auto')=>root.render(React.createElement(React.StrictMode,{},React.createElement(mui.ThemeProvider,{theme},React.createElement(AccessShell,{key:shellKey},key=>React.createElement('main',{key,style:{padding:16,maxWidth:1100,margin:'auto'}},mode==='auto'?React.createElement(Component,{locked:false,onBusy:noop,onDetails:noop,onManual:noop,onIntake:noop,onContinue:noop}):React.createElement(Manual,{locked:false,onBusy:noop,onIntake:noop,onRestoreContext:async()=>{},context:{search_id:'00000000-0000-4000-8000-000000000001',nct_id:'NCT00000001',asset:'SyntheticDrug',indication:'Synthetic tumor'}}))))));
  window.teamCollectionRender();
 });
 const root=page.locator('#team-collection-qa'),start=root.getByRole('button',{name:'허가한 자료 수집',exact:true});
 await start.waitFor();await root.getByRole('textbox',{name:'약물명 또는 NCT 번호',exact:true}).fill('SyntheticDrug');assert(await start.isDisabled());
 const registry=root.getByRole('checkbox',{name:'ClinicalTrials.gov 시험 등록 원본',exact:true}),consent=root.getByRole('checkbox',{name:/공개 시험 검색·검색 기록 저장/});
 await registry.check();await consent.check();assert(await start.isDisabled());
 await root.getByLabel('ClinicalTrials.gov 시험 등록 원본 허가 근거',{exact:true}).fill('합성 공개 원본 이용 허가');
 await root.getByLabel('ClinicalTrials.gov 시험 등록 원본 확인 사유',{exact:true}).fill('원본 저장 목적만 확인한 합성 시험');
 assert(!await consent.isChecked());await consent.check();assert.equal(posts.length,0);
 await page.screenshot({path:join(output,`intake-${width}.png`),fullPage:true});await start.click();
 const done=root.getByRole('region',{name:'팀 자료 수집 기록'});await done.waitFor();
 assert.deepEqual(posts.map(p=>p.path),['/api/evidence-scout/search','/api/research/run']);
 assert.equal(posts[1].body.model_consent,false);assert.deepEqual(posts[1].body.raw_storage_permissions,[{collector:'REGISTRY',original_storage:'ALLOW',evidence_reference:'합성 공개 원본 이용 허가',reason:'원본 저장 목적만 확인한 합성 시험'}]);
 await done.getByText(/AI 분석은 요청하지 않았습니다/).waitFor();await done.locator('summary').filter({hasText:'자료별 상세 이용조건·기존 검토 기록'}).click();assert.equal(await done.getByRole('button',{name:'수집 원본 이용조건',exact:true}).count(),1);assert.equal(await done.getByRole('button',{name:'저장 자료로 다시 검토',exact:true}).count(),1);
 assert.equal(await root.getByText('작업 중단',{exact:true}).count(),0);await page.screenshot({path:join(output,`collected-${width}.png`),fullPage:true});
 await done.getByRole('button',{name:'다른 자료 수집',exact:true}).click();assert(!await registry.isChecked());assert(await start.isDisabled());
  viewer=true;await page.evaluate(()=>window.teamCollectionRender('viewer'));await root.getByText(/읽기 전용 계정입니다/).waitFor();assert(await start.isDisabled());assert(await registry.isDisabled());
  assert.equal(posts.length,2);
  viewer=false;await page.evaluate(()=>window.teamCollectionRender('manual','manual'));
  const manualStart=root.getByRole('button',{name:'공개 자료 수집 시작',exact:true});await manualStart.waitFor();assert(await manualStart.isDisabled());
  await root.getByRole('checkbox',{name:'ClinicalTrials.gov 시험 등록 원본',exact:true}).check();
  await root.getByLabel('ClinicalTrials.gov 시험 등록 원본 허가 근거',{exact:true}).fill('합성 수동 조사 허가');await root.getByLabel('ClinicalTrials.gov 시험 등록 원본 확인 사유',{exact:true}).fill('원본 저장만 동의');
  await root.getByRole('checkbox',{name:/선택한 경로의 공개 자료를 검색/}).check();await manualStart.click();
  await root.getByRole('region',{name:'팀 조사 수집 기록'}).waitFor();assert.equal(posts.length,3);assert.equal(posts[2].path,'/api/research/run');assert.equal(posts[2].body.model_consent,false);
  assert.equal(posts[2].body.raw_storage_permissions.length,1);assert.equal(posts[2].body.raw_storage_permissions[0].collector,'REGISTRY');
  assert.equal(await root.locator('.research-stages').getByText('AI 조사 계획',{exact:true}).count(),0);
  await root.getByText('이 실행은 자료 수집만 요청했습니다. AI 분석과 PDF 다운로드는 이용조건 확인 후 별도로 실행합니다.',{exact:true}).waitFor();
  async function prepareManual(key){
   await page.evaluate(key=>window.teamCollectionRender(key,'manual'),key);await manualStart.waitFor();
   await root.getByRole('checkbox',{name:'ClinicalTrials.gov 시험 등록 원본',exact:true}).check();
   await root.getByLabel('ClinicalTrials.gov 시험 등록 원본 허가 근거',{exact:true}).fill('합성 경계 시험');
   await root.getByLabel('ClinicalTrials.gov 시험 등록 원본 확인 사유',{exact:true}).fill('원본 저장만 동의');
   await root.getByRole('checkbox',{name:/선택한 경로의 공개 자료를 검색/}).check();
  }
  await prepareManual('manual-cancel');
  await page.evaluate(()=>{
   const original=window.fetch;window.restoreCollectionFetch=()=>{window.fetch=original;};
   window.fetch=async(input,options)=>{
    if(String(input)==='/api/research/run'){
     const response=await original(input,{...options,signal:undefined});
     await new Promise(resolve=>{window.releaseCollectionResponse=resolve;});return response;
    }return original(input,options);
   };
  });
  await manualStart.click();await page.waitForFunction(()=>Boolean(window.releaseCollectionResponse));
  await root.getByRole('button',{name:'실행 중단',exact:true}).click();
  await page.evaluate(()=>{window.releaseCollectionResponse();window.restoreCollectionFetch();});
  await root.getByText(/실행 대기를 중단했습니다/).waitFor();assert.equal(await root.getByRole('region',{name:'팀 조사 수집 기록'}).count(),0);
  unexpectedAI=true;await prepareManual('manual-ai');await manualStart.click();
  await root.getByText(/수집 전용 요청에서 예상하지 않은 AI 이벤트/).waitFor();assert.equal(await root.getByRole('region',{name:'팀 조사 수집 기록'}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,strictMode:true,posts:posts.length,autoAndManual:true,onlySelectedCollector:true,modelConsentFalse:true,noModelOrPdfPost:true,permissionChangesResetConsent:true,newCollectionResetsPermissions:true,viewerReadOnly:true,lateCancelledCompletionRejected:true,unexpectedAiRejected:true,overflow:false,pageerrors:errors}));await page.close();
}}finally{await browser.close();}
console.log(JSON.stringify({output}));
