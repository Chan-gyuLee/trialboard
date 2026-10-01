import {useEffect,useRef,useState} from 'react';
import {Alert,Button,MenuItem,TextField} from '@mui/material';
import {strictJson} from './field-review';
import {readPdfMetadata,verifiedPdfBytes,type PdfSource} from './research-pdf-policy';
import ResearchPdfPolicy from './ResearchPdfPolicy';
import './team-review-flow.css';

/** Read an explicitly selected cached version; never download or grant rights implicitly. */
export default function TeamCollectedPdf({runId,sourceId,disabled,onOpen,onBusy}:{runId:string;sourceId:string;disabled:boolean;onOpen:(file:File)=>Promise<void>;onBusy:(busy:boolean)=>void}){
 const [source,setSource]=useState<PdfSource|null>(null),[sha,setSha]=useState(''),[loading,setLoading]=useState(false),[opening,setOpening]=useState(false),[error,setError]=useState('');
 const operation=useRef<AbortController|null>(null);
 async function refresh(){operation.current?.abort();const c=new AbortController();operation.current=c;setLoading(true);setError('');setSource(null);setSha('');
  try{const response=await fetch(`/api/research/runs/${encodeURIComponent(runId)}/pdf-metadata`,{signal:c.signal,cache:'no-store'});if(!response.ok)throw Error('현재 권한으로 저장 PDF 목록을 확인하지 못했습니다.');
   const packet=readPdfMetadata(strictJson(await response.text(),8_000_000),runId),next=packet.sources.find(s=>s.source_id===sourceId);c.signal.throwIfAborted();if(!next)throw Error('이 출처를 현재 조사에서 찾지 못했습니다. 검토 결과에서 다시 연결하세요.');
   setSource(next);if(next.cached_versions.length===1)setSha(next.cached_versions[0].pdf_sha256);
  }catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'PDF 목록 확인 실패');}finally{if(!c.signal.aborted)setLoading(false);}
 }
 useEffect(()=>{void refresh();return()=>{operation.current?.abort();onBusy(false);};},[runId,sourceId]);
 const version=source?.cached_versions.find(v=>v.pdf_sha256===sha);
 async function open(){if(disabled||opening||!version||version.usage_policy.original_storage!=='ALLOW')return;
  const c=new AbortController();operation.current=c;setOpening(true);onBusy(true);setError('');const timer=setTimeout(()=>c.abort(),35000);
  try{const response=await fetch(`/api/research/runs/${encodeURIComponent(runId)}/documents/${encodeURIComponent(sourceId)}/cached?${new URLSearchParams({sha256:sha})}`,{signal:c.signal,cache:'no-store'});
   if(!response.ok)throw Error(response.status===403?'PDF 저장·조회 허가 또는 접근 권한이 변경되었습니다. 이용조건을 확인하세요.':'선택한 PDF를 열지 못했습니다. 목록을 다시 확인하세요.');
   const bytes=await verifiedPdfBytes(response,c.signal,sha);c.signal.throwIfAborted();clearTimeout(timer);await onOpen(new File([bytes],`${sourceId.replace(/[^a-zA-Z0-9_-]/g,'_')}.pdf`,{type:'application/pdf'}));
  }catch(e){if(operation.current===c)setError(c.signal.aborted?'PDF 읽기 대기를 중단했습니다. 다시 시도하려면 직접 열어 주세요.':e instanceof Error?e.message:'PDF 열기 실패');}
  finally{clearTimeout(timer);if(operation.current===c){setOpening(false);onBusy(false);}}
 }
 return <section className="team-review-flow" aria-label="수집 PDF에서 검토 이어가기" aria-busy={loading||opening}>
  <header><h3>저장 원문으로 이어가기</h3><Button disabled={disabled||loading||opening} onClick={()=>void refresh()}>원문 목록 다시 확인</Button></header>
  {error&&<Alert severity="error">{error}</Alert>}{loading&&<p role="status">저장한 파일 버전을 확인합니다.</p>}
  {source&&<><p>{source.title}</p>{source.cached_versions.length>0?<>
   <TextField fullWidth select label="검토할 PDF 버전" value={sha} disabled={disabled||opening} onChange={e=>setSha(e.target.value)}><MenuItem value="">파일 버전을 선택하세요</MenuItem>{source.cached_versions.map(v=><MenuItem key={v.pdf_sha256} value={v.pdf_sha256}>{v.pdf_sha256.slice(0,16)}… · {v.byte_length.toLocaleString('ko-KR')}바이트 · {v.usage_policy.original_storage==='ALLOW'?'조회 허용':'허가 확인 필요'}</MenuItem>)}</TextField>
   <Button variant="contained" disabled={disabled||opening||!version||version.usage_policy.original_storage!=='ALLOW'} onClick={()=>void open()}>선택한 저장 PDF로 검토</Button>
  </>:<p>아직 저장된 PDF가 없습니다. 아래 ‘PDF 이용조건’에서 해당 출처의 저장 허가를 확인한 뒤 저장하고, 원문 목록을 다시 확인하세요. 직접 받은 허가된 PDF를 아래에서 선택해도 됩니다.</p>}
  <p>재수집·AI 요청 없이 저장 파일을 엽니다. 원문을 확인한 뒤 ‘필드 검토 → 설계 비교·KOL’로 이어가세요. 수치는 자동 확정하지 않습니다.</p></>}
  <ResearchPdfPolicy runId={runId} disabled={disabled||opening}/>
 </section>;
}
