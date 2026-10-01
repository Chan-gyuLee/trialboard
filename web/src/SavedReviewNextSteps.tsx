import {useEffect,useRef,useState} from 'react';
import {Alert,Button,MenuItem,TextField} from '@mui/material';
import type {SavedArtifact} from './saved-research-review';
import type {ScoutContext} from './evidence-scout';
import {loadReviewHandoff,reviewIntakeContext,savedReviewMeetingMarkdown,type ReviewHandoff} from './saved-review-handoff';
import {downloadText} from './review';
import ResearchPdfPolicy from './ResearchPdfPolicy';
export default function SavedReviewNextSteps({artifact,disabled,onIntake}:{artifact:SavedArtifact;disabled:boolean;onIntake?:(context:ScoutContext)=>void}){
 const [packet,setPacket]=useState<ReviewHandoff|null>(null),[sourceId,setSourceId]=useState(''),[notes,setNotes]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),active=useRef<AbortController|null>(null);
 useEffect(()=>()=>active.current?.abort(),[]);
 async function load(){active.current?.abort();const c=new AbortController();active.current=c;setBusy(true);setError('');setPacket(null);
  try{const next=await loadReviewHandoff(artifact,c.signal);if(c.signal.aborted)return;setPacket(next);setSourceId(next.sources.find(s=>s.pdf_url)?.source_id??next.sources[0]?.source_id??'');}
  catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'연결 정보를 확인하지 못했습니다.');}finally{if(!c.signal.aborted)setBusy(false);}
 }
 if(artifact.status!=='COMPLETED')return null;
 return <section className="team-review-flow" aria-label="검토 후 다음 행동"><h4>KOL 준비와 원문 대조로 이어가기</h4><p>검토 내용을 회의 문서로 정리하거나, 원문에서 수치를 확인하고 설계 비교를 준비하세요. 새 AI 요청은 없습니다.</p>
  {error&&<Alert severity="error">{error}</Alert>}<Button variant="outlined" disabled={disabled||busy} onClick={()=>void load()}>{busy?'검토 연결 확인 중':'KOL·원문 연결 정보 확인'}</Button>
  {packet&&<>
   <h5>KOL에게 확인할 질문</h5>{packet.artifact.review?.questions.length?<ol>{packet.artifact.review.questions.map((q,i)=><li key={i}>{q}</li>)}</ol>:<p>생성된 질문이 없습니다. 아래 메모에 확인할 내용을 직접 작성하세요.</p>}
   <TextField fullWidth multiline minRows={3} label="회의 준비 메모" value={notes} disabled={disabled||busy} onChange={e=>setNotes(e.target.value)} slotProps={{htmlInput:{maxLength:8000}}} helperText="이 탭에서만 유지됩니다. 내려받은 문서에는 사람이 작성한 메모로 구분됩니다."/>
   <Button disabled={disabled||busy} onClick={()=>downloadText(`trialboard-kol-${artifact.attempt_id}.md`,savedReviewMeetingMarkdown(packet,notes),'text/markdown;charset=utf-8')}>근거·질문·회의 메모 내려받기</Button>
   <h5>원문을 확인하고 설계 비교 준비</h5><p>이 검토에는 검증된 임상 수치가 없습니다. PDF 원문을 열고 필요한 값을 직접 확인한 뒤 ‘설계 비교·KOL’로 진행하세요.</p>
   <TextField fullWidth select label="다음으로 확인할 출처" value={sourceId} disabled={disabled||busy} onChange={e=>setSourceId(e.target.value)}>{packet.sources.map(s=><MenuItem key={s.source_id} value={s.source_id}>{s.title}{s.pdf_url?' · PDF 연결':' · 보유 PDF 필요'}</MenuItem>)}</TextField>
   {sourceId&&<p><a href={packet.sources.find(s=>s.source_id===sourceId)!.url} target="_blank" rel="noreferrer">선택 출처 원문 열기</a></p>}
   {packet.sources.some(s=>s.pdf_url)&&<><p>PDF 파일 허가는 별도입니다. 연결된 PDF를 사용하려면 저장·조회 조건을 먼저 확인하세요.</p><ResearchPdfPolicy runId={packet.run_id} disabled={disabled||busy}/></>}
   {onIntake?<Button variant="contained" disabled={disabled||busy||!sourceId} onClick={()=>onIntake(reviewIntakeContext(packet,sourceId))}>이 문맥으로 원문·수치 검토</Button>:<p>자료 검토 메뉴에서 해당 시험의 PDF를 열어 이어갈 수 있습니다.</p>}
  </>}
 </section>;
}
