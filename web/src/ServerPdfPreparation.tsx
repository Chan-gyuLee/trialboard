import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Checkbox,FormControlLabel,MenuItem,TextField} from '@mui/material';
import {strictJson} from './field-review.ts';
import {readPreparationCapabilities,readPreparationList,readServerPdfPreparation,type PreparationCapabilities,type PreparationKey,type PreparationList,type ServerPdfPreparation as Prepared} from './server-pdf-preparation';
import PreparedPdfReview from './PreparedPdfReview';

const failure=(error:unknown)=>error instanceof Error?error.message:'서버 PDF 준비 요청을 확인하지 못했습니다.';
async function packet(path:string,signal:AbortSignal,body?:unknown){
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal,cache:'no-store'});
 if(!response.ok){
  const text=await response.text();let code='';try{const p=strictJson(text,10000) as {detail?:unknown};if(typeof p.detail==='string')code=p.detail;}catch{ /* Never display private raw errors. */ }
  const errors:Record<string,string>={UNSUPPORTED_SANDBOX:'현재 서버는 필요한 실행 제한을 지원하지 않아 본문 준비를 시작할 수 없습니다.',PDF_TEXT_UNAVAILABLE:'읽을 수 있는 텍스트가 없습니다. 스캔 문서의 OCR은 지원하지 않습니다.',PDF_ENCRYPTED_UNSUPPORTED:'암호화된 PDF는 서버 본문 준비를 지원하지 않습니다.',PDF_PAGE_LIMIT:'서버 본문 준비는 최대 10쪽까지 지원합니다.',PDF_TEXT_LIMIT:'추출 본문이 30,000자 한도를 초과했습니다.',PDF_PREPARATION_BUSY:'다른 PDF를 준비 중입니다. 완료 후 직접 다시 시도하세요.',PDF_POLICY_VERSION_CONFLICT:'PDF 이용조건이 바뀌었습니다. 파일 이용조건을 새로고침하세요.'};
  throw Error(errors[code]??(response.status===403?'현재 PDF 이용조건 또는 권한으로 준비본에 접근할 수 없습니다.':response.status===401?'로그인이 만료되었습니다.':response.status===409?'PDF·출처·준비본의 버전이 바뀌었습니다. 최신 파일을 확인하세요.':'서버 PDF 준비 요청을 완료하지 못했습니다. 자동 재시도하지 않았습니다.'));
 }
 return strictJson(await response.text(),500000);
}
export default function ServerPdfPreparation({target,policyRevision,canManage,disabled,externalAllowed=false}:{target:PreparationKey;policyRevision:number;canManage:boolean;disabled:boolean;externalAllowed?:boolean}){
 const [open,setOpen]=useState(false);
 return <div><Button disabled={disabled} aria-expanded={open} onClick={()=>setOpen(v=>!v)}>서버 PDF 본문 준비</Button>{open&&<PreparationPanel key={`${target.runId}:${target.sourceId}:${target.sourceDigest}:${target.pdfSha}:${policyRevision}`} target={target} policyRevision={policyRevision} canManage={canManage} disabled={disabled} externalAllowed={externalAllowed}/>}</div>;
}
function PreparationPanel({target,policyRevision,canManage,disabled,externalAllowed}:{target:PreparationKey;policyRevision:number;canManage:boolean;disabled:boolean;externalAllowed:boolean}){
 const base=`/api/research/runs/${encodeURIComponent(target.runId)}`,document=`${base}/documents/${encodeURIComponent(target.sourceId)}`;
 const query=new URLSearchParams({source_digest:target.sourceDigest,pdf_sha256:target.pdfSha});
 const [capability,setCapability]=useState<PreparationCapabilities|null>(null),[list,setList]=useState<PreparationList|null>(null),[selected,setSelected]=useState(''),[artifact,setArtifact]=useState<Prepared|null>(null),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef<AbortController|null>(null);
 function begin(){active.current?.abort();const next=new AbortController();active.current=next;setBusy(true);setError('');setArtifact(null);return next;}
 const alive=(control:AbortController)=>active.current===control&&!control.signal.aborted;
 async function refresh(){const control=begin();setConsent(false);setList(null);setCapability(null);setSelected('');try{
  const [c,l]=await Promise.all([packet('/api/research/pdf-preparation-capabilities',control.signal),packet(`${document}/pdf-preparations?${query}`,control.signal)]);
  const nextCap=readPreparationCapabilities(c),nextList=readPreparationList(l,target);
  if(alive(control)){setCapability(nextCap);setList(nextList);}
 }catch(e){if(alive(control))setError(failure(e));}finally{if(alive(control))setBusy(false);}}
 useEffect(()=>{void refresh();return()=>active.current?.abort();},[]);
 async function load(){const item=list?.preparations.find(v=>v.preparation_id===selected);if(!item||busy||disabled)return;const control=begin();try{
  const next=await readServerPdfPreparation(await packet(`${base}/pdf-preparations/${item.preparation_id}`,control.signal),target,{id:item.preparation_id,digest:item.preparation_digest});
  if(alive(control))setArtifact(next);
 }catch(e){if(alive(control))setError(failure(e));}finally{if(alive(control))setBusy(false);}}
 async function prepare(){if(!consent||!canManage||disabled||busy||capability?.status!=='RUNTIME_CHECK_REQUIRED')return;const control=begin();try{
  const next=await readServerPdfPreparation(await packet(`${document}/prepare-server`,control.signal,{consent:true,source_digest:target.sourceDigest,pdf_sha256:target.pdfSha,policy_revision:policyRevision}),target);
  if(next.policy_revision!==policyRevision)throw Error('준비한 PDF의 이용조건 이력이 요청과 다릅니다.');
  if(alive(control)){
   setArtifact(next);setConsent(false);setSelected(next.preparation_id);
   setList(previous=>({schema:'research-pdf-preparation-list/1',run_id:target.runId,source_id:target.sourceId,source_digest:target.sourceDigest,pdf_sha256:target.pdfSha,preparations:[{preparation_id:next.preparation_id,preparation_digest:next.preparation_digest,created_at:next.created_at,page_count:next.pages.length},...(previous?.preparations??[]).filter(item=>item.preparation_id!==next.preparation_id)].slice(0,30)}));
  }
 }catch(e){if(alive(control))setError(failure(e));}finally{if(alive(control))setBusy(false);}}
 return <section className="source-policy-panel" aria-label="서버 PDF 본문 준비" aria-busy={busy}>
  <header><h4>저장 원문에서 본문 준비</h4><Button disabled={busy||disabled} onClick={()=>void refresh()}>준비 상태 새로고침</Button></header>
  <p>서버에 저장한 정확한 PDF에서 본문을 읽습니다. 최대 5MB·10쪽·30,000자이며, 외부 AI는 호출하지 않습니다. OCR·표 좌표·임상 검증은 제공하지 않습니다.</p>
  {error&&<Alert severity="error">{error}</Alert>}
  {busy&&<p role="status">준비 요청을 확인하고 있습니다.</p>}
  {capability?.status==='UNSUPPORTED_SANDBOX'&&<Alert severity="warning">현재 서버는 필요한 실행 제한을 지원하지 않습니다. 새 본문 준비는 차단되며, 이미 저장된 준비본은 권한 확인 후 볼 수 있습니다.</Alert>}
  {capability?.status==='RUNTIME_CHECK_REQUIRED'&&<p>실행할 때마다 메모리·시간 제한을 확인하며, 제한을 적용할 수 없으면 준비하지 않습니다.</p>}
  {!canManage&&<p>읽기 전용입니다. 새 본문 준비는 실행 소유자 또는 팀 관리자가 할 수 있습니다.</p>}
  <FormControlLabel control={<Checkbox checked={consent} disabled={disabled||busy||!canManage||capability?.status!=='RUNTIME_CHECK_REQUIRED'} onChange={e=>setConsent(e.target.checked)}/>} label="이 PDF를 서버에서 읽어 별도 준비본으로 저장하는 데 동의합니다."/>
  <Button variant="contained" disabled={disabled||busy||!canManage||!consent||capability?.status!=='RUNTIME_CHECK_REQUIRED'} onClick={()=>void prepare()}>본문 준비 · AI 호출 없음</Button>
  <h4>저장된 준비본</h4><p>이 PDF 버전의 최근 준비본을 최대 30개 표시합니다.</p>
  {list?.preparations.length===0&&<p>저장된 준비본이 없습니다.</p>}
  {Boolean(list?.preparations.length)&&<><TextField fullWidth select label="준비본 선택" disabled={busy||disabled} value={selected} onChange={e=>{setSelected(e.target.value);setArtifact(null);}}><MenuItem value="">준비본을 선택하세요</MenuItem>{list!.preparations.map(item=><MenuItem key={item.preparation_id} value={item.preparation_id}>{new Date(item.created_at).toLocaleString('ko-KR')} · {item.page_count}쪽 · {item.preparation_id.slice(0,8)}</MenuItem>)}</TextField><Button disabled={busy||disabled||!selected} onClick={()=>void load()}>선택한 준비본 확인</Button></>}
  {artifact&&<section aria-label="서버 PDF 준비 결과"><h4>본문 준비 확인 · AI 호출 0회</h4><p>준비 이력 {artifact.policy_revision} · {artifact.pages.length}쪽 · {artifact.extractor}</p><p className="source-policy-identity">준비 지문 {artifact.preparation_digest}</p>{artifact.pages.map(page=><details key={page.page}><summary>{page.page}쪽 본문{!page.text.trim()?' · 텍스트 없음':''}</summary><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{page.text||'추출된 텍스트가 없습니다.'}</p></details>)}{artifact.notices.map((notice,i)=><p key={i}>{notice}</p>)}<p>AI 검토는 별도 전송 허가와 실행 동의가 필요합니다. 본문 준비만으로 실행되지 않습니다.</p></section>}
  {artifact&&<PreparedPdfReview key={`${artifact.preparation_id}:${artifact.preparation_digest}:${policyRevision}`} prepared={artifact} policyRevision={policyRevision} externalAllowed={externalAllowed} disabled={disabled||busy}/>}
 </section>;
}
