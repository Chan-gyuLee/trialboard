import {useEffect,useRef,useState} from "react";
import {Alert,Button,MenuItem,TextField} from "@mui/material";
import {downloadText} from "./review";
import {curationLabel,readCuration,type Curation} from "./research-curation";
import type {ResearchSource} from "./research";

export default function ResearchCuration({runId,source}:{runId:string;source:ResearchSource}){
  const [notes,setNotes]=useState<Curation[]>([]),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState("");
  const [decision,setDecision]=useState("CHECK"),[reason,setReason]=useState(""),[reviewer,setReviewer]=useState("");
  const [saved,setSaved]=useState(false);
  const mounted=useRef(true);
  const url=`/api/research/runs/${encodeURIComponent(runId)}/curation`;
  async function read(){
    const response=await fetch(`${url}?source_id=${encodeURIComponent(source.id)}`,{signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error("저장된 검토 이력을 열지 못했습니다.");
    return readCuration(await response.text(),runId,source.id,source.digest);
  }
  useEffect(()=>{mounted.current=true;void read().then(n=>{if(mounted.current)setNotes(n);}).catch(e=>{if(mounted.current)setError(e.message);}).finally(()=>{if(mounted.current)setLoading(false);});return()=>{mounted.current=false;};},[runId,source.id]);
  async function save(){
    if(saving||loading||reason.trim().length<3||!reviewer.trim())return;
    setSaving(true);setError("");setSaved(false);
    try{
      const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({source_id:source.id,expected_revision:notes[0]?.revision??0,decision,reason:reason.trim(),reviewer_label:reviewer.trim()}),signal:AbortSignal.timeout(5000)});
      if(response.status===409)throw Error("다른 화면에서 이 자료의 검토 이력이 바뀌었습니다. 최신 이력을 불러온 뒤 내용을 비교하고 다시 저장하세요.");
      if(!response.ok)throw Error("검토 기록을 저장하지 못했습니다.");
      const next=await read();
      if(mounted.current){setNotes(next);setReason("");setSaved(true);}
    }catch(e){if(mounted.current)setError(e instanceof Error?e.message:"저장 실패");}
    finally{if(mounted.current)setSaving(false);}
  }
  return <div className="research-curation"><h4>이 근거를 검토에 사용할까요?</h4>
    <p>자료와 AI 초안은 그대로 보존합니다. 이 판단은 전문가 인증·AI 재검토·설계 승인으로 처리되지 않습니다. 비민감 메모만 입력하세요.</p>
    {notes[0]&&<Alert severity="info">현재 기록: {curationLabel(notes[0].decision)} · v{notes[0].revision} · {notes[0].reviewer_label} (미인증 작성자)</Alert>}
    <TextField select fullWidth label="근거 검토 판단" value={decision} disabled={loading||saving} onChange={e=>{setDecision(e.target.value);setSaved(false);}}>{["INCLUDE","CHECK","EXCLUDE"].map(d=><MenuItem key={d} value={d}>{curationLabel(d)}</MenuItem>)}</TextField>
    <TextField fullWidth label="판단 사유 · 적용 범위" multiline minRows={3} value={reason} disabled={loading||saving} onChange={e=>{setReason(e.target.value);setSaved(false);}} slotProps={{htmlInput:{maxLength:2000}}}/>
    <TextField fullWidth label="작성자 표시명 · 인증되지 않음" value={reviewer} disabled={loading||saving} onChange={e=>{setReviewer(e.target.value);setSaved(false);}} slotProps={{htmlInput:{maxLength:80}}}/>
    {error&&<Alert severity="error">{error}<Button onClick={()=>{setLoading(true);void read().then(setNotes).catch(e=>setError(e.message)).finally(()=>setLoading(false));}}>최신 이력 불러오기</Button></Alert>}
    {saved&&<Alert severity="success">판단과 사유를 로컬 DB에 저장했습니다. 원문·AI 검토 내용은 변경하지 않았습니다.</Alert>}
    <Button variant="outlined" onClick={()=>void save()} disabled={loading||saving||reason.trim().length<3||!reviewer.trim()}>{saving?"저장 중":"근거 검토 이력 저장"}</Button>
    {notes.length>0&&<details><summary>판단 이력 · {notes.length}개 버전</summary>{notes.map(n=><p key={n.revision}>v{n.revision} · {curationLabel(n.decision)} · {n.reviewer_label} · {new Date(n.created_at).toLocaleString("ko-KR")}<br/>{n.reason}</p>)}<Button onClick={()=>downloadText(`trialboard-curation-${runId}-${source.id}.json`,JSON.stringify(notes,null,2),"application/json")}>이 근거의 판단 이력 JSON</Button></details>}
  </div>;
}
