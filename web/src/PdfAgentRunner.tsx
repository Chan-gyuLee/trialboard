import {useEffect,useRef,useState} from "react";
import {Alert,Button,Checkbox,Dialog,DialogTitle,DialogContent,DialogActions,FormControlLabel,TextField} from "@mui/material";
import {isMocSource} from './moc-data';
import type {PdfSource,EvidenceNote} from "./pdf-contract";
import {canonical} from "./field-review";
import {downloadText} from "./review";
import {pdfAgentInput,executePdfAgent,type PdfAgentContext} from "./pdf-agent";
import type {LiveProgress} from "./agent-live";
import {LiveWorkbench} from "./LiveWorkbench";
import "./agent-briefing.css";
export default function PdfAgentRunner({source,notes,active,onHandoff,onBusy,scoutContext}:{scoutContext?:import("./evidence-scout").ScoutContext;source:PdfSource;notes:EvidenceNote[];active:boolean;onHandoff:(raw:string)=>void;onBusy?:(busy:boolean)=>void}) {
 const [context,setContext]=useState<PdfAgentContext>({asset:"",indication:"",study:"",question:"용량별 반응과 이상반응을 같은 조건에서 비교할 수 있는가?"});
 const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[seconds,setSeconds]=useState(0);
 const [events,setEvents]=useState<LiveProgress[]>([]),[raw,setRaw]=useState(""),[complete,setComplete]=useState<string|null>(null);
 const [focus,setFocus]=useState(false);
 useEffect(()=>{onBusy?.(busy);},[busy,onBusy]);
 useEffect(()=>()=>onBusy?.(false),[onBusy]);
 const controller=useRef<AbortController|null>(null),ticket=useRef(0);
 const inputKey=canonical({source,notes,context});
 useEffect(()=>{ticket.current++;controller.current?.abort();setConsent(false);setRaw("");setComplete(null);setEvents([]);setBusy(false);return()=>{ticket.current++;controller.current?.abort();};},[inputKey]);
 useEffect(()=>{if(!active) controller.current?.abort();},[active]);
 let input:ReturnType<typeof pdfAgentInput>|null=null,inputError="";
 try {input=pdfAgentInput(source,notes,context);} catch(e) {inputError=e instanceof Error?e.message:"입력 확인 필요";}
 async function run() {
  if(!input || !consent || busy || controller.current) return;
  const c=new AbortController(),id=++ticket.current;controller.current=c;setBusy(true);setError("");setEvents([]);setRaw("");setComplete(null);setConsent(false);setSeconds(0);
  const start=performance.now(),timer=setTimeout(()=>c.abort(),135000),ticker=setInterval(()=>setSeconds(Math.floor((performance.now()-start)/1000)),500);
  try {const result=await executePdfAgent(input,true,c.signal,e=>{if(id===ticket.current)setEvents(es=>[...es,e]);});if(id===ticket.current && !c.signal.aborted){setRaw(result);setComplete(JSON.parse(result).status);}}
  catch(e){if(id===ticket.current)setError(c.signal.aborted?"실행 대기를 중단했습니다. 결과를 인계하지 않았습니다.":e instanceof Error?e.message:"실행 실패");}
  finally {clearTimeout(timer);clearInterval(ticker);if(controller.current===c)controller.current=null;if(id===ticket.current)setBusy(false);}
 }
 const board=<LiveWorkbench events={events} busy={busy} error={error} complete={complete} seconds={seconds}/>;
 return <section className="pdf-agent-runner" aria-label="PDF 에이전트 검토"><h2>선택한 원문을 에이전트와 검토하세요</h2><p>확인 메모를 남긴 문구와 앞뒤 2개 문구를 전송합니다. PDF 파일 전체·다른 검토 메모는 모델에 보내지 않습니다.</p>
 {scoutContext&&<Alert severity="info" action={<Button disabled={busy || !!raw} onClick={()=>setContext({asset:scoutContext.asset,indication:scoutContext.indication,study:scoutContext.study,question:scoutContext.question})}>검색 맥락 적용</Button>}>수집에서 선택: {scoutContext.asset} · {scoutContext.study}. 이 PDF와 같은 시험인지 확인 후 적용하세요. 이미 생성한 실행 기록은 덮어쓰지 않습니다.</Alert>}
 <div className="design-card-grid">{([['asset','약물'],['indication','적응증'],['study','시험'],['question','이번 검토 질문']] as const).map(([k,label])=><TextField key={k} label={label} value={context[k]} disabled={busy} onChange={e=>setContext(c=>({...c,[k]:e.target.value}))} slotProps={{htmlInput:{maxLength:2000}}}/>)}</div>
 {inputError?<Alert severity="info">{inputError}</Alert>:<details><summary>모델에 전송할 문구 {input!.spans.length}개 확인</summary>{input!.spans.map(s=><blockquote key={s.id}><strong>p.{s.page} · {s.id}</strong><p>{s.text}</p></blockquote>)}</details>}
 <FormControlLabel control={<Checkbox checked={consent} disabled={busy || !input} onChange={e=>setConsent(e.target.checked)}/>} label="공개·사용 허가된 비민감 자료임을 확인했고, 위 문구·문맥·질문을 Codex 모델에 전송하여 로그인 계정 사용량을 소비하는 데 동의합니다."/>
 <div className="design-toolbar"><Button variant="contained" disabled={busy || !input || !consent || !import.meta.env.DEV} onClick={()=>void run()}>{busy?'에이전트 검토 중':'이 원문으로 에이전트 실행'}</Button>{busy&&<Button onClick={()=>controller.current?.abort()}>실행 중단</Button>}{raw&&<Button onClick={()=>downloadText('trialboard-pdf-agent.json',raw,'application/json')}>원본 실행 JSON 저장</Button>}</div>
 {(busy || events.length>0 || error)&&<><Button onClick={()=>setFocus(true)}>작업 보드 크게 보기</Button>{!focus&&board}</>}
 <Dialog fullScreen open={focus} onClose={()=>setFocus(false)} aria-labelledby="live-focus-title"><DialogTitle id="live-focus-title">TrialBoard · 실시간 에이전트 작업</DialogTitle><DialogContent className="live-focus-content"><p>{context.asset} / {context.study} · {context.question}</p>{board}</DialogContent><DialogActions className="live-focus-actions"><span>{isMocSource(source)?'MOC · 합성 PDF / 실제 모델 실행 / 전문가 승인 아님':'선택 원문 기반 · 임상 승인 아님'}</span>{busy&&<Button onClick={()=>controller.current?.abort()}>실행 중단</Button>}{raw&&<Button onClick={()=>downloadText('trialboard-pdf-agent.json',raw,'application/json')}>원본 실행 JSON 저장</Button>}<Button variant="outlined" onClick={()=>setFocus(false)}>작업 화면으로 돌아가기</Button></DialogActions></Dialog>
 {error&&<Alert severity="error">{error}</Alert>}
 {raw&&<Alert severity={complete==='DRAFT_FOR_EXPERT_REVIEW'?'success':'warning'} action={<Button disabled={busy || ['FAILED','BUDGET_EXCEEDED'].includes(complete??'')} onClick={()=>onHandoff(raw)}>필드 검토로 인계</Button>}>실행 결과를 받았습니다. 인계 시 현재 필드·설계·회의 작업 교체를 확인합니다. 모든 필드는 미확인으로 시작하고 원본 실행 파일을 계산 단계까지 연결합니다.</Alert>}
 <p className="design-help">별도 로컬 활성화 필요 · 최대 4요청/수정 1회 · 서버 120초/화면 135초 · 자동 재시도·서버 영구 저장 없음. 문구와 PDF의 의미적 일치를 인증하지 않습니다.</p>
 </section>;
}
