// Real UI in StrictMode, synthetic intercepted responses only; no external download.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../../video/node_modules/playwright/index.mjs';
const output=await mkdtemp(join(tmpdir(),'trialboard-pdf-policy-ui-'));
const run='12345678-1234-4234-8234-123456789012',sid='paper:synthetic',digest='a'.repeat(64),bytes=Buffer.from('%PDF-1.4\nSynthetic nonclinical fixture\n%%EOF'),sha=createHash('sha256').update(bytes).digest('hex');
const session={authenticated:true,subject:{id:run,username:'Synthetic reviewer'},team:{id:run,name:'Synthetic QA'},role:'reviewer',permission_epoch:1,absolute_expires_at:Math.floor(Date.now()/1000)+28800,idle_expires_at:Math.floor(Date.now()/1000)+1800,session_context:'b'.repeat(64)};
const unknown={resource_kind:'PDF_BYTES',run_id:run,source_id:sid,source_digest:digest,pdf_sha256:sha,policy_revision:0,original_storage:'UNKNOWN',internal_search:'UNKNOWN',external_ai:'UNKNOWN',training:'UNKNOWN',evidence_reference:null,reason:null,asserted_by:null,created_at:null,verification:'UNVERIFIED'};
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disk-cache-size=1048576']});
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let downloaded=false,downloads=0,writes=0,canManage=true,wrongHash=false,current={...unknown},history=[];
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;let status=200,data={};
  if(path==='/api/access-mode')data={mode:'team',tls:false,production_ready:false};else if(path==='/api/auth/session')data=session;else if(path==='/api/auth/csrf')data={csrf_token:'c'.repeat(43)};
  else if(path.endsWith('/pdf-metadata'))data={run_id:run,resource_kind:'PDF_BYTES',can_manage:canManage,sources:[{source_id:sid,source_digest:digest,title:'합성 공개 PDF',download_available:true,cached_versions:downloaded?[{pdf_sha256:sha,byte_length:bytes.length,binding_status:'EXACT',usage_policy:current}]:[]},{source_id:'paper:other',source_digest:'d'.repeat(64),title:'다른 합성 PDF',download_available:true,cached_versions:[]}]};
  else if(path.endsWith('/usage-policy')){
   if(req.method()==='POST'){
    writes++;const body=req.postDataJSON();assert.equal(body.source_digest,digest);assert.equal(body.pdf_sha256,sha);
    if(writes===1){assert.equal(body.expected_policy_revision,1);status=409;current={...current,policy_revision:2,reason:'다른 사용자의 기록'};history=[current,...history];}
    else{assert.equal(body.expected_policy_revision,2);const {expected_policy_revision,...fields}=body;current={...current,...fields,policy_revision:3};history=[current,...history];}
   }else{assert.equal(url.searchParams.get('source_digest'),digest);assert.equal(url.searchParams.get('pdf_sha256'),sha);}
   data={current,history,can_manage:canManage};
  }else if(path.includes('/documents/')){
   assert.equal(req.method(),'POST');downloads++;const body=req.postDataJSON();assert.deepEqual(Object.keys(body).sort(),['consent','source_digest','storage_permission']);assert.equal(body.consent,true);assert.equal(body.storage_permission.original_storage,'ALLOW');assert(!('external_ai' in body.storage_permission));
   if(!wrongHash){assert.equal(body.source_digest,digest);downloaded=true;current={...unknown,policy_revision:1,original_storage:'ALLOW',evidence_reference:body.storage_permission.evidence_reference,reason:body.storage_permission.reason,asserted_by:run,created_at:'2026-10-01T00:00:00Z',verification:'USER_ATTESTED_UNVERIFIED'};history=[current];}
   await route.fulfill({status:200,headers:{'Content-Type':'application/pdf','X-Source-Sha256':wrongHash?'f'.repeat(64):sha},body:bytes});return;
  }else if(path.endsWith('/runs')||path.endsWith('/searches'))data=[];else if(path.endsWith('/capabilities'))data={enabled:false};else status=404;
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:5173');
 await page.evaluate(async run=>{
  const r=await import('/node_modules/.vite/deps/react.js'),React=r.default??r,d=await import('/node_modules/.vite/deps/react-dom_client.js'),createRoot=(d.default??d).createRoot;
  const mui=await import('/node_modules/.vite/deps/@mui_material.js'),{theme}=await import('/src/theme.ts');
  const code=await(await fetch('/src/ResearchPdfPolicy.tsx')).text(),url=code.match(/from "([^\"]*\/AccessShell\.tsx[^\"]*)"/)[1];
  const {default:AccessShell}=await import(url),{ReviewTools}=await import('/src/ReviewNavigation.tsx');
  document.querySelector('#root')?.remove();const root=document.createElement('div');root.id='pdf-policy-qa';document.body.append(root);
  createRoot(root).render(React.createElement(React.StrictMode,{},React.createElement(mui.ThemeProvider,{theme},React.createElement(AccessShell,{},key=>React.createElement('main',{key,style:{padding:16,maxWidth:1000,margin:'auto'}},React.createElement(ReviewTools,{history:[{id:run,request:{asset:'합성 약물',nct_id:'NCT00000001'},status:'PARTIAL',created_at:'2026-10-01T00:00:00Z'}],disabled:false,onOpen:()=>{},onManual:()=>{}}))))));
 },run);
 const root=page.locator('#pdf-policy-qa');await root.getByRole('button',{name:/최근 검토/}).click();await root.getByRole('button',{name:'PDF 이용조건',exact:true}).focus();await page.keyboard.press('Enter');
 const evidence=root.getByLabel('PDF 저장 허가 근거',{exact:true}),reason=root.getByLabel('PDF 저장 확인 사유',{exact:true}),download=root.getByRole('button',{name:'허가 확인 후 PDF 저장',exact:true}),consent=root.getByRole('checkbox',{name:'해당 출처의 PDF를 다운로드하여 저장할 권리를 확인했습니다.',exact:true});
 await evidence.waitFor();assert.equal(downloads,0);assert.equal(writes,0);await evidence.fill('합성 라이선스');await reason.fill('합성 PDF 저장 허가 확인');assert(await download.isDisabled());await consent.check();await download.click();
 await root.getByText(/PDF 저장과 수신 지문 확인을 마쳤습니다/).waitFor();assert.equal(downloads,1);assert.equal(current.external_ai,'UNKNOWN');await root.getByRole('button',{name:'저장된 PDF 확인',exact:true}).click();
 const policyReason=root.getByLabel('파일 이용 확인 사유',{exact:true}),record=root.getByRole('button',{name:'PDF 이용조건 기록',exact:true});await policyReason.waitFor();await policyReason.fill('충돌 이후에도 보존할 PDF 확인 사유');await record.click();
 await root.getByRole('button',{name:'최신 PDF 이력 불러오기',exact:true}).waitFor();assert(await record.isDisabled());assert.equal(await policyReason.inputValue(),'충돌 이후에도 보존할 PDF 확인 사유');
 await root.getByRole('button',{name:'최신 PDF 이력 불러오기',exact:true}).click();await record.click();await root.getByText('이 파일 버전의 이용조건을 기록했습니다.',{exact:true}).waitFor();assert.equal(writes,2);
 await page.screenshot({path:join(output,`pdf-${width}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 canManage=false;await root.getByRole('button',{name:'PDF 목록 새로고침',exact:true}).click();await policyReason.waitFor();assert(await record.isDisabled());
 canManage=true;await root.getByRole('button',{name:'PDF 목록 새로고침',exact:true}).click();await root.getByLabel('PDF 출처',{exact:true}).click();await page.getByRole('option',{name:'다른 합성 PDF',exact:true}).click();
 await evidence.fill('두 번째 합성 라이선스');await reason.fill('해시 불일치 검증');await consent.check();wrongHash=true;await download.click();await root.getByText('수신한 PDF 지문이 서버의 저장 지문과 다릅니다.',{exact:true}).waitFor();
 assert.equal(downloads,2);assert.deepEqual(errors,[]);console.log(JSON.stringify({width,downloads,writes,explicitPermission:true,shaChecked:true,CASPreserved:true,revokedReadOnly:true,strictMode:true,pageerrors:errors}));await page.close();
}}finally{await browser.close();}
console.log(JSON.stringify({output}));
