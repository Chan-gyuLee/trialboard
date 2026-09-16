import {useEffect,useRef,useState} from "react";
import {Alert,Button,Checkbox,Chip,CircularProgress,FormControlLabel,TextField} from "@mui/material";
import {ArrowRight,BookOpen,Database,ExternalLink} from "lucide-react";
import {downloadText} from "./review";
import {basisLabel,researchFindingWarnings,readResearchResult,readResearchStream,researchMarkdown,type Collection,type ResearchContext,type ResearchEvent,type ResearchResult,type ResearchSource} from "./research";
import type {ScoutContext} from "./evidence-scout";
import ResearchActivity from "./ResearchActivity";
import ResearchCuration from "./ResearchCuration";
import ResearchLinkage from "./ResearchLinkage";
import "./research.css";

export default function ResearchPanel({context,onIntake,onBusy,locked,onRestoreContext}:{context:ResearchContext;onIntake:(c:ScoutContext)=>void;onBusy:(busy:boolean)=>void;locked:boolean;onRestoreContext:(c:ResearchContext)=>Promise<void>}){
 const [consent,setConsent]=useState(false),[model,setModel]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [events,setEvents]=useState<ResearchEvent[]>([]),[result,setResult]=useState<ResearchResult|null>(null),[sourceId,setSourceId]=useState("");
 const [history,setHistory]=useState<Pick<Collection,"id"|"request"|"created_at"|"status">[]>([]),[filter,setFilter]=useState("ALL"),[seconds,setSeconds]=useState(0);
 const controller=useRef<AbortController|null>(null);
 const [view,setView]=useState("BRIEF");
 const detailRef=useRef<HTMLElement>(null);
 const pendingFocus=useRef(false);
 useEffect(()=>{if(pendingFocus.current){detailRef.current?.scrollIntoView({block:"center",behavior:"smooth"});pendingFocus.current=false;}},[view,sourceId]);
 function inspectSource(id:string){pendingFocus.current=true;setFilter("ALL");setView("LIBRARY");setSourceId(id);}
 const [dbQuery,setDbQuery]=useState(""),[dbHits,setDbHits]=useState<{source_id:string;title:string;snippet:string}[]|null>(null),[dbBusy,setDbBusy]=useState(false);
 const collectionId=result?.collection.id;
 useEffect(()=>{setDbQuery("");setDbHits(null);setFilter("ALL");},[collectionId]);
 useEffect(()=>{
   if(!collectionId || !dbQuery.trim()){setDbHits(null);setDbBusy(false);return;}
   const abort=new AbortController();setDbBusy(true);
   const timer=setTimeout(()=>{void fetch(`/api/research/runs/${encodeURIComponent(collectionId)}/search?q=${encodeURIComponent(dbQuery.trim())}`,{signal:abort.signal}).then(async r=>{if(!r.ok)throw Error("DB 검색 실패");const hits=await r.json();if(!Array.isArray(hits)||hits.some(h=>!h||typeof h.source_id!=="string"||typeof h.snippet!=="string"||typeof h.title!=="string"))throw Error("DB 검색 형식 오류");if(!abort.signal.aborted)setDbHits(hits);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setDbBusy(false);});},250);
   return()=>{clearTimeout(timer);abort.abort();};
 },[collectionId,dbQuery]);
 const contextKey=JSON.stringify(context);
 useEffect(()=>{setConsent(false);setModel(false);},[contextKey]);
 useEffect(()=>{onBusy(busy);return()=>onBusy(false);},[busy,onBusy]);
 useEffect(()=>()=>controller.current?.abort(),[]);
 async function refresh(){try{const r=await fetch("/api/research/runs",{signal:AbortSignal.timeout(5000)});if(r.ok)setHistory(await r.json());}catch{/* existing results stay visible */}}
 useEffect(()=>{void refresh();},[]);
 async function open(id:string,restoreContext=false){const r=await fetch(`/api/research/runs/${encodeURIComponent(id)}`,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error("조사 기록을 열지 못했습니다.");const parsed=readResearchResult(await r.text());if(restoreContext)await onRestoreContext(parsed.collection.request);setResult(parsed);setView(parsed.collection.review?"BRIEF":"LIBRARY");setSourceId(parsed.collection.review?.findings[0]?.source_id??parsed.collection.sources[0]?.id??"");return parsed;}
 async function run(){if(controller.current || !consent || !context.asset.trim() || !context.indication)return;const c=new AbortController();controller.current=c;setBusy(true);setError("");setEvents([]);setResult(null);setSeconds(0);const start=performance.now(),timer=setInterval(()=>setSeconds(Math.floor((performance.now()-start)/1000)),500),timeout=setTimeout(()=>c.abort(),250000);try{const r=await fetch("/api/research/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...context,public_consent:true,model_consent:model}),signal:c.signal});const id=await readResearchStream(r,e=>setEvents(es=>[...es,e]));await open(id);}catch(e){setError(c.signal.aborted?"실행 대기를 중단했습니다. 최근 조사 기록에서 부분 수집을 다시 열 수 있습니다.":e instanceof Error?e.message:"조사 실패");}finally{clearInterval(timer);clearTimeout(timeout);controller.current=null;setBusy(false);void refresh();}}
 const collection=result?.collection,selected=collection?.sources.find(s=>s.id===sourceId);
 const plan=collection?.plan??events.find(e=>e.stage==="AI_PLAN_READY")?.plan;
 const visible=collection?.sources.filter(s=>filter==="ALL" || s.kind===filter || filter==="DOCUMENT"&&["PROTOCOL","SAP","REGULATORY"].includes(s.kind))??[];
 function intake(s:ResearchSource){if(!collection)return;onIntake({asset:collection.request.asset,study:collection.request.nct_id,indication:collection.request.indication,question:"용량별 반응과 이상반응을 같은 조건에서 비교할 수 있는가?",receiptId:collection.request.search_id,document:{runId:collection.id,sourceId:s.id,title:s.title}});}
 return <section className="research-panel" aria-label="다중 출처 근거 조사"><div className="research-heading"><div><span className="scout-eyebrow">DEEPER EVIDENCE · {context.nct_id}</span><h2>논문과 규제 문서까지 연결하세요</h2><p>{context.asset || "약물명 확인 필요"} · {context.indication || "적응증 선택 필요"}</p></div><Database size={26}/></div>
 <div className="research-consent"><FormControlLabel control={<Checkbox checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>} label="공개 약물명·NCT로 ClinicalTrials.gov, Europe PMC/PubMed, Drugs@FDA를 검색하고 원문 응답·연결 기록을 로컬 DB에 저장합니다."/><FormControlLabel control={<Checkbox checked={model} disabled={busy} onChange={e=>setModel(e.target.checked)}/>} label="AI 추가 조사도 실행: 수집 문구를 현재 Codex 로그인 모델에 보내 검색 계획·후속 검색·인용 연결 검토를 수행합니다. 최대 2회 모델 요청과 계정 사용량 소비에 동의합니다."/>
 <div className="research-actions"><Button variant="contained" disabled={busy || locked || !consent || !context.asset.trim() || !context.indication} onClick={()=>void run()} endIcon={busy?<CircularProgress size={16} color="inherit"/>:<ArrowRight size={18}/>}>{busy?"근거 조사 진행 중":model?"AI 근거 조사 시작":"공개 자료 수집 시작"}</Button>{busy&&<Button onClick={()=>controller.current?.abort()}>실행 중단</Button>}<span>최대 100개 근거 · 부분 수집 · PDF는 열기 전까지 미검토</span></div></div>
 {error&&<Alert severity="error">{error}</Alert>}
 {!collection&&<ResearchActivity busy={busy} events={events} seconds={seconds} plan={plan}/>}

 {collection&&<><div className="research-summary"><div><strong>{collection.sources.length}</strong><span>연결된 근거</span></div><div><strong>{collection.sources.filter(s=>s.kind==="PAPER").length}</strong><span>논문 · 초록/서지</span></div><div><strong>{collection.sources.filter(s=>s.pdf_url).length}</strong><span>공개 PDF 연결</span></div><div><strong>{collection.calls.length}</strong><span>모델 요청 기록</span></div></div>
 <Alert severity={collection.status==="COMPLETE"?"info":"warning"}>{collection.status} · {new Date(collection.created_at).toLocaleString("ko-KR")} · {collection.request.asset}/{collection.request.nct_id}. 수집 완료는 임상 근거 검증 완료가 아닙니다.</Alert>
 {collection.execution_mode==="SCRIPTED_TEST_DOUBLE"&&<Alert severity="warning">MOC · 합성 테스트 모델 결과입니다. 실제 AI 검토가 아닙니다.</Alert>}
 <div className="research-tabs" role="group" aria-label="조사 결과 보기">{[["BRIEF","검토 브리핑"],["LINKAGE","시험·코호트 연결"],["LIBRARY","근거 DB"],["TRACE","조사 기록"]].map(([id,label])=><Button key={id} variant={view===id?"contained":"text"} aria-pressed={view===id} onClick={()=>setView(id)}>{label}</Button>)}</div>
 {view==="LINKAGE"&&<ResearchLinkage key={collection.id} collection={collection} onInspect={inspectSource}/>}
 {view==="TRACE"&&<ResearchActivity busy={false} events={collection.events} seconds={Math.round((collection.events.at(-1)?.elapsed_ms??0)/1000)} plan={collection.plan} sources={collection.sources}/>}
 {view==="BRIEF"&&!collection.review&&<Alert severity="info">AI 검토 초안이 없습니다. 근거 DB에서 수집 자료를 확인하세요. 수집만 선택했거나 모델 검토가 완료되지 않은 기록입니다.</Alert>}
 {view==="LIBRARY"&&<> <div className="research-db-search"><TextField fullWidth label="저장된 근거 DB 안에서 검색" placeholder="예: 960, randomized, adverse events" value={dbQuery} onChange={e=>setDbQuery(e.target.value)} slotProps={{htmlInput:{maxLength:150}}} helperText="이 조사에 저장한 제목·초록·등록 문구만 검색합니다. 외부 검색·모델 호출 없음. PDF 본문은 이 색인에 포함되지 않습니다."/>{dbBusy&&<CircularProgress size={18}/>}<div aria-live="polite">{dbHits!==null&&<p>{dbHits.length}건 표시 · 최대 20건</p>}{dbHits?.map(h=><Button fullWidth key={h.source_id} onClick={()=>{inspectSource(h.source_id);}}><span><strong>{h.title}</strong><br/>{h.snippet}</span></Button>)}</div></div>
 <div className="research-filters" role="group" aria-label="근거 유형 필터">{[["ALL","전체"],["PAPER","논문"],["DOCUMENT","공개 문서"],["REGISTRY","시험 등록"]].map(([id,label])=><Button key={id} variant={filter===id?"contained":"outlined"} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</Button>)}</div>
 <div className="research-library"><div className="research-source-list">{visible.map(s=><button key={s.id} type="button" aria-pressed={sourceId===s.id} onClick={()=>setSourceId(s.id)}><span>{s.kind} · {s.published??"날짜 미확보"}</span><strong>{s.title}</strong><small>{s.link_basis.map(basisLabel).join(" / ")}</small></button>)}{!visible.length&&<p>이 유형의 자료를 확보하지 못했습니다.</p>}</div><article ref={detailRef} className="research-source-detail">{selected?<><Chip size="small" label={selected.content_level==="ABSTRACT"?"초록 확보 · 본문 미검토":selected.content_level==="PDF_AVAILABLE"?"PDF 연결 · 원문 열기 전":selected.content_level}/><h3>{selected.title}</h3><a href={selected.url} target="_blank" rel="noreferrer">공개 출처 열기 <ExternalLink size={14}/></a><div className="research-basis">{selected.link_basis.map(b=><span key={b}>{basisLabel(b)}</span>)}</div><p className="research-source-text">{selected.text}</p>{selected.pdf_url&&<Button variant="contained" disabled={busy || locked} onClick={()=>intake(selected)} startIcon={<BookOpen size={16}/>}>이 공개 PDF로 원문 검토</Button>}<details><summary>수집 출처·지문</summary><p>{selected.fetched_at}</p><p>{selected.digest}</p><p>{JSON.stringify(selected.identifiers)}</p></details><ResearchCuration key={collection.id+selected.id} runId={collection.id} source={selected}/></>:<p>근거를 선택하세요.</p>}</article></div></>}
 {view==="BRIEF"&&collection.review&&<section className="research-brief"><h3>인용을 연결한 검토 초안</h3><Alert severity="warning">인용문의 문자열 일치만 자동 대조했습니다. AI 해석의 임상적 타당성은 전문가 확인이 필요합니다.</Alert>{collection.review.findings.map((f,i)=><article key={i}>{researchFindingWarnings(f,collection.sources.find(s=>s.id===f.source_id)!,collection.request.nct_id).map((w,j)=><Alert key={j} severity="warning">{w}</Alert>)}<p>{f.interpretation}</p><blockquote>{f.quote}</blockquote><Button size="small" onClick={()=>inspectSource(f.source_id)}>출처 확인 · {f.source_id}</Button></article>)}<h3>KOL에게 확인할 질문</h3><ol>{collection.review.questions.map((q,i)=><li key={i}>{q}</li>)}</ol></section>}
 <details className="research-coverage"><summary>검색 범위·실패·버전 변화 확인</summary>{collection.coverage.map((c,i)=><p key={i}><strong>{c.channel} · {c.status}</strong> {c.fetched}/{c.total??"?"}건 {c.limited?"· 일부만 수집":""}<br/>{c.query}</p>)}{result?.changes.previous_id?<p>이전 조사 대비 추가 {result.changes.added.length}건 / 내용 변경 {result.changes.changed.length}건 / 이번에 미수집 {result.changes.not_retrieved.length}건. 미수집은 원문 삭제를 뜻하지 않습니다.</p>:<p>이 프로젝트의 첫 조사 기록입니다.</p>}{collection.notices.map((n,i)=><p key={i}>{n}</p>)}</details>
 <div className="research-actions"><Button onClick={()=>downloadText(`trialboard-research-${collection.id}.json`,JSON.stringify(result,null,2),"application/json")}>조사 기록 JSON</Button><Button onClick={()=>downloadText(`trialboard-research-${collection.id}.md`,researchMarkdown(collection),"text/markdown")}>검토·KOL 브리핑 저장</Button></div></>}
 {history.length>0&&<div className="research-history"><h3>최근 조사 · 이어서 열기</h3>{history.map(h=><Button key={h.id} disabled={busy} variant="outlined" onClick={()=>{setEvents([]);void open(h.id,true).catch(e=>setError(e.message));}}>{h.request.asset} · {h.request.nct_id} · {h.status} · {new Date(h.created_at).toLocaleTimeString("ko-KR")}</Button>)}</div>}
 </section>;
}
