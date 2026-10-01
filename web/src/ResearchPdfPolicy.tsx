import {useEffect,useId,useRef,useState} from 'react';
import {Alert,Button,Checkbox,FormControlLabel,MenuItem,TextField} from '@mui/material';
import {useTeamSession} from './AccessShell';
import {strictJson} from './field-review.ts';
import {purposes,type PolicyDraft,type Purpose} from './research-source-policy';
import {readPdfHistory,readPdfMetadata,verifiedPdfBytes,type PdfMetadata,type PdfPolicyHistory,type PdfSource,type PdfVersion} from './research-pdf-policy';
import './source-policy.css';
import ServerPdfPreparation from './ServerPdfPreparation';
const decisions={ALLOW:'허용',DENY:'금지',UNKNOWN:'미확인'};
const labels:Record<Purpose,string>={original_storage:'PDF 저장·조회',internal_search:'내부 검색 (기록)',external_ai:'외부 AI 전송',training:'학습 (기록)'};
const message=(e:unknown)=>e instanceof Error?e.message:'PDF 이용조건을 확인하지 못했습니다.';
class PdfError extends Error{constructor(readonly status:number){super(status===409?'파일·출처 버전 또는 이용조건이 바뀌었습니다. 작성한 내용은 유지했습니다. 최신 정보를 확인하세요.':status===403?'PDF 이용조건 또는 관리 권한이 허용되지 않습니다.':status===401?'로그인이 만료되었습니다.':'PDF 이용조건 요청을 완료하지 못했습니다.');}}
async function request(path:string,signal:AbortSignal,body?:unknown){const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal,cache:'no-store'});if(!r.ok)throw new PdfError(r.status);return r;}
async function packet(path:string,signal:AbortSignal,body?:unknown){const raw=await(await request(path,signal,body)).text();return strictJson(raw,8_000_000);}
const blank:PolicyDraft={original_storage:'UNKNOWN',internal_search:'UNKNOWN',external_ai:'UNKNOWN',training:'UNKNOWN',evidence_reference:'',reason:''};
export default function ResearchPdfPolicy({runId,disabled=false}:{runId:string;disabled?:boolean}){
 const session=useTeamSession(),[expanded,setExpanded]=useState(false),id=useId();if(!session)return null;
 return <div className="source-policy-entry"><Button disabled={disabled} aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(v=>!v)}>PDF 이용조건</Button>{expanded&&<div id={id}><PdfPanel key={runId} runId={runId} disabled={disabled}/></div>}</div>;
}
function PdfPanel({runId,disabled}:{runId:string;disabled:boolean}){
 const [data,setData]=useState<PdfMetadata|null>(null),[selected,setSelected]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[reload,setReload]=useState(0);
 useEffect(()=>{const controller=new AbortController();setLoading(true);setData(null);setError('');void packet(`/api/research/runs/${encodeURIComponent(runId)}/pdf-metadata`,controller.signal).then(v=>{const next=readPdfMetadata(v,runId);if(controller.signal.aborted)return;setData(next);const sources=next.sources.filter(s=>s.download_available||s.cached_versions.length);setSelected(old=>sources.some(s=>s.source_id===old)?old:sources[0]?.source_id??'');}).catch(e=>{if(!controller.signal.aborted)setError(message(e));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[runId,reload]);
 const sources=data?.sources.filter(s=>s.download_available||s.cached_versions.length)??[],source=sources.find(s=>s.source_id===selected);
 return <section className="source-policy-panel" aria-label="PDF 이용조건 관리" aria-busy={loading}>
  <header><h3>PDF 파일별 이용조건</h3><Button disabled={loading||disabled} onClick={()=>setReload(v=>v+1)}>PDF 목록 새로고침</Button></header>
  <p>초록·본문 텍스트와 PDF 파일의 허가는 별개입니다. 파일 지문에 연결된 이용조건을 확인합니다. 출처를 바꾸거나 목록을 새로고침하면 작성 중인 내용은 초기화됩니다.</p>
  {error&&<Alert severity="error">{error}</Alert>}{loading&&<p role="status">저장된 PDF 정보를 확인하고 있습니다.</p>}
  {!loading&&!sources.length&&<p>다운로드 가능한 PDF나 저장된 PDF가 없습니다.</p>}
  {sources.length>0&&<TextField select fullWidth label="PDF 출처" value={selected} disabled={disabled} onChange={e=>setSelected(e.target.value)}>{sources.map(s=><MenuItem key={s.source_id} value={s.source_id}>{s.title}</MenuItem>)}</TextField>}
  {source&&<PdfSourceEditor key={`${source.source_id}:${source.source_digest}:${reload}`} runId={runId} source={source} canManage={Boolean(data?.can_manage)} disabled={disabled} onRefresh={()=>setReload(v=>v+1)}/>}
 </section>;
}
function PdfSourceEditor({runId,source,canManage,disabled,onRefresh}:{runId:string;source:PdfSource;canManage:boolean;disabled:boolean;onRefresh:()=>void}){
 const session=useTeamSession(),[sha,setSha]=useState(source.cached_versions.length===1?source.cached_versions[0].pdf_sha256:''),[evidence,setEvidence]=useState(''),[reason,setReason]=useState(''),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
 const controller=useRef(new AbortController());useEffect(()=>{controller.current=new AbortController();return()=>controller.current.abort();},[]);
 const canWrite=canManage&&(session?.role==='admin'||session?.role==='reviewer'),version=source.cached_versions.find(v=>v.pdf_sha256===sha);
 async function download(){
  if(!canWrite||busy||disabled||!consent||!evidence.trim()||!reason.trim())return;setBusy(true);setError('');
  try{const response=await request(`/api/research/runs/${encodeURIComponent(runId)}/documents/${encodeURIComponent(source.source_id)}`,controller.current.signal,{consent:true,source_digest:source.source_digest,storage_permission:{original_storage:'ALLOW',evidence_reference:evidence,reason}});
   await verifiedPdfBytes(response,controller.current.signal);
   if(controller.current.signal.aborted)return;setDone(true);setConsent(false);
  }catch(e){if(!controller.current.signal.aborted)setError(message(e));}finally{if(!controller.current.signal.aborted)setBusy(false);}
 }
 return <div className="source-policy-editor">
  <p className="source-policy-identity">{source.source_id}<br/>출처 지문 {source.source_digest}</p>
  {!canWrite&&<p>읽기 전용입니다. 실행 소유자 또는 팀 관리자에게 허가 확인을 요청하세요.</p>}
  {source.cached_versions.length>0?<>
   <TextField select fullWidth label="저장된 PDF 버전" value={sha} disabled={disabled} onChange={e=>setSha(e.target.value)}><MenuItem value="">파일 버전을 선택하세요</MenuItem>{source.cached_versions.map(v=><MenuItem key={v.pdf_sha256} value={v.pdf_sha256}>{v.pdf_sha256.slice(0,16)}… · {v.byte_length.toLocaleString('ko-KR')}바이트</MenuItem>)}</TextField>
   {version&&<PdfVersionEditor key={`${source.source_digest}:${sha}`} runId={runId} source={source} version={version} canManage={canWrite} disabled={disabled}/>}
  </>:source.download_available?<>
   <h4>다운로드 전 저장 허가 확인</h4><p>이 요청으로 받은 PDF 파일에만 저장 허가를 기록합니다. 외부 AI 전송·학습은 허용하지 않습니다. 근거를 확인하지 못했다면 다운로드하지 마세요.</p>
   <TextField fullWidth label="PDF 저장 허가 근거" value={evidence} disabled={!canWrite||busy||disabled||done} onChange={e=>setEvidence(e.target.value)} slotProps={{htmlInput:{maxLength:2000}}}/>
   <TextField fullWidth multiline minRows={2} label="PDF 저장 확인 사유" value={reason} disabled={!canWrite||busy||disabled||done} onChange={e=>setReason(e.target.value)} slotProps={{htmlInput:{maxLength:4000}}}/>
   <FormControlLabel control={<Checkbox checked={consent} disabled={!canWrite||busy||disabled||done} onChange={e=>setConsent(e.target.checked)}/>} label="해당 출처의 PDF를 다운로드하여 저장할 권리를 확인했습니다."/>
   {error&&<Alert severity="error">{error}</Alert>}{done&&<Alert severity="success">PDF 저장과 수신 지문 확인을 마쳤습니다. 목록을 새로고침해 해당 파일의 이용조건을 확인하세요.</Alert>}
   <div className="source-policy-actions"><Button variant="contained" disabled={!canWrite||busy||disabled||done||!consent||!evidence.trim()||!reason.trim()} onClick={()=>void download()}>{busy?'PDF 확인 중':'허가 확인 후 PDF 저장'}</Button>{done&&<Button onClick={onRefresh}>저장된 PDF 확인</Button>}</div>
  </>:<p>이 출처에는 다운로드 가능한 PDF가 없습니다.</p>}
 </div>;
}
function PdfVersionEditor({runId,source,version,canManage,disabled}:{runId:string;source:PdfSource;version:PdfVersion;canManage:boolean;disabled:boolean}){
 const base=`/api/research/runs/${encodeURIComponent(runId)}/documents/${encodeURIComponent(source.source_id)}`,query=new URLSearchParams({source_digest:source.source_digest,pdf_sha256:version.pdf_sha256}).toString();
 const [data,setData]=useState<PdfPolicyHistory|null>(null),[draft,setDraft]=useState<PolicyDraft>(blank),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[conflict,setConflict]=useState(false),[revoked,setRevoked]=useState(false);
 const controller=useRef(new AbortController()),sequence=useRef(0);
 const parse=(v:unknown)=>readPdfHistory(v,runId,source.source_id,source.source_digest,version.pdf_sha256);
 const alive=(ticket:number)=>!controller.current.signal.aborted&&ticket===sequence.current;
 async function load(preserve=false){const ticket=++sequence.current;setBusy(true);setError('');try{const next=parse(await packet(`${base}/usage-policy?${query}`,controller.current.signal));if(!alive(ticket))return;setData(next);setConflict(false);setRevoked(false);if(!preserve){const p=next.current;setDraft({original_storage:p.original_storage,internal_search:p.internal_search,external_ai:p.external_ai,training:p.training,evidence_reference:p.evidence_reference??'',reason:p.reason??''});}}catch(e){if(alive(ticket)){setError(message(e));setRevoked(true);}}finally{if(alive(ticket))setBusy(false);}}
 useEffect(()=>{controller.current=new AbortController();void load();return()=>{controller.current.abort();sequence.current++;};},[]);
 async function save(){if(!data||!canManage||!data.can_manage||busy||disabled||conflict||revoked)return;const ticket=++sequence.current;setBusy(true);setError('');setNotice('');try{const next=parse(await packet(`${base}/usage-policy`,controller.current.signal,{...draft,source_digest:source.source_digest,pdf_sha256:version.pdf_sha256,expected_policy_revision:data.current.policy_revision}));if(next.current.policy_revision!==data.current.policy_revision+1)throw Error('저장된 정책 이력이 요청과 다릅니다.');if(alive(ticket)){setData(next);setNotice('이 파일 버전의 이용조건을 기록했습니다.');}}catch(e){if(alive(ticket)){setError(message(e));if(e instanceof PdfError&&e.status===409)setConflict(true);else setRevoked(true);}}finally{if(alive(ticket))setBusy(false);}}
 async function saveFile(){
  if(disabled||busy||conflict||revoked||data?.current.original_storage!=='ALLOW')return;
  const ticket=++sequence.current,signal=controller.current.signal;setBusy(true);setError('');setNotice('');
  try{
   const response=await request(`${base}/cached?${new URLSearchParams({sha256:version.pdf_sha256})}`,signal);
   const bytes=await verifiedPdfBytes(response,signal,version.pdf_sha256);if(!alive(ticket))return;
   const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
   try{const anchor=document.createElement('a');anchor.href=url;anchor.download=`trialboard-${version.pdf_sha256}.pdf`;anchor.click();}
   finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
   setNotice('선택한 PDF의 권리와 지문을 확인하고 파일 저장을 요청했습니다. 이미 저장한 파일은 권리 철회로 삭제되지 않습니다.');
  }catch(e){if(alive(ticket)){setError(message(e));setRevoked(true);}}
  finally{if(alive(ticket))setBusy(false);}
 }
 const locked=disabled||busy||!canManage||!data?.can_manage||conflict||revoked;
 return <div className="source-policy-editor">
  <p className="source-policy-identity">PDF SHA-256 {version.pdf_sha256}</p>
  <Button disabled={disabled||busy||conflict||revoked||data?.current.original_storage!=='ALLOW'} onClick={()=>void saveFile()}>선택한 PDF 파일 저장</Button>
  {version.binding_status==='LEGACY_UNBOUND'&&data?.current.policy_revision===0&&<Alert severity="warning">이전 저장본은 출처 버전 결속과 허가가 확인되지 않았습니다. 명시적으로 이 파일의 이용조건을 확인해야 합니다.</Alert>}
  {error&&<Alert severity="error">{error}</Alert>}{notice&&<Alert severity="success">{notice}</Alert>}
  {(conflict||revoked)&&<Button disabled={busy} onClick={()=>void load(true)}>최신 PDF 이력 불러오기</Button>}
  <div className="source-policy-purpose-grid">{purposes.map(p=><TextField select fullWidth key={p} label={labels[p]} value={draft[p]} disabled={locked} onChange={e=>setDraft(v=>({...v,[p]:e.target.value}))}>{Object.entries(decisions).map(([value,label])=><MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>)}</div>
  <TextField fullWidth label="파일 이용 허가 근거" value={draft.evidence_reference} disabled={locked} onChange={e=>setDraft(v=>({...v,evidence_reference:e.target.value}))} slotProps={{htmlInput:{maxLength:2000}}}/>
  <TextField fullWidth multiline minRows={2} label="파일 이용 확인 사유" value={draft.reason} disabled={locked} onChange={e=>setDraft(v=>({...v,reason:e.target.value}))} slotProps={{htmlInput:{maxLength:4000}}}/>
  <p>PDF 저장·조회와 서버 준비본의 외부 AI 전송에 각각의 조건을 적용합니다. 전송 허가만으로 AI가 실행되지는 않으며, 준비본을 확인한 뒤 별도로 동의해야 합니다. 내부 검색·학습은 기록만 합니다. 사용자의 진술이지 법적 권리 인증은 아닙니다.</p>
  <Button variant="contained" disabled={locked||data?.current.policy_revision===100||!draft.evidence_reference.trim()||!draft.reason.trim()} onClick={()=>void save()}>PDF 이용조건 기록</Button>
  {data?.current.original_storage==='ALLOW'&&!revoked&&!conflict&&<ServerPdfPreparation target={{runId,sourceId:source.source_id,sourceDigest:source.source_digest,pdfSha:version.pdf_sha256}} policyRevision={data.current.policy_revision} canManage={canManage&&data.can_manage} disabled={disabled||busy} externalAllowed={data.current.external_ai==='ALLOW'}/>}
  <details><summary>PDF 이용조건 이력 ({data?.history.length??0})</summary>{data?.history.map(p=><article key={p.policy_revision}><strong>이력 {p.policy_revision} · 저장 {decisions[p.original_storage]}</strong><p>{p.reason}</p><p>근거: {p.evidence_reference}</p><small>{p.created_at} · 기록자 {p.asserted_by}</small></article>)}</details>
 </div>;
}
