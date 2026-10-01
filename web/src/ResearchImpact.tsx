import {useEffect,useRef,useState} from "react";
import {Alert,Button,CircularProgress} from "@mui/material";
import {loadResearchImpact,type ResearchImpact as Impact} from "./research-impact";

const useLabel={REVIEW_FINDING:"검토 finding의 직접 인용",REVIEW_INPUT_PRIORITY:"검토 입력 우선순위"} as const;

export default function ResearchImpact({runId,sourceId,sourceDigest}:{runId:string;sourceId:string;sourceDigest:string}){
 const [result,setResult]=useState<Impact|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
 const pending=useRef<AbortController|null>(null),ticket=useRef(0);
 useEffect(()=>{pending.current?.abort();pending.current=null;ticket.current+=1;setResult(null);setError("");setLoading(false);return()=>pending.current?.abort();},[runId,sourceId,sourceDigest]);
 async function inspect(){pending.current?.abort();const controller=new AbortController(),current=++ticket.current;pending.current=controller;setLoading(true);setError("");setResult(null);try{const next=await loadResearchImpact({runId,sourceId,sourceDigest},controller.signal);if(!controller.signal.aborted&&ticket.current===current)setResult(next);}catch(reason){if(!controller.signal.aborted&&ticket.current===current)setError(reason instanceof Error?reason.message:"기록된 사용 후보 조회 실패");}finally{if(ticket.current===current){pending.current=null;setLoading(false);}}}
 return <section className="research-impact" aria-labelledby="research-impact-title"><div className="research-impact-head"><div><h4 id="research-impact-title">정확 버전의 기록된 사용처</h4><p>같은 프로젝트의 다른 저장 실행에서 이 SOURCE RECORD 지문을 직접 참조한 경우만 찾습니다.</p></div><Button variant="outlined" disabled={loading} onClick={()=>void inspect()}>{loading?"조회 중":"사용 후보 조회"}</Button></div>
  <div aria-live="polite">{loading&&<p className="research-impact-state"><CircularProgress size={16}/> 저장 기록을 읽고 있습니다.</p>}{error&&<Alert severity="warning">{error}</Alert>}
  {result&&<><p className="research-impact-count"><strong>{result.candidate_count}</strong>건의 다른 기록된 사용 후보</p>{result.candidates.length===0?<p className="research-impact-empty">같은 프로젝트·같은 버전에서 확인된 다른 직접 참조가 없습니다.</p>:<ul>{result.candidates.map(candidate=><li key={candidate.run_id}><strong>{candidate.asset} · {candidate.nct_id}</strong><span>{new Date(candidate.created_at).toLocaleString("ko-KR")} · {candidate.status}</span><span>{candidate.uses.map(use=>`${useLabel[use.kind]} ${use.reference_count}건`).join(" / ")}</span><small>{candidate.source_title} · 실행 {candidate.run_id}</small></li>)}</ul>}<details><summary>조회 범위와 추적하지 않는 항목</summary>{result.caveats.map(item=><p key={item}>{item}</p>)}</details></>}</div>
 </section>;
}
