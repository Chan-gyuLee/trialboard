// Mounted StrictMode regression: exact cached version, no external service or real account.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../../video/node_modules/playwright/index.mjs';
const output=await mkdtemp(join(tmpdir(),'trialboard-pdf-exact-ui-'));
const run='12345678-1234-4234-8234-123456789012',sid='synthetic',digest='a'.repeat(64);
const bytes=[Buffer.from('%PDF-1.4\nSynthetic version one'),Buffer.from('%PDF-1.4\nSynthetic version two')];
const hashes=bytes.map(v=>createHash('sha256').update(v).digest('hex'));
const session={authenticated:true,subject:{id:run,username:'Synthetic viewer'},team:{id:run,name:'Synthetic QA'},role:'viewer',permission_epoch:1,absolute_expires_at:Math.floor(Date.now()/1000)+3600,idle_expires_at:Math.floor(Date.now()/1000)+1800,session_context:'b'.repeat(64)};
const policy=sha=>({resource_kind:'PDF_BYTES',run_id:run,source_id:sid,source_digest:digest,pdf_sha256:sha,policy_revision:1,original_storage:'ALLOW',internal_search:'UNKNOWN',external_ai:'UNKNOWN',training:'UNKNOWN',evidence_reference:'Synthetic permission',reason:'Synthetic bytes',asserted_by:run,created_at:'2026-10-01T00:00:00Z',verification:'USER_ATTESTED_UNVERIFIED'});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disk-cache-size=1048576']});
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1000},acceptDownloads:false});
 const requests=[],downloads=[],errors=[];let mode='ok';
 page.on('download',v=>downloads.push(v.suggestedFilename()));page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());let status=200,data={};
  if(url.pathname==='/api/access-mode')data={mode:'team',tls:false,production_ready:false};
  else if(url.pathname==='/api/auth/session')data=session;
  else if(url.pathname.endsWith('/pdf-metadata'))data={run_id:run,resource_kind:'PDF_BYTES',can_manage:false,sources:[{source_id:sid,source_digest:digest,title:'두 버전이 있는 합성 PDF',download_available:true,cached_versions:hashes.map((sha,i)=>({pdf_sha256:sha,byte_length:bytes[i].length,binding_status:'EXACT',usage_policy:policy(sha)}))}]};
  else if(url.pathname.endsWith('/usage-policy')){assert.equal(req.method(),'GET');const current=policy(url.searchParams.get('pdf_sha256'));data={current,history:[current],can_manage:false};}
  else if(url.pathname.endsWith('/cached')){
   assert.equal(req.method(),'GET');const sha=url.searchParams.get('sha256');requests.push(sha);assert(hashes.includes(sha));
   if(mode==='deny'){await route.fulfill({status:403,contentType:'application/json',body:'{"detail":"PDF_STORAGE_NOT_ALLOWED"}'});return;}
   await route.fulfill({status:200,headers:{'Content-Type':'application/pdf','X-Source-Sha256':mode==='wrong'?hashes[0]:sha},body:bytes[hashes.indexOf(sha)]});return;
  }else if(url.pathname.endsWith('/runs')||url.pathname.endsWith('/searches'))data=[];
  else if(url.pathname.endsWith('/capabilities'))data={enabled:false};else status=404;
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:5173');
 await page.evaluate(async run=>{
  const r=await import('/node_modules/.vite/deps/react.js'),React=r.default??r,d=await import('/node_modules/.vite/deps/react-dom_client.js');
  const mui=await import('/node_modules/.vite/deps/@mui_material.js'),{theme}=await import('/src/theme.ts');
  const code=await(await fetch('/src/ResearchPdfPolicy.tsx')).text(),url=code.match(/from "([^\"]*\/AccessShell\.tsx[^\"]*)"/)[1];
  const {default:AccessShell}=await import(url),{default:Panel}=await import('/src/ResearchPdfPolicy.tsx');
  document.querySelector('#root')?.remove();const root=document.createElement('div');root.id='exact-pdf-qa';document.body.append(root);
  (d.default??d).createRoot(root).render(React.createElement(React.StrictMode,{},React.createElement(mui.ThemeProvider,{theme},React.createElement(AccessShell,{},key=>React.createElement('main',{key,style:{padding:16,maxWidth:900,margin:'auto'}},React.createElement(Panel,{runId:run}))))));
 },run);
 const root=page.locator('#exact-pdf-qa');await root.getByRole('button',{name:'PDF 이용조건',exact:true}).click();
 await root.getByLabel('저장된 PDF 버전',{exact:true}).click();await page.getByRole('option',{name:new RegExp(hashes[1].slice(0,16))}).click();
 const save=root.getByRole('button',{name:'선택한 PDF 파일 저장',exact:true});await save.waitFor();
 await save.focus();await page.keyboard.press('Enter');await root.getByText(/파일 저장을 요청했습니다/).waitFor();
 assert.deepEqual(requests,[hashes[1]]);assert.deepEqual(downloads,[`trialboard-${hashes[1]}.pdf`]);
 assert(await root.getByRole('button',{name:'PDF 이용조건 기록',exact:true}).isDisabled());
 mode='wrong';await save.click();await root.getByText('선택한 PDF 버전과 응답 지문이 다릅니다.',{exact:true}).waitFor();assert(await save.isDisabled());assert.equal(downloads.length,1);
 await root.getByRole('button',{name:'최신 PDF 이력 불러오기',exact:true}).click();mode='deny';await save.click();await root.getByText('PDF 이용조건 또는 관리 권한이 허용되지 않습니다.',{exact:true}).waitFor();assert(await save.isDisabled());assert.equal(downloads.length,1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 await page.screenshot({path:join(output,`exact-${width}.png`),fullPage:true});
 console.log(JSON.stringify({width,strictMode:true,exactSecondVersion:true,viewerReadOnly:true,keyboard:true,wrongHashNoDownload:true,revokedNoDownload:true,downloads:downloads.length}));await page.close();
}}finally{await browser.close();}
console.log(JSON.stringify({output}));
