import test from "node:test";
import assert from "node:assert/strict";

globalThis.location={origin:"http://127.0.0.1:5173"};
globalThis.window=new EventTarget();
if(!globalThis.CustomEvent)globalThis.CustomEvent=class CustomEvent extends Event{constructor(type,options={}){super(type);this.detail=options.detail;}};
const calls=[];
let mode="team",csrfCalls=0,writeStatus=200,responseCode=null,slowPending=false,slowResolve=null,holdCsrf=false,csrfResolvers=[];
globalThis.fetch=async(input,init={})=>{
  const path=typeof input==="string"?input:new URL(input.url).pathname;
  calls.push({path,init});
  if(path==="/api/access-mode")return Response.json({mode,tls:false,production_ready:false});
  if(path==="/api/auth/csrf"){csrfCalls++;if(holdCsrf)return new Promise(resolve=>csrfResolvers.push(()=>resolve(Response.json({csrf_token:"c".repeat(43)}))));await new Promise(resolve=>setTimeout(resolve,5));return Response.json({csrf_token:"c".repeat(43)});}
  if(path==="/api/oversized")return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(5000));}}),{status:409,headers:{"Content-Type":"application/json"}});
  if(slowPending&&path==="/api/slow")await new Promise(resolve=>{slowResolve=resolve;});
  return Response.json(responseCode?{error:{code:responseCode}}:{}, {status:writeStatus});
};
const {authenticatedFetch,clearExpectedSession,installAuthenticatedFetch,resetAuthTransport,setExpectedSession}=await import("../src/auth-client.ts");
const session=(context="a".repeat(64))=>({authenticated:true,subject:{id:"user-a",username:"alpha"},team:{id:"team-a",name:"Alpha"},role:"admin",permission_epoch:1,absolute_expires_at:2000,idle_expires_at:1500,session_context:context});

test("TEAM requests include cookies and share one in-flight CSRF fetch",async()=>{
  calls.length=0;csrfCalls=0;mode="team";resetAuthTransport();
  setExpectedSession(session());
  await Promise.all([
    authenticatedFetch("/api/one",{method:"POST",credentials:"omit"}),
    authenticatedFetch("/api/two",{method:"DELETE",credentials:"omit"}),
  ]);
  assert.equal(csrfCalls,1);
  const writes=calls.filter(call=>call.path.startsWith("/api/")&&!call.path.includes("access-mode")&&!call.path.includes("csrf"));
  assert.equal(writes.length,2);
  for(const call of writes){assert.equal(call.init.credentials,"include");assert.equal(new Headers(call.init.headers).get("x-csrf-token"),"c".repeat(43));assert.equal(new Headers(call.init.headers).get("x-trialboard-session-context"),"a".repeat(64));}
});

test("rejected writes are not silently retried",async()=>{
  calls.length=0;csrfCalls=0;writeStatus=403;mode="team";resetAuthTransport();
  setExpectedSession(session());
  const response=await authenticatedFetch("/api/write",{method:"PATCH",body:"{}"});
  assert.equal(response.status,403);
  assert.equal(calls.filter(call=>call.path==="/api/write").length,1);
  writeStatus=200;
});

test("legacy mode preserves caller credential behavior",async()=>{
  calls.length=0;csrfCalls=0;mode="legacy_loopback";resetAuthTransport();
  await authenticatedFetch("/api/read",{credentials:"omit"});
  assert.equal(calls.at(-1).init.credentials,"omit");
  assert.equal(csrfCalls,0);
});

test("same-session visibility refresh preserves an outstanding valid response",async()=>{
  calls.length=0;mode="team";resetAuthTransport();setExpectedSession(session());
  slowPending=true;
  const pending=authenticatedFetch("/api/slow");
  while(!slowResolve)await new Promise(resolve=>setTimeout(resolve,0));
  setExpectedSession(session());
  slowResolve();slowPending=false;slowResolve=null;
  assert.equal((await pending).status,200);
});

test("a response from before logout is discarded after same-user login",async()=>{
  calls.length=0;mode="team";resetAuthTransport();setExpectedSession(session());
  slowPending=true;
  const pending=authenticatedFetch("/api/slow");
  while(!slowResolve)await new Promise(resolve=>setTimeout(resolve,0));
  clearExpectedSession();setExpectedSession(session());
  slowResolve();slowPending=false;slowResolve=null;
  await assert.rejects(pending,/이전 요청의 응답을 폐기/);
});

test("same-user reauthentication permits new requests without retrying old writes",async()=>{
  calls.length=0;mode="team";writeStatus=200;resetAuthTransport();setExpectedSession(session());
  setExpectedSession(session());
  const response=await authenticatedFetch("/api/read");
  assert.equal(response.status,200);
  assert.equal(calls.filter(call=>call.path==="/api/read").length,1);
});

test("ordinary 409 conflicts remain available to caller without locking auth",async()=>{
  calls.length=0;mode="team";writeStatus=409;responseCode="PROJECT_VERSION_CONFLICT";resetAuthTransport();setExpectedSession(session());
  let locks=0;const listener=()=>{locks++;};window.addEventListener("trialboard:session-context-mismatch",listener);
  const response=await authenticatedFetch("/api/project",{method:"PATCH",body:"{}"});
  window.removeEventListener("trialboard:session-context-mismatch",listener);
  assert.equal(response.status,409);assert.equal((await response.json()).error.code,"PROJECT_VERSION_CONFLICT");assert.equal(locks,0);assert.equal(calls.filter(call=>call.path==="/api/project").length,1);
  writeStatus=200;responseCode=null;
});

test("only SESSION_CONTEXT_MISMATCH 409 locks authentication",async()=>{
  calls.length=0;mode="team";writeStatus=409;responseCode="SESSION_CONTEXT_MISMATCH";resetAuthTransport();setExpectedSession(session());
  let locks=0;const listener=()=>{locks++;};window.addEventListener("trialboard:session-context-mismatch",listener);
  const response=await authenticatedFetch("/api/project");
  window.removeEventListener("trialboard:session-context-mismatch",listener);
  assert.equal(response.status,409);assert.equal((await response.json()).error.code,"SESSION_CONTEXT_MISMATCH");assert.equal(locks,1);
  writeStatus=200;responseCode=null;
});

test("oversized ordinary 409 does not hang or consume the original response",async()=>{
  mode="team";resetAuthTransport();setExpectedSession(session());
  const started=Date.now();
  const response=await authenticatedFetch("/api/oversized");
  assert.ok(Date.now()-started<1000);assert.equal(response.status,409);
  const reader=response.body.getReader();const first=await reader.read();
  assert.equal(first.value.byteLength,5000);void reader.cancel();
});

test("an old CSRF completion cannot clear the new generation request",async()=>{
  calls.length=0;csrfCalls=0;mode="team";writeStatus=200;holdCsrf=true;csrfResolvers=[];resetAuthTransport();setExpectedSession(session());
  const oldWrite=authenticatedFetch("/api/old",{method:"POST"});
  while(csrfResolvers.length<1)await new Promise(resolve=>setTimeout(resolve,0));
  setExpectedSession(session("b".repeat(64)));
  const newWrite=authenticatedFetch("/api/new",{method:"POST"});
  while(csrfResolvers.length<2)await new Promise(resolve=>setTimeout(resolve,0));
  csrfResolvers[0]();await assert.rejects(oldWrite,/이전 요청의 응답을 폐기/);
  const sharedWrite=authenticatedFetch("/api/shared",{method:"POST"});
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(csrfCalls,2);
  csrfResolvers[1]();await Promise.all([newWrite,sharedWrite]);
  holdCsrf=false;csrfResolvers=[];
});

test("explicit public preview blocks API network calls",async()=>{
  calls.length=0;resetAuthTransport();installAuthenticatedFetch({publicPreview:true});
  await assert.rejects(authenticatedFetch("/api/read"),/공개 미리보기/);
  assert.equal(calls.length,0);
  resetAuthTransport();
});
