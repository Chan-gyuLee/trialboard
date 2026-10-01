import {useEffect,useState} from 'react';
import {Alert} from '@mui/material';
import {strictJson} from './field-review.ts';
import {readSavedReviewUsage,type SavedReviewUsage as Usage} from './saved-review-usage';
import {readPdfReviewUsage,type PdfReviewUsage} from './prepared-pdf-review';

export default function SavedReviewUsage({runId,revision,kind='source'}:{runId:string;revision:number;kind?:'source'|'pdf'}){
 const [data,setData]=useState<Usage|PdfReviewUsage|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();setData(null);setError('');
  void (async()=>{
   const response=await fetch(`/api/research/runs/${encodeURIComponent(runId)}/${kind==='pdf'?'pdf-review-usage':'review-usage'}`,{signal:controller.signal,cache:'no-store'});
   if(!response.ok)throw Error(response.status===401?'로그인이 만료되어 사용량을 확인할 수 없습니다.':response.status===403?'현재 권한으로 사용량을 확인할 수 없습니다.':'사용량 기록을 불러오지 못했습니다. 출처·실행 기록을 새로고침하세요.');
   const value=(kind==='pdf'?readPdfReviewUsage:readSavedReviewUsage)(strictJson(await response.text(),10000),runId);
   if(!controller.signal.aborted)setData(value);
  })().catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'사용량을 확인하지 못했습니다.');});
  return()=>controller.abort();
 },[runId,revision,kind]);
 const fmt=(n:number)=>n.toLocaleString('ko-KR');
 return <section aria-label={kind==='pdf'?'PDF 본문 검토 사용량':'저장 재검토 사용량'}>
  <h4>이 조사의 {kind==='pdf'?'PDF 본문 검토':'저장 재검토'} 사용량</h4>
  <p>{kind==='pdf'?'이 조사의 모든 PDF 준비본 검토만 집계하며, 출처 텍스트 재검토는 제외합니다.':'저장 자료 재검토만 집계합니다.'} 전체 제품 사용량·대회 잔여 한도·청구 금액이 아닙니다.</p>
  {error&&<Alert severity="warning">{error}</Alert>}
  {!data&&!error&&<p role="status">사용량 기록을 확인하고 있습니다.</p>}
  {data&&<>
   <p>총 {fmt(data.attempts_total)}건 · 완료 {fmt(data.completed_attempts)}건 · 실패 {fmt(data.failed_attempts)}건 · 중단 {fmt(data.cancelled_attempts)}건</p>
   {(['DACON_RESPONSES','SCRIPTED_TEST_DOUBLE'] as const).map(mode=>{const group=data.usage_by_mode[mode];return <div key={mode}>
    <strong>{mode==='DACON_RESPONSES'?'대회 API 관측 기록':'테스트 모형 기록 (실사용과 별도)'}</strong>
    <p>호출 {fmt(group.observed_model_calls)}회 · 확인된 입력 {fmt(group.observed_input_tokens)} / 출력 {fmt(group.observed_output_tokens)} 토큰</p>
    {(group.input_unknown_attempts>0||group.output_unknown_attempts>0)&&<p>토큰 수 미확정: 입력 {fmt(group.input_unknown_attempts)}건 / 출력 {fmt(group.output_unknown_attempts)}건. 위 토큰 합계에 포함되지 않습니다.</p>}
   </div>;})}
   {data.unfinished_attempts>0&&<Alert severity="info">종료 기록 없는 {fmt(data.unfinished_attempts)}건은 호출·토큰 수가 미확정이며 위 합계에서 제외했습니다. 실제 사용량이 더 클 수 있습니다.</Alert>}
   <small>기록 조회 {new Date(data.as_of).toLocaleString('ko-KR')} · 시작·종료 기록은 중복 집계하지 않습니다.</small>
  </>}
 </section>;
}
