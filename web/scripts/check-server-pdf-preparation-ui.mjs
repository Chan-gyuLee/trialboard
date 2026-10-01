// Real mounted components with intercepted synthetic APIs. No parser/model/network source calls.
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../../video/node_modules/playwright/index.mjs';
import {canonical,digest} from '../src/field-review.ts';
import {serverPdfLimits} from '../src/server-pdf-preparation.ts';

const output=await mkdtemp(join(tmpdir(),'trialboard-server-preparation-ui-'));
const run='12345678-1234-4234-8234-123456789012',id='22345678-1234-4234-8234-123456789012';
const target={runId:run,sourceId:'paper:synthetic',sourceDigest:'a'.repeat(64),pdfSha:'b'.repeat(64)};
const content={schema:'research-pdf-preparation/1',mode:'SERVER_PDF_TEXT_ONLY',preparation_id:id,run_id:run,source_id:target.sourceId,source_digest:target.sourceDigest,pdf_sha256:target.pdfSha,policy_revision:1,asserted_by:run,created_at:'2026-10-01T00:00:00+00:00',extractor:'pdfplumber/synthetic',pages:[{page:1,text:'합성 PDF에서 가져온 확인용 본문 🧪'},{page:2,text:''}],limits:serverPdfLimits,model_calls:0,verification:'SERVER_EXTRACTED_NOT_CLINICALLY_VERIFIED',notices:['합성 파서로 검증한 화면이며 실제 모델 호출은 없습니다.']};
const artifact={...content,preparation_digest:await digest(canonical(content))};
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disk-cache-size=1048576']});
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let supported=false,posts=0,hasSaved=false,revoked=false,badHash=false,delay=false,release=null,modelPosts=0;
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());let data={},status=200;
  if(url.pathname==='/api/research/pdf-preparation-capabilities')data={schema:'research-pdf-preparation-capabilities/1',status:supported?'RUNTIME_CHECK_REQUIRED':'UNSUPPORTED_SANDBOX',limits:serverPdfLimits};
  else if(url.pathname.endsWith('/documents/paper%3Asynthetic/pdf-preparations')||url.pathname.endsWith('/documents/paper:synthetic/pdf-preparations')){
   assert.equal(url.searchParams.get('source_digest'),target.sourceDigest);assert.equal(url.searchParams.get('pdf_sha256'),target.pdfSha);
   data={schema:'research-pdf-preparation-list/1',run_id:run,source_id:target.sourceId,source_digest:target.sourceDigest,pdf_sha256:target.pdfSha,preparations:hasSaved?[{preparation_id:id,preparation_digest:artifact.preparation_digest,created_at:content.created_at,page_count:2}]:[]};
  }else if(url.pathname.endsWith('/prepare-server')){
   posts++;assert.deepEqual(request.postDataJSON(),{consent:true,source_digest:target.sourceDigest,pdf_sha256:target.pdfSha,policy_revision:1});
   if(posts===1){status=409;data={detail:'PDF_POLICY_VERSION_CONFLICT'};}else{hasSaved=true;data=artifact;}
  }else if(url.pathname.endsWith(`/pdf-preparations/${id}`)){
   if(delay)await new Promise(resolve=>{release=resolve;});
   if(revoked){status=403;data={detail:'BLOCKED'};}else data=badHash?{...artifact,pages:[{page:1,text:'잘못된 변경 본문'}]}:artifact;
  }else if(url.pathname.endsWith('/review-prepared-pdf')){modelPosts++;status=500;}
  else if(url.pathname==='/api/access-mode')data={mode:'legacy_loopback',tls:false,production_ready:false};
  else if(url.pathname.endsWith('/runs')||url.pathname.endsWith('/searches'))data=[];
  else if(url.pathname.endsWith('/capabilities'))data={enabled:false};else status=404;
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:5173');
 await page.evaluate(async target=>{
  const r=await import('/node_modules/.vite/deps/react.js'),React=r.default??r;
  const d=await import('/node_modules/.vite/deps/react-dom_client.js'),createRoot=(d.default??d).createRoot;
  const mui=await import('/node_modules/.vite/deps/@mui_material.js'),{theme}=await import('/src/theme.ts');
  const {default:Component}=await import('/src/ServerPdfPreparation.tsx');
  document.querySelector('#root')?.remove();const container=document.createElement('div');container.id='preparation-qa';document.body.append(container);const root=createRoot(container);
  window.preparationQaRender=(extra={})=>root.render(React.createElement(React.StrictMode,{},React.createElement(mui.ThemeProvider,{theme},React.createElement('main',{style:{padding:16,maxWidth:1000,margin:'auto'}},React.createElement(Component,{target,policyRevision:1,canManage:true,disabled:false,...extra})))));
  window.preparationQaRender();
 },target);
 const root=page.locator('#preparation-qa');
 await root.getByRole('button',{name:'서버 PDF 본문 준비',exact:true}).focus();await page.keyboard.press('Enter');
 try{await root.getByText(/현재 서버는 필요한 실행 제한을 지원하지 않습니다/).waitFor({timeout:10000});}catch(error){console.log(JSON.stringify({syntheticDiagnostic:await root.innerText(),errors}));throw error;}
 const prepare=root.getByRole('button',{name:'본문 준비 · AI 호출 없음',exact:true});
 assert(await prepare.isDisabled());assert.equal(posts,0);assert.equal(modelPosts,0);
 supported=true;await root.getByRole('button',{name:'준비 상태 새로고침',exact:true}).click();
 await root.getByText(/실행할 때마다 메모리·시간 제한/).waitFor();
 const consent=root.getByRole('checkbox',{name:/별도 준비본으로 저장/});assert(await prepare.isDisabled());await consent.check();await prepare.click();
 await root.getByText('PDF 이용조건이 바뀌었습니다. 파일 이용조건을 새로고침하세요.',{exact:true}).waitFor();assert.equal(posts,1);
 await prepare.click();await root.getByRole('region',{name:'서버 PDF 준비 결과'}).waitFor();assert.equal(posts,2);assert(!await consent.isChecked());
 assert.equal(await root.getByText('저장된 준비본이 없습니다.',{exact:true}).count(),0);assert.equal(await root.getByRole('combobox',{name:'준비본 선택'}).count(),1);
 await root.locator('summary').filter({hasText:'1쪽 본문'}).click();await root.getByText(content.pages[0].text,{exact:true}).waitFor();
 await page.screenshot({path:join(output,`prepared-${width}.png`),fullPage:true});
 await root.getByRole('button',{name:'준비 상태 새로고침',exact:true}).click();await root.getByRole('combobox',{name:'준비본 선택'}).click();await page.getByRole('option').filter({hasText:'2쪽'}).click();
 const load=root.getByRole('button',{name:'선택한 준비본 확인',exact:true});
 badHash=true;await load.click();await root.getByText('서버 PDF 준비본의 대상·내용·지문이 올바르지 않습니다.',{exact:true}).waitFor();assert.equal(await root.getByRole('region',{name:'서버 PDF 준비 결과'}).count(),0);
 badHash=false;await load.click();await root.getByRole('region',{name:'서버 PDF 준비 결과'}).waitFor();
 revoked=true;await load.click();await root.getByText('현재 PDF 이용조건 또는 권한으로 준비본에 접근할 수 없습니다.',{exact:true}).waitFor();assert.equal(await root.getByRole('region',{name:'서버 PDF 준비 결과'}).count(),0);
 revoked=false;await page.evaluate(()=>window.preparationQaRender({canManage:false}));assert(await prepare.isDisabled());assert(await consent.isDisabled());
 await load.click();await root.getByRole('region',{name:'서버 PDF 준비 결과'}).waitFor();
 delay=true;await load.click();for(let i=0;i<50&&!release;i++)await page.waitForTimeout(20);assert(release);
 await root.getByRole('button',{name:'서버 PDF 본문 준비',exact:true}).click();release();await page.waitForTimeout(80);
 assert.equal(await root.getByRole('region',{name:'서버 PDF 준비 결과'}).count(),0);
 assert.equal(modelPosts,0);assert.equal(posts,2);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 console.log(JSON.stringify({width,strictMode:true,unsupportedBlocked:true,explicitConsent:true,posts,modelPosts,hashMismatchRejected:true,revokedCleared:true,viewerReadOnly:true,lateReplyIgnored:true,overflow:false,pageerrors:errors}));await page.close();
}}finally{await browser.close();}
console.log(JSON.stringify({output}));
