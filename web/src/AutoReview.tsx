import {useEffect,useRef,useState} from 'react';
import {Alert,Autocomplete,Button,Checkbox,Chip,FormControlLabel,TextField,Tab,Tabs} from '@mui/material';
import {ArrowRight,Paperclip} from 'lucide-react';
import {ReviewHeader,ReviewTools} from './ReviewNavigation';
import {AUTO_PURPOSE,openAutoRecord,runAutoReview,type AutoEvent,type AutoOutcome,type AutoResult} from './auto-review';
import {researchFindingWarnings,type Collection,type ResearchResult} from './research';
import {autoPacketMarkdown} from './auto-packet';
import {downloadText} from './review';
import {MocBadge} from './MocDemo';
import {documentAttemptLabel} from './auto-document';
import AutoExtraction from './AutoExtraction';
import RegistryResults from './RegistryResults';
import ComparisonReadiness from './ComparisonReadiness';
import DesignExploration from './DesignExploration';
import ResultOverview from './ResultOverview';
import AgentActivity from './AgentActivity';
import ActivityReplay from './ActivityReplay';
import ResearchContinuation from './ResearchContinuation';
import './auto-review.css';
import './agent-workspace.css';
import './agent-studio.css';

export default function AutoReview({locked,onBusy,onDetails,onManual,onIntake,onContinue}:{locked:boolean;onBusy:(busy:boolean)=>void;onDetails:(result:ResearchResult)=>void;onManual:()=>void;onIntake:()=>void;onContinue:(done:AutoResult)=>void}){
 const [query,setQuery]=useState(''),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [events,setEvents]=useState<AutoEvent[]>([]),[outcome,setOutcome]=useState<AutoOutcome|null>(null),[scopeKey,setScopeKey]=useState(''),[seconds,setSeconds]=useState(0),[restored,setRestored]=useState(false),[loadingRecord,setLoadingRecord]=useState(false);
 const [history,setHistory]=useState<Pick<Collection,'id'|'request'|'status'|'created_at'>[]>([]);
 const [openView,setOpenView]=useState('overview');
 const surface=useRef<HTMLElement|null>(null);
 const controller=useRef<AbortController|null>(null),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
 useEffect(()=>{onBusy(busy&&!loadingRecord);return()=>onBusy(false);},[busy,loadingRecord,onBusy]);
 async function refresh(){try{const response=await fetch('/api/research/runs',{signal:AbortSignal.timeout(5000)});if(response.ok){const rows=await response.json();if(mounted.current&&Array.isArray(rows))setHistory(rows.filter(r=>r&&/^[a-f\d-]{36}$/.test(r.id)&&r.request&&typeof r.request.asset==='string'&&typeof r.request.nct_id==='string'&&typeof r.status==='string'&&typeof r.created_at==='string').slice(0,6));}}catch{/* current work stays visible */}}
 useEffect(()=>{void refresh();},[]);
 async function run(resume=false){
  if(controller.current||locked||!consent)return;
  const pending=resume&&outcome?.kind==='scope'?outcome:null;
  const selected=pending?pending.candidates.find(c=>JSON.stringify([c.asset,c.indication])===scopeKey):undefined;
  if(resume&&!selected)return;
  const c=new AbortController();controller.current=c;setBusy(true);setError('');setRestored(false);setOpenView('overview');setSeconds(0);setOutcome(null);if(!resume){setEvents([]);setScopeKey('');}
  const started=performance.now(),tick=setInterval(()=>setSeconds(Math.floor((performance.now()-started)/1000)),1000),timeout=setTimeout(()=>c.abort(),510000);
  let waitingForScope=false;
  try{
   const next=await runAutoReview({query,consent,signal:c.signal,onEvent:e=>{if(mounted.current)setEvents(es=>[...es,e]);},receipt:pending?.receipt,scope:selected?{asset:selected.asset,indication:selected.indication}:undefined});
   waitingForScope=next.kind==='scope';if(mounted.current)setOutcome(next);
  }catch(e){if(mounted.current){setError(c.signal.aborted?'실행 대기를 중단했습니다. 저장된 부분 기록은 최근 조사에서 열 수 있습니다. 자동 재실행하지 않습니다.':e instanceof Error?e.message:'조사 실패');setOutcome(null);}}
  finally{clearInterval(tick);clearTimeout(timeout);controller.current=null;if(mounted.current){setBusy(false);if(!waitingForScope)setConsent(false);void refresh();}}
 }
 async function open(id:string,view='overview'){
  if(controller.current||busy||locked)return;const c=new AbortController();controller.current=c;setBusy(true);setLoadingRecord(true);setEvents([]);setError('');const timeout=setTimeout(()=>c.abort(),10000);
  try{const next=await openAutoRecord(id,c.signal);if(mounted.current){setOpenView(view);setOutcome(next);setQuery(next.receipt.query);setConsent(false);setEvents([]);setRestored(true);}}
  catch(e){if(mounted.current)setError(e instanceof Error?e.message:'기록 열기 실패');}
  finally{clearTimeout(timeout);controller.current=null;if(mounted.current){setBusy(false);setLoadingRecord(false);}}
 }
 const pending=outcome?.kind==='scope'?outcome:null,done=outcome?.kind==='result'?outcome:null;
 const scopes=pending?[...new Map(pending.candidates.map(c=>[JSON.stringify([c.asset,c.indication]),c])).entries()]:[];
 const lockedForm=busy||locked;
 const scene=loadingRecord?'loading':pending?'scope':busy?'running':done?'result':error?'error':'input';
 useEffect(()=>{surface.current?.scrollIntoView({block:'start',behavior:'instant'});},[scene]);
 return <section ref={surface} className="auto-review" aria-label="자동 근거 조사와 브리핑" data-demo-scene={scene}>
  <ReviewHeader step={done?2:busy?1:0}/>
  {!done&&!busy&&<header className="auto-heading"><h1>{pending?'One quick clarification.':<>A clearer <span>next step.</span></>}</h1><p>{pending?'검토할 약물·적응증만 확인해주세요.':'다음 임상을, 더 명확하게.'}</p><p className="auto-hero-description">{pending?'범위가 정해지면 에이전트가 이어서 조사합니다.':'약물명으로 시작하세요. 공개 근거 수집부터 검토 브리핑까지 연결합니다.'}</p></header>}
  {!pending&&!done&&!busy&&<form className="auto-intake" onSubmit={e=>{e.preventDefault();void run();}}>
   <label className="composer-label" htmlFor="agent-drug-input">어떤 약물을 검토할까요?</label>
   <TextField id="agent-drug-input" fullWidth placeholder="약물명 또는 NCT 번호를 입력하세요" value={query} disabled={lockedForm} onChange={e=>{setQuery(e.target.value);setConsent(false);}} slotProps={{htmlInput:{maxLength:100,'aria-label':'약물명 또는 NCT 번호'}}}/>
   <div className="auto-purpose"><span>검토 목적</span><strong>{AUTO_PURPOSE}</strong></div>
   <div className="agent-consent"><FormControlLabel control={<Checkbox size="small" checked={consent} disabled={lockedForm} onChange={e=>setConsent(e.target.checked)} slotProps={{input:{'aria-describedby':'agent-data-details'}}}/>} label="공개 자료 검색·저장 및 외부 AI 분석에 동의합니다."/><details id="agent-data-details"><summary>데이터 처리 안내</summary><p>입력한 약물명·시험번호로 공개 자료를 검색하고 결과를 이 기기에 저장합니다. 선택한 공개 자료의 발췌문은 대회 제공 AI API로 전송합니다. 민감 정보는 입력하지 마세요.</p><p>공개 PDF 최대 2개 처리, 조사 최대 2회와 원문 추출·반론 최대 2회, 총 최대 4회 모델 요청입니다. MOC는 실제 약물 추정치가 아닌 별도의 합성 가정 계산입니다.</p></details></div>
   <div className="auto-actions"><Button disabled={lockedForm} startIcon={<Paperclip size={17}/>} onClick={onIntake}>보유 자료로 검토</Button><Button size="large" variant="contained" type="submit" disabled={lockedForm||!consent||query.trim().length<2} endIcon={<ArrowRight size={18}/>}>에이전트 시작</Button></div>
  </form>}
  {!pending&&!done&&!busy&&<div className="agent-start-path"><span><b>01</b> 공개 근거 수집</span><ArrowRight size={16}/><span><b>02</b> AI 검토·원문 대조</span><ArrowRight size={16}/><span><b>03</b> 판단 범위·질문 정리</span></div>}
  {error&&<Alert severity="warning">{error}</Alert>}
  {loadingRecord&&<Alert severity="info">검토 기록을 불러오는 중입니다.</Alert>}
  {!loadingRecord&&(busy||events.length>0)&&(done||pending?<details className="auto-work-history">
   <summary>조사 과정 보기 · {seconds}초 · 작업 기록 {events.length}개</summary>
   <AgentActivity events={events} outcome={outcome} busy={false} seconds={seconds} query={query} onStop={()=>controller.current?.abort()}/></details>:
   <AgentActivity events={events} outcome={outcome} busy={busy} seconds={seconds} query={query} onStop={()=>controller.current?.abort()}/>)}
  {pending&&<section className="auto-scope"><span className="auto-kicker">ONE DECISION</span><h2>어느 약물·적응증을 검토할까요?</h2><p>검색 결과에 다른 범위가 섞여 있어요. 한 번 선택하면 나머지 조사는 이어서 진행합니다.</p>
   <Autocomplete options={scopes} value={scopes.find(([key])=>key===scopeKey)??null} disabled={lockedForm} onChange={(_,value)=>setScopeKey(value?.[0]??'')} getOptionLabel={([,c])=>`${c.asset} · ${c.indication}`} isOptionEqualToValue={(a,b)=>a[0]===b[0]} noOptionsText="일치하는 등록 적응증이 없습니다" renderInput={params=><TextField {...params} label="검토 범위 · 검색해서 선택"/>}/>
   {scopes.find(([key])=>key===scopeKey)?.[1]&&<TrialStart candidate={scopes.find(([key])=>key===scopeKey)![1]}/>}
   <p className="auto-caption">검색 {pending.receipt.total_count}건 중 확보한 {pending.receipt.fetched_count}건의 등록 표현입니다. 같은 의미로 보이는 적응증도 자동으로 합치지 않습니다.</p>
   <p className="auto-caption">등록 적응증 표현을 사용합니다. 병용약·별칭은 임의로 같은 약물로 합치지 않습니다. 아직 AI 요청 0회.</p>
   <p className="auto-caption">처음 동의한 조사 2회·원문 추출/반론 2회, 총 최대 4회 범위에서 이어갑니다.</p>
   <div className="auto-actions"><Button variant="contained" disabled={lockedForm||!scopeKey||!consent} onClick={()=>void run(true)}>이 범위로 조사 계속</Button><Button disabled={busy} onClick={()=>{setOutcome(null);setEvents([]);setConsent(false);}}>입력으로 돌아가기</Button></div>
  </section>}
  {done&&<AutoBrief key={done.result.collection.id+openView} initialSection={openView} done={done} restored={restored} disabled={lockedForm} onDetails={onDetails} onContinue={onContinue} onNew={()=>{setOutcome(null);setEvents([]);setError('');setConsent(false);setQuery('');setScopeKey('');}}/>}
  {!busy&&<ReviewTools history={history} disabled={lockedForm} onOpen={id=>void open(id)} onManual={onManual}/>}
 </section>;
}

function AutoBrief({done,restored,disabled,onDetails,onNew,onContinue,initialSection='overview'}:{done:AutoResult;restored:boolean;disabled:boolean;onDetails:(r:ResearchResult)=>void;onNew:()=>void;initialSection?:string;onContinue:(done:AutoResult)=>void}){
 const c=done.result.collection,review=c.review,findings=review?.findings??[];
 const [section,setSection]=useState(initialSection);
 const contentTop=useRef<HTMLDivElement|null>(null);
 useEffect(()=>{if(initialSection==='replay')contentTop.current?.scrollIntoView({block:'start',behavior:'instant'});},[initialSection]);
 function viewSection(value:string){setSection(value);contentTop.current?.scrollIntoView({block:'start',behavior:'instant'});}
 return <section className="auto-brief" aria-label="근거 브리핑">
  <div className="auto-section-title result-header"><div><span className="auto-kicker">{restored?'저장된 검토':'REVIEW RESULT'}</span><h1>{c.request.asset}<span>검토 결과</span></h1><p>{c.request.indication} · {c.request.nct_id}</p></div><div className="result-header-actions"><Chip label={review?'전문가 검토용 초안':'AI 브리핑 미완료'} color={review?'primary':'warning'} variant="outlined"/><Button variant="outlined" disabled={disabled} onClick={()=>downloadText(`trialboard-review-${c.id}.md`,autoPacketMarkdown(done),'text/markdown')}>보고서 내려받기</Button></div></div>
  {c.execution_mode==='SCRIPTED_TEST_DOUBLE'&&<><MocBadge detail="합성 조사·모델 테스트 기록 · 실제 AI 실행 아님"/><Alert severity="warning">MOC · 합성 테스트 기록. 실제 AI 실행 아님.</Alert></>}
  <p className="auto-caption">{restored?'검토 일시':'작성 일시'} · {new Date(c.created_at).toLocaleString('ko-KR')}</p>
  <div ref={contentTop} className="result-navigation"><Tabs className="result-tabs" value={section} onChange={(_,v)=>setSection(v)} variant="scrollable" scrollButtons="auto" aria-label="검토 결과 보기">{[['overview','한눈에 보는 결과'],['evidence','출처·전체 쟁점'],['exploration','가상 비교 · MOC'],['process','원문·처리 기록'],['replay','실행 과정 재생']].map(([id,label])=><Tab key={id} value={id} label={label} id={`result-tab-${id}`} aria-controls={`result-panel-${id}`}/>)}</Tabs></div>
  <div hidden={section!=='overview'} role="tabpanel" id="result-panel-overview" aria-labelledby="result-tab-overview">
  <ResultOverview done={done} onView={viewSection}/>
  <ResearchContinuation done={done} disabled={disabled} onContinue={onContinue} onProcess={()=>viewSection('process')}/>
  </div>
  <div hidden={section!=='replay'} role="tabpanel" id="result-panel-replay" aria-labelledby="result-tab-replay">{section==='replay'&&<ActivityReplay collection={c}/>}</div>
  <div hidden={section!=='exploration'} role="tabpanel" id="result-panel-exploration" aria-labelledby="result-tab-exploration"><DesignExploration key={c.id} value={done.exploration} error={done.explorationError}/>{!done.exploration&&!done.explorationError&&<Alert severity="info">저장된 가상 설계 계산이 없습니다. 기록 열기만으로 새로 실행하지 않습니다.</Alert>}</div>
  <div hidden={section!=='evidence'} role="tabpanel" id="result-panel-evidence" aria-labelledby="result-tab-evidence">
  <ComparisonReadiness tables={done.registryResults}/>
  <RegistryResults done={done}/>
  </div>
  <div hidden={section!=='process'} role="tabpanel" id="result-panel-process" aria-labelledby="result-tab-process">
  <details className="auto-selection"><summary>실행 정보</summary><p>{c.execution_mode==='DACON_RESPONSES'?'대회 제공 AI':c.execution_mode==='CODEX_CHATGPT'?'Codex 실행':c.execution_mode==='COLLECTORS_ONLY'?'공개 자료 수집':'MOC 합성 테스트'} · {c.status}</p></details>
  <section className="auto-plan" aria-label="공개 원문 자동 준비"><h3>다음 검토를 위한 원문 준비</h3>
   <p>{!done.document?'저장된 조사 기록입니다. 원문 준비를 새로 실행하지 않았습니다.':done.document.status==='READY'?`원문 ${done.document.coverage?.totalPages??done.document.source!.pages.length}페이지 중 ${done.document.source!.pages.length}페이지 보관 · 추출 후보 ${done.document.candidates!.length}개 준비`:done.document.status==='NO_DOCUMENT'?'선택 시험에 연결된 자동 처리 대상 공개 PDF가 없습니다.':'공개 원문 준비가 완료되지 않았습니다. 접근 제한·200페이지/5MB 초과·텍스트 처리 한도 여부를 상세 검토에서 확인하세요.'}</p>
   {done.document?.coverage&&<details><summary>페이지 탐색·선정 범위 확인</summary><p>전체 {done.document.coverage.totalPages}페이지 중 {done.document.coverage.scannedPages.length}페이지의 텍스트를 탐색했습니다. 임상 검토·표 해석·OCR은 수행하지 않았습니다.</p><p>보관한 원본 페이지: {done.document.coverage.retainedPages.join(', ')}</p><p>텍스트 미보관 페이지: {done.document.coverage.omittedPages.join(', ')||'없음'}</p><p>텍스트 미확보 페이지: {done.document.coverage.noTextPages.join(', ')||'없음'}</p><p>용량·안전성·반응·분석 문구 기반 선정입니다. 아래 후보만 추출 입력으로 준비하며, 나머지 문서를 검토 완료로 취급하지 않습니다.</p></details>}
   {done.document?.candidates?.map(x=><blockquote key={x.spanId}><span className="auto-caption">p.{x.page} · {x.reasons.join(' · ')}</span><br/>{x.text}</blockquote>)}
   {!!done.document?.attempts.length&&<ul>{done.document.attempts.map(a=><li key={a.sourceId}>{c.sources.find(s=>s.id===a.sourceId)?.title??a.sourceId} · {documentAttemptLabel(a.status)}</li>)}</ul>}
   {done.document?.input&&<Button onClick={()=>downloadText('trialboard-prepared-extraction.json',JSON.stringify({schema:'auto-document-preparation/1',runId:c.id,sourceUrl:c.sources.find(s=>s.id===done.document?.sourceId)?.url,clinicalVerified:false,selection:'LEXICAL_NOT_HUMAN_VERIFIED',document:done.document},null,2),'application/json')}>준비된 추출 입력 저장</Button>}
   <p className="auto-caption">{done.automation?'원문 준비와 추출 상태를 로컬 DB에 저장했습니다.':'원문 준비의 영구 저장은 확인되지 않았습니다.'} 위 AI 브리핑과 아래 원문 추출은 별도 결과입니다. 텍스트 탐색은 임상 검증이 아닙니다.</p>
  </section>
  <AutoExtraction done={done}/>
  <details className="auto-selection"><summary>조사 시작점 {c.request.nct_id} · 범위와 선정 이유</summary><TrialStart candidate={done.candidate}/><p>검색 {done.receipt.total_count}건 중 {done.receipt.fetched_count}건을 저장했고 한 시험에서 심층 조사를 시작했습니다. 모든 시험의 결과를 통합한 분석은 아닙니다.</p></details>
  </div>
  <div hidden={section!=='evidence'}>
  {(!review||c.status!=='COMPLETE'||review.conclusion==='INSUFFICIENT_EVIDENCE')&&<Alert severity="warning">{!review?'수집 자료는 남아 있지만 AI 브리핑이 완료되지 않았습니다.':'일부 자료 미확보 또는 근거 부족이 있습니다.'} 상세 기록에서 실패·미확보 범위를 확인하세요.</Alert>}
  <div className="auto-brief-grid"><div><h3>근거에서 확인할 핵심 쟁점</h3>{findings.map((f,i)=>{const source=c.sources.find(s=>s.id===f.source_id)!;return <article className="auto-finding" key={i}><span className="auto-finding-number">{String(i+1).padStart(2,'0')}</span><p>{f.interpretation}</p><details><summary>근거 확인 · {source.content_level==='ABSTRACT'?'초록':source.content_level==='REGISTRY_TEXT'?'등록정보':'메타데이터'}</summary><blockquote>{f.quote}</blockquote><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>{researchFindingWarnings(f,source,c.request.nct_id).map(w=><p key={w} className="auto-caption">{w}</p>)}</details></article>})}{!findings.length&&<p>인용을 연결한 쟁점이 없습니다. 결론을 만들어 채우지 않았습니다.</p>}</div>
   <aside className="auto-decisions"><h3>회의에서 판단할 것</h3><ol>{(review?.questions??[]).map((q,i)=><li key={i}>{q}</li>)}</ol>{!review?.questions.length&&<p>AI 질문 미확보. 상세 자료를 먼저 확인하세요.</p>}{!!c.plan?.missing_evidence.length&&<details><summary>추가로 필요한 근거</summary><ul>{c.plan.missing_evidence.map((g,i)=><li key={i}>{g}</li>)}</ul></details>}</aside></div>
  <p className="auto-caption">{review?'인용문 문자열을 자동 대조한 AI 초안입니다.':'수집 기록만 있으며 AI 브리핑은 미완료입니다.'} 임상 해석·동일 환자군·권장 용량을 승인한 결과는 아닙니다.</p>
  {(!review||c.status!=='COMPLETE')&&<details><summary>미완료 이유·수집 기록 확인</summary>{c.notices.map((n,i)=><p key={i}>{n}</p>)}<p>모델 요청 {c.calls.length}회 · 응답 수신 {c.calls.filter(x=>x.status==='RECEIVED').length}회. 응답 수신은 내용 검증 성공과 다릅니다.</p></details>}
  </div>
  <div className="auto-actions"><Button variant="contained" disabled={disabled||!c.sources.length} onClick={()=>onDetails(done.result)}>근거 상세 검토</Button><Button disabled={disabled} onClick={()=>downloadText(`trialboard-review-${c.id}.md`,autoPacketMarkdown(done),'text/markdown')}>전체 검토 보고서 내려받기</Button><Button disabled={disabled} onClick={onNew}>새 약물 검토</Button></div>
 </section>;
}

function TrialStart({candidate}:{candidate:AutoResult['candidate']}){
 return <div className="auto-plan"><strong>조사 시작점 · {candidate.study.nct_id}</strong><p>{candidate.study.title}</p><p>{candidate.reason}</p>{candidate.priority?.quotes.map((q,i)=><blockquote key={i}><span className="auto-caption">{q.location}</span><br/>{q.text}</blockquote>)}</div>;
}
