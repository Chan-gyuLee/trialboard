import { useEffect, useRef, useState, useCallback } from "react";
import { Alert, Button, Checkbox, Chip, CircularProgress, FormControlLabel, InputAdornment, MenuItem, TextField } from "@mui/material";
import { ArrowRight, Check, Database, ExternalLink, Search } from "lucide-react";
import { downloadText } from "./review";
import "./evidence-scout.css";
import {readScoutReceipt, readScoutStream, type Receipt, type ScoutContext, type ScoutEvent as Event} from "./evidence-scout";
import ResearchPanel from "./ResearchPanel";
import type {ResearchContext} from "./research";
export type {ScoutContext} from "./evidence-scout";

export default function EvidenceScout({onIntake, locked = false, onResearchBusy}: {onIntake: (context?: ScoutContext) => void; locked?: boolean; onResearchBusy?:(busy:boolean)=>void}) {
  const [researchBusy,setResearchBusy]=useState(false);
  const reportResearchBusy=useCallback((value:boolean)=>{setResearchBusy(value);onResearchBusy?.(value);},[onResearchBusy]);
  const [query, setQuery] = useState("");
  const [consent, setConsent] = useState(false), [ready, setReady] = useState(false), [searchBusy, setBusy] = useState(false);
  const busy=searchBusy || researchBusy;
  const [error, setError] = useState(""), [events, setEvents] = useState<Event[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null), [history, setHistory] = useState<Omit<Receipt,"studies">[]>([]);
  const [selected, setSelected] = useState(""), [condition, setCondition] = useState("");
  const [asset, setAsset] = useState("");
  const [seconds, setSeconds] = useState(0), [restored, setRestored] = useState(false);
  const active = useRef<AbortController | null>(null);
  async function refresh() {
    try {
      const r = await fetch("/api/evidence-scout/capabilities", {signal: AbortSignal.timeout(4000)});
      if (!r.ok || !(await r.json()).enabled) {setReady(false); return;}
      setReady(true);
      const h = await fetch("/api/evidence-scout/searches", {signal: AbortSignal.timeout(4000)});
      if (h.ok) setHistory(await h.json());
    } catch {setReady(false);}
  }
  useEffect(() => {void refresh(); return () => active.current?.abort();}, []);
  async function search() {
    if (!query.trim() || !consent || active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(""); setEvents([]); setReceipt(null); setSelected(""); setCondition(""); setSeconds(0); setRestored(false);
    const start = performance.now(), tick = setInterval(() => setSeconds(Math.floor((performance.now()-start)/1000)), 500);
    const timeout = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch("/api/evidence-scout/search", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({query: query.trim(), public_query_confirmed: consent}), signal:controller.signal});
      const result = await readScoutStream(response, query.trim(), event=>setEvents(es=>[...es,event]));
      setReceipt(result);
    } catch(e) {setError(controller.signal.aborted ? "수집 대기를 중단했습니다. 이미 저장됐다면 최근 기록에서 다시 열 수 있습니다." : e instanceof Error ? e.message : "수집 실패");}
    finally {clearInterval(tick); clearTimeout(timeout); active.current=null; setBusy(false); void refresh();}
  }
  async function restore(id: string) {
    if (busy) return;
    setError("");
    try {const r=await fetch(`/api/evidence-scout/searches/${encodeURIComponent(id)}`, {signal:AbortSignal.timeout(5000)}); if(!r.ok) throw new Error(); const data=readScoutReceipt(await r.json()); setReceipt(data);setQuery(data.query);setConsent(false);setSelected("");setCondition("");setEvents([]);setRestored(true);}
    catch {setError("저장 기록을 열지 못했습니다.");}
  }
  async function restoreResearchContext(context:ResearchContext) {
    const response=await fetch(`/api/evidence-scout/searches/${encodeURIComponent(context.search_id)}`,{signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error("조사의 원래 시험 선택 기록을 찾지 못했습니다.");
    const receipt=readScoutReceipt(await response.json());
    if(!receipt.studies.some(s=>s.nct_id===context.nct_id && s.conditions.includes(context.indication)))throw Error("저장된 조사와 시험 맥락이 일치하지 않습니다.");
    setReceipt(receipt);setQuery(receipt.query);setSelected(context.nct_id);setAsset(context.asset);setCondition(context.indication);setConsent(false);setEvents([]);setRestored(true);
  }
  const study = receipt?.studies.find(s => s.nct_id === selected);
  return <section className="scout" aria-label="약물명으로 근거 수집">
    <div className="scout-heading"><span className="scout-eyebrow">새 검토 · EVIDENCE SCOUT</span><h1>어떤 약물을 검토할까요?</h1><p>약물명으로 공개 임상시험을 찾고, 이번 검토에 필요한 근거부터 모읍니다.</p></div>
    <form className="scout-search" onSubmit={e=>{e.preventDefault();void search();}}>
      <TextField fullWidth label="약물명 · 개발 코드 · NCT 번호" placeholder="예: sotorasib, AMG 510, NCT03600883" value={query} disabled={busy} onChange={e=>{setQuery(e.target.value);setConsent(false);}} slotProps={{htmlInput:{maxLength:100},input:{startAdornment:<InputAdornment position="start"><Search size={22}/></InputAdornment>}}}/>
      <div className="scout-examples"><span>예시 입력</span>{["sotorasib","osimertinib","NCT03600883"].map(q=><Button key={q} size="small" disabled={busy} onClick={()=>{setQuery(q);setConsent(false);}}>{q}</Button>)}<span className="scout-purpose">검토 목적: 용량 비교 설계</span></div>
      <FormControlLabel control={<Checkbox checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>} label="공개된 약물명·시험 번호입니다. 검색어를 ClinicalTrials.gov에 보내고 수집 결과를 이 컴퓨터에 저장합니다."/>
      <div className="scout-actions"><Button type="submit" variant="contained" size="large" disabled={!ready || busy || query.trim().length<2 || !consent} endIcon={searchBusy?<CircularProgress size={18} color="inherit"/>:<ArrowRight size={18}/>}>{searchBusy?"공개 근거 수집 중":"근거 수집 시작"}</Button><Button disabled={locked || busy} onClick={()=>onIntake()}>보유한 PDF로 시작</Button><Button disabled={locked || busy} onClick={()=>onIntake()}>저장한 프로젝트 이어서</Button><span>모델 호출 0 · 공개 등록정보부터</span></div>
    </form>
    {!ready&&<Alert severity="info" action={<Button onClick={()=>void refresh()}>연결 확인</Button>}>공개 수집 서버가 활성화되지 않았습니다. 기존 PDF 검토는 사용할 수 있습니다.</Alert>}
    {(searchBusy || events.length>0)&&<div className="scout-progress" role="status"><div><strong>{searchBusy?"Evidence Scout 작업 중":error?"수집 중단 · 완료 미확인":"수집 작업 종료"}</strong><span>{seconds===0?"1초 미만":`${seconds}초`} · 실제 수집 상태</span>{searchBusy&&<Button size="small" onClick={()=>active.current?.abort()}>대기 중단</Button>}</div>{events.map((e,i)=><p key={i}>{searchBusy && i===events.length-1?<CircularProgress size={16}/>:<Check size={16}/>}{e.message ?? "로컬 근거 DB 저장 완료"}</p>)}</div>}
    {error&&<Alert severity="error">{error}</Alert>}
    {receipt ? <>
      <div className="scout-result-heading"><div><span className="scout-eyebrow">{restored?"저장 기록 · 재검색하지 않음":"실시간 공개 수집 · MOC 아님"}</span><h2>{receipt.query} <span>근거 작업공간</span></h2><p>검색 일치 {receipt.total_count}건 중 {receipt.fetched_count}건 저장 · {new Date(receipt.created_at).toLocaleString("ko-KR")}</p></div><Button startIcon={<Database size={16}/>} onClick={()=>downloadText(`trialboard-scout-${receipt.id}.json`,JSON.stringify(receipt,null,2),"application/json")}>수집 기록 JSON</Button></div>
      <Alert severity="info">{receipt.truncated?"한 번에 최대 20건만 수집합니다. 전체 검색 결과가 아닙니다. ":""}검색 일치는 약물 동일성·임상 적합성 검증이 아닙니다. 관련 시험을 선택하세요. 등록정보의 시험군은 새 설계안이 아닙니다.</Alert>
      {!receipt.studies.length?<p>일치한 공개 시험이 없습니다. 영문 일반명·개발 코드 또는 정확한 NCT 번호로 다시 검색하세요. 비공개 자료는 자동 수집할 수 없습니다.</p>:<div className="scout-results"><div className="scout-trials" role="group" aria-label="검토할 임상시험 선택">{receipt.studies.map(s=><button type="button" disabled={busy} key={s.nct_id} aria-pressed={selected===s.nct_id} className={selected===s.nct_id?"selected":""} onClick={()=>{setSelected(s.nct_id);setAsset(/^NCT\d{8}$/i.test(receipt.query)?(s.interventions.filter(i=>i.type==="DRUG").length===1?s.interventions.find(i=>i.type==="DRUG")!.name:""):receipt.query);setCondition(s.conditions.length===1?s.conditions[0]:"");}}><span className="scout-trial-meta">{s.nct_id} <span>{s.phases.join(" / ") || "단계 미보고"}</span></span><strong>{s.title}</strong><span>{s.conditions.join(" · ")}</span><span className="scout-trial-meta">{s.status} · {s.results_available?"등록 결과 있음":"등록 결과 미확보"}<ArrowRight size={16}/></span></button>)}</div>
      <div className="scout-detail">{study?<><div className="scout-detail-head"><Chip size="small" label="검토 대상 · 사용자 선택"/><a href={study.url} target="_blank" rel="noreferrer">등록 원문 <ExternalLink size={14}/></a></div><h3>{study.nct_id}</h3><p>{study.title}</p><dl><div><dt>스폰서</dt><dd>{study.sponsor ?? "미보고"}</dd></div><div><dt>등록 모집 수</dt><dd>{study.enrollment?`${study.enrollment.count} · ${study.enrollment.type}`:"미보고"}</dd></div><div><dt>등록 갱신일</dt><dd>{study.updated ?? "미보고"}</dd></div></dl><h4>등록된 중재</h4><p>{study.interventions.map(i=>i.name).join(" · ") || "미보고"}</p><h4>시험군 {study.arms.length}개</h4>{study.arms.slice(0,6).map((a,i)=><p key={i} className="scout-arm">{a.label}</p>)}{study.arms.length>6&&<p>나머지 {study.arms.length-6}개는 수집 JSON에서 확인</p>}<h4>주요 평가변수 {study.primary_outcomes.length}개</h4>{study.primary_outcomes.slice(0,3).map((o,i)=><p key={i}>{o.measure}<span className="scout-timeframe">{o.timeFrame}</span></p>)}{study.primary_outcomes.length>3&&<p className="scout-footnote">앞의 3개만 표시 · 전체 평가변수는 수집 JSON에서 확인</p>}<div className="scout-gap"><strong>다음으로 확보할 근거</strong><p>아래의 다중 출처 조사에서 논문·프로토콜·SAP·FDA 문서 연결을 수집할 수 있습니다. 등록정보만으로 용량·확률을 추정하지 않습니다.</p><span>등록 문서 메타데이터 {study.documents.length}건 · 원문 다운로드/검증 전</span></div><TextField disabled={busy} fullWidth label="검토 약물 · 이름을 확인하세요" value={asset} onChange={e=>setAsset(e.target.value)} helperText="NCT 번호는 약물명이 아닙니다. 병용시험이면 검토할 약물을 지정하세요."/><TextField disabled={busy} select fullWidth label="이번 검토의 적응증" value={condition} onChange={e=>setCondition(e.target.value)}><MenuItem value="">적응증을 선택하세요</MenuItem>{study.conditions.map(c=><MenuItem key={c} value={c}>{c}</MenuItem>)}</TextField><Button fullWidth variant="contained" disabled={locked || busy || !condition || !asset.trim()} endIcon={<ArrowRight size={18}/>} onClick={()=>onIntake({asset:asset.trim(),study:study.nct_id,indication:condition,question:"용량별 반응과 이상반응을 같은 조건에서 비교할 수 있는가?",receiptId:receipt.id})}>이 시험의 PDF 검토로 이어가기</Button><p className="scout-footnote">등록정보와 PDF가 같은 시험인지 직접 확인해야 합니다.</p></>:<div className="scout-unselected"><Search size={28}/><h3>어떤 시험을 검토할까요?</h3><p>왼쪽에서 시험을 고르면 중재·시험군·평가변수와 빠진 근거를 확인할 수 있습니다.</p></div>}</div></div>}
      {study&&<ResearchPanel context={{search_id:receipt.id,nct_id:study.nct_id,asset:asset.trim(),indication:condition}} onIntake={onIntake} onBusy={reportResearchBusy} onRestoreContext={restoreResearchContext} locked={locked}/>}
      <details className="scout-integrity"><summary>출처와 저장 정보</summary><p>ClinicalTrials.gov API v2 · 등록 원본 스냅샷 + 구조화 자료 · 로컬 SQLite · 임상 검증 전</p><p>수집 ID {receipt.id}</p><p>원본 SHA-256 {receipt.digest}</p><p>현재 버전의 수집 이력입니다. 과거 프로토콜 변경 계보를 재구성한 것은 아닙니다.</p></details>
    </>:<div className="scout-flow">{[["01","약물로 찾기","공개 등록정보 검색"],["02","시험 선택","적응증·시험군·빠진 근거 확인"],["03","원문 검토","PDF를 추가해 에이전트와 검토"]].map(([n,t,d])=><div key={n}><span>{n}</span><strong>{t}</strong><p>{d}</p></div>)}</div>}
    {history.length>0&&<section className="scout-history"><h2>최근 수집 기록</h2><p>새로고침해도 이 컴퓨터에 남습니다. 열기는 외부 검색을 하지 않습니다.</p>{history.map(h=><Button key={h.id} disabled={busy} variant="outlined" onClick={()=>void restore(h.id)}>{h.query} · {h.fetched_count}건 · {new Date(h.created_at).toLocaleString("ko-KR")}</Button>)}</section>}
  </section>;
}
