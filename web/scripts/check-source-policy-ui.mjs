// Real components with synthetic intercepted API only; no user data or external API.
import assert from "node:assert/strict";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {chromium} from "../../video/node_modules/playwright/index.mjs";

const output=await mkdtemp(join(tmpdir(),"trialboard-source-policy-ui-"));
const run="12345678-1234-4234-8234-123456789012",subject="22345678-1234-4234-8234-123456789012",sid="paper:synthetic",digest="a".repeat(64);
const unknown={resource_kind:"SOURCE_TEXT",run_id:run,source_id:sid,source_digest:digest,policy_revision:0,original_storage:"UNKNOWN",internal_search:"UNKNOWN",external_ai:"UNKNOWN",training:"UNKNOWN",evidence_reference:null,reason:null,asserted_by:null,created_at:null,verification:"UNVERIFIED"};
const second={...unknown,source_id:"paper:second",source_digest:"d".repeat(64)};
const session={authenticated:true,subject:{id:subject,username:"Synthetic reviewer"},team:{id:run,name:"Synthetic QA"},role:"reviewer",permission_epoch:1,absolute_expires_at:Math.floor(Date.now()/1000)+28800,idle_expires_at:Math.floor(Date.now()/1000)+1800,session_context:"b".repeat(64)};
const browser=await chromium.launch({headless:true,executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",args:["--disk-cache-size=1048576"]});
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1100}}),errors=[];
  let current={...unknown},history=[],writes=0,denyRead=false,canManage=true,delayOther=false,releaseOther=null,otherStarted=false;
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/api/**",async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;let status=200,data={};
   if(path==="/api/access-mode")data={mode:"team",tls:false,production_ready:false};
   else if(path==="/api/auth/session")data=session;
   else if(path==="/api/auth/csrf")data={csrf_token:"c".repeat(43)};
   else if(path.endsWith("/source-metadata"))data={run_id:run,resource_kind:"SOURCE_TEXT",can_manage:canManage,sources:[{source_id:sid,source_digest:digest,title:"합성 공개 논문 — 원문 조회 전에 이용조건 확인",usage_policy:current},{source_id:second.source_id,source_digest:second.source_digest,title:"합성 두 번째 출처",usage_policy:second}]};
   else if(path.includes(encodeURIComponent(second.source_id))){if(delayOther){otherStarted=true;await new Promise(resolve=>{releaseOther=resolve;});}data={current:second,history:[],can_manage:canManage};}
   else if(path.endsWith("/usage-policy")){
    if(req.method()==="POST"){
     writes++;const body=req.postDataJSON();assert.equal(body.source_digest,digest);
     if(writes===1){status=409;current={...unknown,policy_revision:1,evidence_reference:"다른 검토자의 합성 근거",reason:"먼저 저장된 합성 기록",asserted_by:subject,created_at:"2026-10-01T00:00:00Z",verification:"USER_ATTESTED_UNVERIFIED"};history=[current];}
     else{assert.equal(body.expected_policy_revision,1);const {expected_policy_revision,...assertion}=body;current={...current,...assertion,policy_revision:2};history=[current,...history];}
    }
    if(denyRead){status=401;data={};}else data={current,history,can_manage:canManage};
   }else if(path.endsWith("/runs")||path.endsWith("/searches"))data=[];
   else if(path.endsWith("/capabilities"))data={enabled:false};
   else status=404;
   await route.fulfill({status,contentType:"application/json",body:JSON.stringify(data)});
  });
  await page.goto("http://127.0.0.1:5173");
  await page.evaluate(async run=>{
   const r=await import("/node_modules/.vite/deps/react.js"),React=r.default??r;
   const d=await import("/node_modules/.vite/deps/react-dom_client.js"),createRoot=(d.default??d).createRoot;
   const mui=await import("/node_modules/.vite/deps/@mui_material.js"),{theme}=await import("/src/theme.ts");
   const code=await(await fetch("/src/SourcePolicyManager.tsx")).text(),accessUrl=code.match(/from "([^\"]*\/AccessShell\.tsx[^\"]*)"/)[1];
   const {default:AccessShell}=await import(accessUrl),{ReviewTools}=await import("/src/ReviewNavigation.tsx");
   document.querySelector("#root")?.remove();const root=document.createElement("div");root.id="source-policy-qa";document.body.append(root);
   createRoot(root).render(React.createElement(mui.ThemeProvider,{theme},React.createElement(AccessShell,{},key=>React.createElement("main",{key,style:{padding:16,maxWidth:1000,margin:"auto"}},React.createElement(ReviewTools,{history:[{id:run,request:{asset:"합성 약물",nct_id:"NCT00000001"},status:"COMPLETE",created_at:"2026-10-01T00:00:00Z"}],disabled:false,onOpen:()=>{},onManual:()=>{}})))));
  },run);
  const root=page.locator("#source-policy-qa");
  await root.getByRole("button",{name:/최근 검토/}).click();
  await root.getByRole("button",{name:"출처 이용조건",exact:true}).focus();
  await page.keyboard.press("Enter");
  const reason=root.getByLabel("확인 사유",{exact:true}),evidence=root.getByLabel("허가 근거",{exact:true});
  await reason.waitFor();await evidence.fill("합성 허가 자료 위치");await reason.fill("충돌 뒤에도 보존할 확인 사유");
  assert.equal(writes,0);
  await root.getByRole("button",{name:"이용조건 기록",exact:true}).click();
  await root.getByRole("button",{name:"최신 이력 불러오기",exact:true}).waitFor();
  assert.equal(await reason.inputValue(),"충돌 뒤에도 보존할 확인 사유");
  assert(await root.getByRole("button",{name:"이용조건 기록",exact:true}).isDisabled());
  await root.getByRole("button",{name:"최신 이력 불러오기",exact:true}).click();
  await root.getByRole("button",{name:"이용조건 기록",exact:true}).click();
  await root.getByText("이용조건 확인 내용을 기록했습니다. 원문은 최근 조사에서 다시 열어 확인하세요.",{exact:true}).waitFor();
  assert.equal(writes,2);assert.equal(current.reason,"충돌 뒤에도 보존할 확인 사유");
  await page.screenshot({path:join(output,`policy-${width}.png`),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  delayOther=true;await root.getByLabel("이용조건을 확인할 출처",{exact:true}).click();await page.getByRole("option",{name:"합성 두 번째 출처",exact:true}).click();
  for(let i=0;i<30&&!otherStarted;i++)await page.waitForTimeout(20);
  assert(otherStarted);await root.getByLabel("이용조건을 확인할 출처",{exact:true}).click();await page.getByRole("option",{name:"합성 공개 논문 — 원문 조회 전에 이용조건 확인",exact:true}).click();
  releaseOther();await page.waitForTimeout(100);assert.equal(await reason.inputValue(),"충돌 뒤에도 보존할 확인 사유");
  assert.equal(await root.getByText(/paper:second/).count(),0);
  canManage=false;await root.getByRole("button",{name:"출처 목록 새로고침",exact:true}).click();
  await root.getByText("읽기 전용입니다. 실행 소유자 또는 팀 관리자에게 이용조건 확인을 요청하세요.",{exact:true}).waitFor();
  assert(await root.getByRole("button",{name:"이용조건 기록",exact:true}).isDisabled());
  denyRead=true;await root.getByRole("button",{name:"출처 목록 새로고침",exact:true}).click();
  await root.getByText("세션이 만료되었습니다",{exact:true}).waitFor();
  assert.deepEqual(errors,[]);console.log(JSON.stringify({width,writes,conflictPreserved:true,staleOtherSourceIgnored:true,keyboardEntry:true,revokedReadOnly:true,sessionExpired:true,overflow:false,pageerrors:errors}));
  await page.close();
 }
 console.log(JSON.stringify({output}));
}finally{await browser.close();}
