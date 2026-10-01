export type AccessModePacket = {mode:"legacy_loopback"|"team";tls:false;production_ready:false};
export type SessionPacket = {authenticated:true;subject:{id:string;username:string};team:{id:string;name:string};role:"admin"|"reviewer"|"viewer";permission_epoch:number;absolute_expires_at:number;idle_expires_at:number;session_context:string};

const nativeFetch=globalThis.fetch.bind(globalThis);
let modeRequest:Promise<AccessModePacket>|null=null;
type CsrfRequest={generation:number;promise:Promise<string>};
let csrfRequest:CsrfRequest|null=null;
let expectedContext:string|null=null;
let expectedIdentity:string|null=null;
let sessionGeneration=0;
let publicPreview=false;
const MAX_ERROR_BODY_BYTES=4096;

function apiPath(input:RequestInfo|URL):string|null{
  const raw=typeof input==="string"?input:input instanceof URL?input.href:input.url;
  try{const url=new URL(raw,globalThis.location?.origin??"http://localhost");return url.origin===(globalThis.location?.origin??url.origin)&&url.pathname.startsWith("/api/")?url.pathname:null;}catch{return null;}
}
function notify(name:string,detail?:unknown){if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent(name,{detail}));}
function contextHeaders(headers:Headers):number{
  if(!expectedContext){notify("trialboard:session-context-mismatch");throw Error("현재 팀 세션을 확인할 수 없습니다. 다시 로그인하세요.");}
  headers.set("X-TrialBoard-Session-Context",expectedContext);
  return sessionGeneration;
}
function assertCurrent(generation:number){
  if(generation!==sessionGeneration){notify("trialboard:session-context-mismatch");throw Error("세션이 바뀌어 이전 요청의 응답을 폐기했습니다.");}
}
export function setExpectedSession(session:SessionPacket){
  if(!/^[a-f0-9]{64}$/.test(session.session_context))throw Error("세션 컨텍스트 응답이 올바르지 않습니다.");
  const identity=`${session.subject.id}\u0000${session.team.id}\u0000${session.session_context}`;
  if(expectedIdentity!==identity){expectedContext=session.session_context;expectedIdentity=identity;sessionGeneration++;csrfRequest=null;}
}
export function clearExpectedSession(){expectedContext=null;expectedIdentity=null;sessionGeneration++;csrfRequest=null;}
export function resetAuthTransport(){modeRequest=null;csrfRequest=null;expectedContext=null;expectedIdentity=null;sessionGeneration++;publicPreview=false;}
export async function accessMode(request:typeof fetch=nativeFetch):Promise<AccessModePacket>{
  if(!modeRequest)modeRequest=request("/api/access-mode",{credentials:"include",cache:"no-store",redirect:"error"}).then(async response=>{
    if(!response.ok)throw Error("접근 모드를 확인하지 못했습니다. 서버 설정을 확인한 뒤 다시 시도하세요.");
    const value=await response.json();
    if(!value||!(["legacy_loopback","team"] as unknown[]).includes(value.mode))throw Error("서버 접근 모드 응답이 올바르지 않습니다.");
    return value as AccessModePacket;
  }).catch(error=>{modeRequest=null;throw error;});
  return modeRequest;
}
async function csrfToken(request:typeof fetch=nativeFetch):Promise<string>{
  if(!csrfRequest||csrfRequest.generation!==sessionGeneration){
    const headers=new Headers(),generation=contextHeaders(headers);
    let ticket:CsrfRequest;
    const promise=request("/api/auth/csrf",{headers,credentials:"include",cache:"no-store",redirect:"error"}).then(async response=>{
      assertCurrent(generation);
      if(response.status===401)notify("trialboard:session-expired");
      if(response.status===409&&await isSessionContextMismatch(response))notify("trialboard:session-context-mismatch");
      if(!response.ok)throw Error("쓰기 권한 확인이 만료되었습니다. 다시 로그인한 뒤 직접 다시 실행하세요.");
      const value=await response.json();
      if(!value||typeof value.csrf_token!=="string")throw Error("쓰기 권한 응답이 올바르지 않습니다.");
      return value.csrf_token;
    }).finally(()=>{if(csrfRequest===ticket)csrfRequest=null;});
    ticket={generation,promise};csrfRequest=ticket;
  }
  return csrfRequest.promise;
}
async function isSessionContextMismatch(response:Response):Promise<boolean>{
  if(response.headers.get("X-TrialBoard-Error-Code")==="SESSION_CONTEXT_MISMATCH")return true;
  const contentType=response.headers.get("Content-Type")??"";
  const declared=Number(response.headers.get("Content-Length"));
  if(!contentType.toLowerCase().includes("json")||(Number.isFinite(declared)&&declared>MAX_ERROR_BODY_BYTES))return false;
  const body=response.clone().body;if(!body)return false;
  const reader=body.getReader(),chunks:Uint8Array[]=[];let size=0;
  while(true){
    const result=await Promise.race([
      reader.read(),
      new Promise<null>(resolve=>setTimeout(()=>resolve(null),100)),
    ]);
    if(result===null){void reader.cancel().catch(()=>{});return false;}
    const {done,value}=result;if(done)break;
    size+=value.byteLength;if(size>MAX_ERROR_BODY_BYTES){void reader.cancel().catch(()=>{});return false;}chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes))?.error?.code==="SESSION_CONTEXT_MISMATCH";}catch{return false;}
}
export async function authenticatedFetch(input:RequestInfo|URL,init:RequestInit={}):Promise<Response>{
  const path=apiPath(input);if(!path)return nativeFetch(input,init);
  if(publicPreview)throw Error("공개 미리보기에서는 인증 API를 사용할 수 없습니다.");
  const mode=await accessMode();
  const method=(init.method??(input instanceof Request?input.method:"GET")).toUpperCase();
  const headers=new Headers(init.headers??(input instanceof Request?input.headers:undefined));
  let generation=sessionGeneration;
  if(mode.mode==="team")generation=contextHeaders(headers);
  if(mode.mode==="team"&&!["GET","HEAD","OPTIONS"].includes(method)&&path!=="/api/auth/login")headers.set("X-CSRF-Token",await csrfToken());
  if(mode.mode==="team")assertCurrent(generation);
  const response=await nativeFetch(input,{...init,headers,credentials:mode.mode==="team"?"include":init.credentials});
  if(mode.mode==="team")assertCurrent(generation);
  if(mode.mode==="team"&&response.status===401)notify("trialboard:session-expired");
  if(mode.mode==="team"&&response.status===409&&await isSessionContextMismatch(response))notify("trialboard:session-context-mismatch");
  if(mode.mode==="team"&&response.status===403&&!["GET","HEAD","OPTIONS"].includes(method)){
    csrfRequest=null;notify("trialboard:write-rejected");
  }
  return response;
}
export function installAuthenticatedFetch(options:{publicPreview?:boolean}={}){publicPreview=options.publicPreview===true;globalThis.fetch=authenticatedFetch as typeof fetch;}
export async function currentSession():Promise<SessionPacket|null>{
  const response=await nativeFetch("/api/auth/session",{credentials:"include",cache:"no-store",redirect:"error"});
  if(response.status===401)return null;if(!response.ok)throw Error("세션 상태를 확인하지 못했습니다.");return response.json();
}
export async function login(username:string,password:string):Promise<SessionPacket>{
  const challengeResponse=await nativeFetch("/api/auth/login-challenge",{credentials:"include",cache:"no-store",redirect:"error"});
  if(!challengeResponse.ok)throw Error(challengeResponse.status===429?"로그인 시도가 많습니다. 잠시 뒤 다시 시도하세요.":"로그인 확인값을 받지 못했습니다.");
  const challenge=await challengeResponse.json();
  const response=await nativeFetch("/api/auth/login",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json","X-CSRF-Token":challenge.csrf_token},body:JSON.stringify({username,password}),redirect:"error"});
  if(!response.ok)throw Error(response.status===429?"로그인 시도가 많습니다. 잠시 뒤 다시 시도하세요.":"아이디 또는 비밀번호를 확인하세요.");
  csrfRequest=null;return response.json();
}
export async function logout(){const response=await authenticatedFetch("/api/auth/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});if(!response.ok)throw Error("로그아웃하지 못했습니다.");clearExpectedSession();}
