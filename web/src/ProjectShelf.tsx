import {useEffect,useRef,useState} from "react";
import {Alert,Button,Checkbox,Dialog,DialogActions,DialogContent,DialogTitle,FormControlLabel,TextField} from "@mui/material";
import {FolderOpen,Save} from "lucide-react";
import {projectRequest,readProjectReceipt,type ProjectReceipt,type ProjectRecord} from "./project-checkpoint";

export default function ProjectShelf({available,locked,receipt,onSave,onRestore,onBusy}:{available:boolean;locked:boolean;receipt:ProjectReceipt|null;onSave:(title:string,fork?:boolean)=>Promise<ProjectReceipt>;onRestore:(record:ProjectRecord)=>Promise<void>;onBusy:(busy:boolean)=>void}){
  const [title,setTitle]=useState("");const [consent,setConsent]=useState(false);const [rows,setRows]=useState<ProjectReceipt[]>([]);
  const [error,setError]=useState("");const [notice,setNotice]=useState("");const [pending,setPending]=useState<ProjectReceipt|null>(null);const [busy,setBusy]=useState(false);const working=useRef(false);
  useEffect(()=>{setTitle(receipt?.title??"");setConsent(false);},[receipt]);
  async function refresh(){try{const list=await projectRequest("/api/projects");if(!Array.isArray(list)||list.length>100)throw Error("저장 목록 형식 오류");setRows(list.map(readProjectReceipt));setError("");}catch(e){setError(e instanceof Error?e.message:"저장 목록 오류");}}
  useEffect(()=>{void refresh();},[]);
  async function act(work:()=>Promise<void>){if(working.current||locked)return;working.current=true;setBusy(true);onBusy(true);setError("");setNotice("");try{await work();}catch(e){setError(e instanceof Error?e.message:"프로젝트 작업 실패");}finally{working.current=false;setBusy(false);onBusy(false);}}
  return <section className="project-shelf" aria-label="로컬 프로젝트">
    <div className="project-heading"><div><span className="document-kicker">LOCAL PROJECT · CHECKPOINT</span><h2>한 번에 저장하고, 이어서 검토하세요</h2><p>PDF · 원문 메모 · 필드 이력 · 설계 초안 · 현재 비교·회의 기록을 이 컴퓨터에 보관합니다.</p></div><FolderOpen size={28}/></div>
    {receipt&&<Alert severity="success">{receipt.title} · v{receipt.revision} 기준으로 작업 중. 이후 변경은 다시 저장해야 합니다.</Alert>}
    {available&&<><div className="project-actions"><TextField size="small" label="프로젝트 이름" value={title} onChange={e=>setTitle(e.target.value)} disabled={busy||locked} slotProps={{htmlInput:{maxLength:120}}}/><Button variant="contained" startIcon={<Save size={16}/>} disabled={busy||locked||!consent||!title.trim()} onClick={()=>void act(async()=>{const saved=await onSave(title.trim());setNotice(`v${saved.revision} 저장 완료. 새 검색·모델 호출·재계산 없이 복구할 수 있습니다.`);await refresh();})}>{busy?"기록 처리 중…":receipt?"새 버전 저장":"프로젝트 저장"}</Button></div>
    {receipt&&<Button disabled={busy||locked||!consent||!title.trim()} onClick={()=>void act(async()=>{await onSave(title.trim(),true);setNotice("현재 작업을 새 프로젝트 복사본으로 저장했습니다. 원래 프로젝트의 모든 버전은 유지됩니다.");await refresh();})}>별도 프로젝트로 복사 저장</Button>}
    <FormControlLabel control={<Checkbox checked={consent} disabled={busy||locked} onChange={e=>setConsent(e.target.checked)}/>} label="공개·사용 허가된 비민감 자료입니다. PDF 원본과 검토 기록을 로컬 DB에 저장하는 데 동의합니다."/></>}
    <p className="pdf-caption">자동 저장·클라우드 동기화·팀원 인증이 아닙니다. AI 재검토 패널의 임시 결과와 별도 첨부 파일은 포함하지 않으며, 최초 추출 결과는 필드 검토에 연결한 경우 함께 보관합니다. 저장은 임상 승인이나 근거의 진위 인증이 아닙니다.</p>
    {error&&<Alert severity="error">{error}</Alert>}{notice&&<Alert severity="success">{notice}</Alert>}
    <details><summary>저장된 프로젝트 · 최근 버전 {rows.length}개</summary><Button disabled={busy||locked} onClick={()=>void refresh()}>저장 목록 새로고침</Button>{!rows.length&&<p>아직 저장된 프로젝트가 없습니다. PDF를 열고 프로젝트를 저장하세요.</p>}<div className="project-history">{rows.map(row=><Button key={`${row.project_id}-${row.revision}`} disabled={busy||locked} variant="outlined" onClick={()=>setPending(row)}>{row.title} · v{row.revision} · {new Date(row.created_at).toLocaleString("ko-KR")}</Button>)}</div></details>
    <Dialog open={!!pending} onClose={()=>!busy&&setPending(null)} fullWidth maxWidth="sm"><DialogTitle>저장한 프로젝트로 이어갈까요?</DialogTitle><DialogContent><p>{pending?.title} · v{pending?.revision}</p><p>현재 PDF·미저장 편집·검토·설계·회의 기록을 교체합니다. 필요한 작업을 먼저 저장하세요.</p><Alert severity="info">PDF 지문과 필드·설계·회의 연결을 검사한 뒤에만 교체합니다. 검색·모델 실행·전문가 확인은 하지 않습니다.</Alert></DialogContent><DialogActions><Button disabled={busy} onClick={()=>setPending(null)}>현재 작업 유지</Button><Button disabled={busy||locked} variant="contained" onClick={()=>void act(async()=>{const row=pending!;const record=await projectRequest(`/api/projects/${encodeURIComponent(row.project_id)}/${row.revision}`) as ProjectRecord;if(record.project_id!==row.project_id||record.revision!==row.revision||record.bundle_digest!==row.bundle_digest)throw Error("선택한 버전과 응답이 다릅니다.");await onRestore(record);setPending(null);setNotice(`v${row.revision} 복구 완료. 새 계산·AI 실행은 하지 않았습니다.`);})}>검사하고 프로젝트 열기</Button></DialogActions></Dialog>
  </section>;
}
