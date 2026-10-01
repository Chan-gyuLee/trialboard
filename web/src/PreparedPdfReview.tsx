import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Checkbox,FormControlLabel} from '@mui/material';
import {useTeamSession} from './AccessShell';
import {strictJson} from './field-review.ts';
import {readPdfReviewArtifact,readPdfReviewAttempts,readPdfReviewStream,type PdfReviewArtifact} from './prepared-pdf-review';
import type {ServerPdfPreparation} from './server-pdf-preparation';
import type {AttemptSummary} from './saved-research-review';
import SavedReviewUsage from './SavedReviewUsage';

const labels={RUNNING:'종료 기록 없음',COMPLETED:'검토 완료',FAILED:'검토 실패',CANCELLED:'중단됨'};
const problems:Record<string,string>={MODEL_POLICY_DENIED:'권한 또는 이용조건이 바뀌어 결과를 게시하지 않았습니다.',MODEL_FAILED:'모델 요청을 완료하지 못했습니다.',MODEL_RESPONSE_REJECTED:'응답이 PDF 인용 검증을 통과하지 못했습니다.',CANCELLED:'요청 대기를 중단했습니다.'};
const describe=(error:unknown)=>error instanceof Error?error.message:'PDF 검토를 완료하지 못했습니다.';
async function json(path:string,signal:AbortSignal){
 const response=await fetch(path,{signal,cache:'no-store'});
 if(!response.ok)throw Error(response.status===403?'현재 PDF 권한 또는 이용조건으로 이 결과를 볼 수 없습니다.':response.status===401?'로그인이 만료되었습니다.':response.status===409?'PDF·준비본의 내용이나 버전이 바뀌었습니다. 다시 확인하세요.':'PDF 검토 기록을 불러오지 못했습니다.');
 return strictJson(await response.text(),250000);
}
export default function PreparedPdfReview({prepared,policyRevision,externalAllowed,disabled}:{prepared:ServerPdfPreparation;policyRevision:number;externalAllowed:boolean;disabled:boolean}){
 const session=useTeamSession(),canReview=session?.role==='admin'||session?.role==='reviewer';
 const base=`/api/research/runs/${encodeURIComponent(prepared.run_id)}`;
 const [attempts,setAttempts]=useState<AttemptSummary[]>([]),[artifact,setArtifact]=useState<PdfReviewArtifact|null>(null),[consent,setConsent]=useState(false),[loading,setLoading]=useState(false),[running,setRunning]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[usageRevision,setUsageRevision]=useState(0);
 const active=useRef<AbortController|null>(null);
 function begin(){active.current?.abort();const controller=new AbortController();active.current=controller;setError('');return controller;}
 const alive=(controller:AbortController)=>active.current===controller&&!controller.signal.aborted;
 async function refresh(){const control=begin();setLoading(true);setArtifact(null);setConsent(false);setNotice('');try{
  const next=readPdfReviewAttempts(await json(`${base}/pdf-review-attempts?${new URLSearchParams({preparation_id:prepared.preparation_id})}`,control.signal),prepared.run_id,prepared.preparation_id);
  if(alive(control))setAttempts(next);
 }catch(e){if(alive(control)){setAttempts([]);setError(describe(e));}}finally{if(alive(control)){setLoading(false);setUsageRevision(v=>v+1);}}}
 useEffect(()=>{void refresh();return()=>active.current?.abort();},[prepared.preparation_id,prepared.preparation_digest]);
 async function open(id:string){const control=begin();setLoading(true);setArtifact(null);try{
  const next=await readPdfReviewArtifact(await json(`${base}/pdf-review-attempts/${id}`,control.signal),prepared,id);
  if(alive(control))setArtifact(next);
 }catch(e){if(alive(control))setError(describe(e));}finally{if(alive(control))setLoading(false);}}
 async function run(){if(disabled||loading||running||!canReview||!externalAllowed||!consent)return;const control=begin();setRunning(true);setArtifact(null);setNotice('PDF 전송 조건을 확인하고 있습니다.');try{
  const response=await fetch(`${base}/review-prepared-pdf`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model_consent:true,preparation_id:prepared.preparation_id,preparation_digest:prepared.preparation_digest,policy_revision:policyRevision}),signal:control.signal});
  if(!response.ok)throw Error(response.status===403?'현재 권한이나 PDF 외부 AI 전송 허가로는 실행할 수 없습니다.':response.status===409?'준비본·이용조건이 바뀌었거나 다른 모델 작업이 실행 중입니다. 최신 상태를 확인하세요.':response.status===401?'로그인이 만료되었습니다.':'PDF 검토를 시작하지 못했습니다. 자동 재시도하지 않았습니다.');
  if(!alive(control)){await response.body?.cancel();return;}
  const id=await readPdfReviewStream(response,prepared.run_id,id=>{if(alive(control))setNotice(`PDF 검토 요청을 시작했습니다. 실행 ${id}`);});
  if(!alive(control))return;
  const next=await readPdfReviewArtifact(await json(`${base}/pdf-review-attempts/${id}`,control.signal),prepared,id,policyRevision);
  if(!alive(control))return;
  setArtifact(next);setConsent(false);setNotice('');
  const history=readPdfReviewAttempts(await json(`${base}/pdf-review-attempts?${new URLSearchParams({preparation_id:prepared.preparation_id})}`,control.signal),prepared.run_id,prepared.preparation_id);
  if(alive(control))setAttempts(history);
 }catch(e){if(alive(control)){setArtifact(null);setError(describe(e));}}finally{if(alive(control)){setRunning(false);setUsageRevision(v=>v+1);}}}
 function cancel(){active.current?.abort();active.current=null;setRunning(false);setLoading(false);setConsent(false);setArtifact(null);setNotice('대기를 중단했습니다. 이미 전송한 요청의 사용량은 취소되지 않을 수 있습니다. 검토 기록을 새로고침하세요.');}
 const locked=disabled||loading||running;
 return <section className="source-policy-panel" aria-label="준비된 PDF AI 검토" aria-busy={loading||running}>
  <header><h4>이 준비본을 AI로 검토</h4><Button disabled={locked} onClick={()=>void refresh()}>PDF 검토 기록 새로고침</Button></header>
  <p>확인한 준비본의 텍스트만 외부 AI에 보냅니다. 새 검색·원문 다운로드·OCR·수치 자동 검증은 하지 않으며, 원래 준비본은 변경하지 않습니다.</p>
  {!canReview&&<p>읽기 전용입니다. 검토 실행은 검토자 또는 팀 관리자만 할 수 있습니다.</p>}
  {!externalAllowed&&<Alert severity="info">PDF 파일의 외부 AI 전송 허가가 필요합니다. 위 파일 이용조건에서 근거를 확인해 별도로 기록하세요. 본문 준비 동의는 전송 동의가 아닙니다.</Alert>}
  {error&&<Alert severity="error">{error}</Alert>}{notice&&<p role="status">{notice}</p>}
  <FormControlLabel control={<Checkbox checked={consent} disabled={locked||!canReview||!externalAllowed} onChange={e=>setConsent(e.target.checked)}/>} label="선택한 서버 준비본의 텍스트를 외부 AI에 한 번 보내는 데 동의합니다."/>
  <div className="source-policy-actions"><Button variant="contained" disabled={locked||!canReview||!externalAllowed||!consent} onClick={()=>void run()}>이 준비본 검토 · AI 1회</Button>{running&&<Button onClick={cancel}>PDF 검토 대기 중단</Button>}</div>
  <p>준비 당시 이력 {prepared.policy_revision} · 현재 전송 허가 이력 {policyRevision}. 실제 요청 직전에 서버가 권리와 내용을 다시 확인합니다.</p>
  {attempts.some(a=>a.status==='RUNNING')&&<Alert severity="info">종료 기록이 없는 요청은 실행 중이거나 중단된 상태일 수 있습니다. 호출 수·토큰은 미확정이며 자동으로 다시 실행하지 않습니다.</Alert>}
  <details><summary>이 준비본의 검토 기록 ({attempts.length})</summary>{attempts.map(attempt=><div key={attempt.attempt_id}><Button disabled={locked} onClick={()=>void open(attempt.attempt_id)}>{new Date(attempt.created_at).toLocaleString('ko-KR')} · {labels[attempt.status]} · {attempt.status==='RUNNING'?'호출 수 미확정':`호출 ${attempt.model_calls}회`}</Button></div>)}</details>
  {artifact&&<section aria-label="PDF AI 검토 결과"><h4>{labels[artifact.status]}</h4><p>{artifact.status==='RUNNING'?'호출 수 미확정':`AI 호출 ${artifact.model_calls}회`} · PDF 전문 임상 검증이 아닙니다.</p>{artifact.error_code&&<Alert severity="warning">{problems[artifact.error_code]}</Alert>}{artifact.review&&<><p>{artifact.review.conclusion==='INSUFFICIENT_EVIDENCE'?'근거가 부족합니다.':'전문가 검토가 필요합니다.'}</p>{artifact.review.findings.map(f=><article key={f.anchor_id}><h5>{f.page}쪽 원문</h5><blockquote>{f.quote}</blockquote><p>{f.interpretation}</p><small>본문 문자 위치 {f.start}–{f.end} · 유니코드 문자 기준</small></article>)}{artifact.review.questions.length>0&&<><h5>후속 검토 질문</h5><ul>{artifact.review.questions.map((q,i)=><li key={i}>{q}</li>)}</ul></>}</>}{artifact.notices.map((n,i)=><p key={i}>{n}</p>)}</section>}
  {usageRevision>0&&<SavedReviewUsage runId={prepared.run_id} revision={usageRevision} kind="pdf"/>}
 </section>;
}
