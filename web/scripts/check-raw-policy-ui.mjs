// Actual TEAM-context UI, synthetic metadata only; no real collector/model calls.
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../../video/node_modules/playwright/index.mjs';
const output=await mkdtemp(join(tmpdir(),'trialboard-raw-policy-ui-'));
const run='12345678-1234-4234-8234-123456789012',sid='registry:NCT00000001',source='a'.repeat(64),first='b'.repeat(64),second='c'.repeat(64);
const initial={resource_kind:'RAW_SNAPSHOT',run_id:run,source_id:sid,source_digest:source,snapshot_digest:first,policy_revision:0,original_storage:'UNKNOWN',internal_search:'UNKNOWN',external_ai:'UNKNOWN',training:'UNKNOWN',evidence_reference:null,reason:null,asserted_by:null,created_at:null,verification:'UNVERIFIED'};
const session={authenticated:true,subject:{id:run,username:'합성 검토자'},team:{id:run,name:'수집 원본 QA'},role:'reviewer',permission_epoch:1,absolute_expires_at:Math.floor(Date.now()/1000)+28800,idle_expires_at:Math.floor(Date.now()/1000)+1800,session_context:'d'.repeat(64)};
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disk-cache-size=1048576']});
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let current={...initial},history=[],writes=0,canManage=true,delay=false,release=null,deny=false,modelCalls=0;
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;let data={},status=200;
  if(path==='/api/access-mode')data={mode:'team',tls:false,production_ready:false};
  else if(path==='/api/auth/session')data=session;
  else if(path==='/api/auth/csrf')data={csrf_token:'e'.repeat(43)};
  else if(path.endsWith('/raw-metadata'))data={run_id:run,resource_kind:'RAW_SNAPSHOT',can_manage:canManage,sources:[{source_id:sid,source_digest:source,title:'합성 시험등록 원본',snapshots:[{snapshot_digest:first,byte_length:1200,usage_policy:current},{snapshot_digest:second,byte_length:1500,usage_policy:{...initial,snapshot_digest:second}}]}]};
  else if(path.endsWith('/raw-usage-policy')){
   if(req.method()==='POST'){
    writes++;const body=req.postDataJSON();assert.deepEqual(Object.keys(body).sort(),['source_digest','snapshot_digest','expected_policy_revision','original_storage','internal_search','external_ai','training','evidence_reference','reason'].sort());assert.equal(body.source_digest,source);assert.equal(body.snapshot_digest,first);
    if(writes===1){assert.equal(body.expected_policy_revision,0);status=409;current={...initial,policy_revision:1,evidence_reference:'다른 합성 허가',reason:'먼저 기록한 합성 사유',asserted_by:run,created_at:'2026-10-01T00:00:00Z',verification:'USER_ATTESTED_UNVERIFIED'};history=[current];}
    else{assert.equal(body.expected_policy_revision,1);const {expected_policy_revision,...fields}=body;current={...current,...fields,policy_revision:2};history=[current,...history];}
    data={current,history,can_manage:canManage};
   }else{
    assert.equal(url.searchParams.get('source_digest'),source);const sha=url.searchParams.get('snapshot_digest');assert([first,second].includes(sha));
    if(sha===second){if(delay)await new Promise(resolve=>{release=resolve;});data={current:{...initial,snapshot_digest:second},history:[],can_manage:canManage};}
    else data={current,history,can_manage:canManage};
    if(deny){status=403;data={detail:'BLOCKED'};}
   }
  }else if(path.endsWith('/runs')||path.endsWith('/searches'))data=[];
  else if(path.endsWith('/capabilities'))data={enabled:false};
  else{if(req.method()==='POST')modelCalls++;status=404;}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:5173');
 await page.evaluate(async run=>{
  const r=await import('/node_modules/.vite/deps/react.js'),React=r.default??r;
  const d=await import('/node_modules/.vite/deps/react-dom_client.js'),createRoot=(d.default??d).createRoot;
  const mui=await import('/node_modules/.vite/deps/@mui_material.js'),{theme}=await import('/src/theme.ts');
  const code=await(await fetch('/src/ResearchRawPolicy.tsx')).text(),url=code.match(/from "([^\"]*\/AccessShell\.tsx[^\"]*)"/)[1];
  const {default:AccessShell}=await import(url),{ReviewTools}=await import('/src/ReviewNavigation.tsx');
  document.querySelector('#root')?.remove();const container=document.createElement('div');container.id='raw-policy-qa';document.body.append(container);
  createRoot(container).render(React.createElement(React.StrictMode,{},React.createElement(mui.ThemeProvider,{theme},React.createElement(AccessShell,{},key=>React.createElement('main',{key,style:{padding:16,maxWidth:1000,margin:'auto'}},React.createElement(ReviewTools,{history:[{id:run,request:{asset:'합성 약물',nct_id:'NCT00000001'},status:'PARTIAL',created_at:'2026-10-01T00:00:00Z'}],disabled:false,onOpen:()=>{},onManual:()=>{}}))))));
 },run);
 const root=page.locator('#raw-policy-qa');await root.getByRole('button',{name:/최근 검토/}).click();
 await root.getByRole('button',{name:'수집 원본 이용조건',exact:true}).focus();await page.keyboard.press('Enter');
 const evidence=root.getByLabel('원본 허가 근거',{exact:true}),reason=root.getByLabel('원본 확인 사유',{exact:true}),save=root.getByRole('button',{name:'원본 이용조건 기록',exact:true}),select=root.getByRole('combobox',{name:'이용조건을 확인할 수집 원본',exact:true});
 await evidence.waitFor();await evidence.fill('합성 원본 허가 근거');await reason.fill('충돌 뒤에도 유지할 원본 확인 사유');
 await root.getByRole('combobox',{name:'원본 JSON 저장·조회',exact:true}).click();await page.getByRole('option',{name:'허용',exact:true}).click();assert.equal(writes,0);
 await save.click();await root.getByText(/작성한 내용은 유지했습니다/).waitFor();assert(await save.isDisabled());assert.equal(await reason.inputValue(),'충돌 뒤에도 유지할 원본 확인 사유');
 await root.getByRole('button',{name:'최신 원본 이력 불러오기',exact:true}).click();await save.click();
 await root.getByText('이 수집 원본의 이용조건을 기록했습니다. 다른 원본이나 출처의 허가는 바꾸지 않았습니다.',{exact:true}).waitFor();assert.equal(writes,2);assert.equal(current.original_storage,'ALLOW');assert.equal(current.external_ai,'UNKNOWN');
 await page.screenshot({path:join(output,`raw-${width}.png`),fullPage:true});
 delay=true;await select.click();await page.getByRole('option').filter({hasText:second.slice(0,12)}).click();
 for(let i=0;i<50&&!release;i++)await page.waitForTimeout(20);assert(release);
 await select.click();await page.getByRole('option').filter({hasText:first.slice(0,12)}).click();release();await page.waitForTimeout(100);
 assert.equal(await reason.inputValue(),'충돌 뒤에도 유지할 원본 확인 사유');assert.equal(await root.getByText(new RegExp(`원본 지문 ${second}`)).count(),0);
 canManage=false;await root.getByRole('button',{name:'원본 목록 새로고침',exact:true}).click();
 await root.getByText('읽기 전용입니다. 실행 소유자 또는 팀 관리자에게 원본 이용조건 확인을 요청하세요.',{exact:true}).waitFor();assert(await save.isDisabled());
 deny=true;await root.getByRole('button',{name:'원본 목록 새로고침',exact:true}).click();
 await root.getByText('현재 권한으로 수집 원본 이용조건을 변경할 수 없습니다.',{exact:true}).waitFor();assert(await save.isDisabled());assert.equal(await root.getByText(/^현재 원본 이용조건:/).count(),0);
 assert.equal(writes,2);assert.equal(modelCalls,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({width,strictMode:true,writes,modelCalls,exactSnapshot:true,conflictDraftPreserved:true,lateOtherSnapshotIgnored:true,revocationCleared:true,keyboardEntry:true,overflow:false,pageerrors:errors}));await page.close();
}}finally{await browser.close();}
console.log(JSON.stringify({output}));
