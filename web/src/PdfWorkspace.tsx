import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, CircularProgress, FormControlLabel, TextField } from "@mui/material";
import { ArrowDownToLine, ChevronLeft, ChevronRight, FileText, Trash2, Upload } from "lucide-react";
import type { RenderTask } from "pdfjs-dist";
import { openPdf, type LoadedPdf } from "./pdf-loader";
import { attestSpan, evidenceExport, evidenceMarkdown, PDF_LIMITS, type EvidenceNote, type PdfSpan } from "./pdf-contract";
import { downloadText } from "./review";
import "./pdf.css";
import FieldReviewPanel from "./FieldReviewPanel";
import { MocBadge, MocFileButton } from "./MocDemo";
import { isMocSource } from "./moc-data";
import { guardSessionExit } from "./session-exit";
import PdfAgentRunner from "./PdfAgentRunner";
import ProjectShelf from "./ProjectShelf";
import {checkpointBody,projectFile,projectRequest,readProjectReceipt,validateProject,type ProjectBundle,type ProjectReceipt,type ProjectRecord,type RestoredProject,type ReviewCheckpoint} from "./project-checkpoint";

function PagePreview({ loaded, page, selected, onReady }: { loaded: LoadedPdf; page: number; selected: PdfSpan | null; onReady: (page: number | null) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const highlight = useRef<HTMLSpanElement>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const info = loaded.source.pages[page - 1];
  useEffect(() => {
    let disposed = false, render: RenderTask | undefined;
    const container = host.current!;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", `원문 PDF ${page}페이지. 추출 문구는 옆 목록에 있습니다.`);
    container.replaceChildren(canvas);
    setError(""); setReady(false); onReady(null);
    const timer = setTimeout(() => {
      if (!disposed) { disposed = true; render?.cancel(); setError("페이지 렌더링 시간이 초과되었습니다. 다른 페이지를 선택하거나 파일을 다시 열어 주세요."); onReady(null); }
    }, 10000);
    void loaded.pdf.getPage(page).then(async pdfPage => {
      if (disposed) return;
      const base = pdfPage.getViewport({ scale: 1 });
      // Keep both pixel count and extreme aspect ratios bounded.
      const scale = Math.min(1.5, 1600 / base.width, 2400 / base.height, Math.sqrt(2000000 / (base.width * base.height)));
      const viewport = pdfPage.getViewport({ scale });
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      render = pdfPage.render({ canvas, viewport });
      await render.promise;
      if (!disposed) { setReady(true); onReady(page); }
    }).catch(() => {
      if (!disposed) { setError("이 페이지를 표시하지 못했습니다. 문구 확인으로 기록하지 마세요."); onReady(null); }
    }).finally(() => clearTimeout(timer));
    return () => { disposed = true; clearTimeout(timer); render?.cancel(); canvas.remove(); };
  }, [loaded, page, onReady]);
  useEffect(() => {
    if (ready) highlight.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected, ready]);
  return <section className="pdf-original" aria-label="PDF 원문">
    <div className="pdf-pane-title"><strong>원문 · PDF p.{page}</strong><span>강조는 글꼴 기준 근사 위치</span></div>
    {!ready && !error && <p role="status">페이지 표시 중…</p>}
    {error && <Alert severity="error">{error}</Alert>}
    <div className="pdf-scroll"><div className="pdf-canvas-wrap" style={{ aspectRatio: `${info.width} / ${info.height}`, visibility: ready ? "visible" : "hidden" }}>
      <div ref={host} />
      {ready && selected?.page === page && selected.box && <span ref={highlight} className="pdf-selected-box" aria-hidden style={{ left: `${selected.box.x * 100}%`, top: `${selected.box.y * 100}%`, width: `${selected.box.width * 100}%`, height: `${selected.box.height * 100}%` }} />}
    </div></div>
    <p className="pdf-caption">주석·양식의 동작과 PDF 내 스크립트는 실행하지 않습니다. 큰 이미지가 생략될 수 있으므로 원본이 불완전하게 보이면 확인하지 마세요.</p>
  </section>;
}

export default function PdfWorkspace({onAgentBusy,scoutContext,onResearch}:{scoutContext?:import("./evidence-scout").ScoutContext;onAgentBusy?:(busy:boolean)=>void;onResearch?:(context:import("./evidence-scout").ScoutContext)=>void}) {
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const current = useRef<LoadedPdf | null>(null);
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [readyPage, setReadyPage] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PdfSpan | null>(null);
  const [question, setQuestion] = useState("이 문구가 용량 비교시험 준비에 어떤 근거가 되는가?");
  const [comment, setComment] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [noteDirty,setNoteDirty]=useState(false);
  const [notes, setNotes] = useState<EvidenceNote[]>([]);
  const [notice, setNotice] = useState("");
  const [pane, setPane] = useState<"text" | "agent" | "fields" | "design">("text");
  const [agentHandoff,setAgentHandoff]=useState<{raw:string;id:string}|null>(null);
  const [projectReceipt,setProjectReceipt]=useState<ProjectReceipt|null>(null);
  const [initialProject,setInitialProject]=useState<RestoredProject|null>(null);
  const [projectContext,setProjectContext]=useState<typeof scoutContext>(undefined);
  const [projectBusy,setProjectBusy]=useState(false);
  const [agentBusy,setAgentBusy]=useState(false);
  const [reviewBusy,setReviewBusy]=useState(false);
  const [workspaceVersion,setWorkspaceVersion]=useState(0);
  const checkpoint=useRef<(()=>Promise<ReviewCheckpoint>)|null>(null);
  // Local checkpoint work must not show the global model-usage warning.
  useEffect(()=>{onAgentBusy?.(agentBusy);},[agentBusy,onAgentBusy]);
  useEffect(() => () => { pending.current?.abort(); void current.current?.destroy().catch(() => {}); }, []);
  // Child review/design state also lives only in memory, even while another tab is shown.
  useEffect(() => loaded ? guardSessionExit(window) : undefined, [loaded]);

  async function accept(file?: File, collected=false) {
    if (!file || pending.current || projectBusy || agentBusy) return;
    if (current.current && !window.confirm("PDF를 바꾸면 원문 메모·필드 검토·설계 입력·비교 결과·KOL 회의 기록이 초기화됩니다. 필요한 JSON을 각각 내려받았나요?")) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setProgress(0); setError(""); setNotice("");
    try {
      const next = await openPdf(file, controller.signal, n => { if (pending.current === controller) setProgress(n); });
      if (pending.current !== controller || controller.signal.aborted) { void next.destroy(); return; }
      const old = current.current; current.current = next;
      setAgentHandoff(null);
      setProjectReceipt(null);setInitialProject(null);setWorkspaceVersion(v=>v+1);
      setNoteDirty(false);
      setProjectContext(scoutContext&&!isMocSource(next.source)?{...scoutContext,document:collected?scoutContext.document:undefined}:undefined);
      setLoaded(next); setPdfFile(file); setPage(1); setReadyPage(null); setSelected(null); setQuery(""); setNotes([]); setConfirmed(false); setComment(""); setPane("text");
      if (old) void old.destroy().catch(() => {});
    } catch (e) {
      if (pending.current === controller && !controller.signal.aborted) setError(e instanceof Error ? e.message : "PDF를 읽지 못했습니다.");
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }
  function cancel() { pending.current?.abort(); pending.current = null; setBusy(false); setNotice("읽기를 취소했습니다. 기존 자료와 메모는 유지됩니다."); }
  async function openCollectedDocument() {
    const document = scoutContext?.document;
    if (!document || pending.current || busy) return;
    const fetchController=new AbortController();pending.current=fetchController;
    const timeout=setTimeout(()=>fetchController.abort(),35000);
    setBusy(true);setError("");setNotice("등록된 공개 출처에서 PDF를 내려받고 로컬 DB에 보관합니다.");
    try {
      const response=await fetch(`/api/research/runs/${encodeURIComponent(document.runId)}/documents/${encodeURIComponent(document.sourceId)}`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({consent:true}),signal:fetchController.signal});
      if(!response.ok || !response.headers.get("content-type")?.startsWith("application/pdf"))throw Error("공개 PDF를 확보하지 못했습니다. 접근 제한·5MB 초과일 수 있습니다. 출처에서 직접 확인하세요.");
      const blob=await response.blob();
      if(blob.size>5_000_000)throw Error("PDF가 5MB를 초과합니다.");
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await blob.arrayBuffer())),b=>b.toString(16).padStart(2,"0")).join("");
      if(digest!==response.headers.get("X-Source-Sha256"))throw Error("다운로드한 PDF와 저장된 출처 지문이 다릅니다.");
      if(pending.current!==fetchController || fetchController.signal.aborted)return;
      pending.current=null;
      setBusy(false);
      await accept(new File([blob],`${document.sourceId}.pdf`,{type:"application/pdf"}),true);
    } catch(e) {setError(e instanceof Error?e.message:"공개 문서 불러오기 실패");}
    finally {clearTimeout(timeout);if(pending.current===fetchController){pending.current=null;setBusy(false);}}
  }
  function clear() {
    if(projectBusy||agentBusy)return;
    if (current.current && !window.confirm("이 탭의 PDF·원문 메모·필드 검토·설계 입력·비교 결과·KOL 회의 기록을 제거할까요? 내려받지 않은 기록은 복구할 수 없습니다. 원본 파일은 삭제하지 않습니다.")) return;
    cancel(); void current.current?.destroy().catch(() => {}); current.current = null;
    setLoaded(null); setPdfFile(null); setNotes([]); setSelected(null); setConfirmed(false); setError(""); setNotice(""); setReadyPage(null);
    setProjectReceipt(null);setInitialProject(null);setProjectContext(undefined);setAgentHandoff(null);
  }
  async function saveProject(title:string,fork=false){
    if(!loaded||!pdfFile||!checkpoint.current||pending.current||agentBusy)throw Error("PDF와 검토 준비가 끝난 뒤 저장하세요.");
    if(noteDirty||confirmed)throw Error("원문 확인 메모의 미기록 입력을 먼저 추가하거나 다른 문구를 선택해 편집을 취소하세요.");
    const fields=await checkpoint.current();
    const bundle:ProjectBundle={schema:"trialboard-project/1",source:loaded.source,notes,...fields,context:projectContext??null};
    const saved=readProjectReceipt(await projectRequest("/api/projects",await checkpointBody(title,pdfFile,bundle,fork?null:projectReceipt)));
    setProjectReceipt(saved);return saved;
  }
  async function restoreProject(record:ProjectRecord){
    if(pending.current||agentBusy)throw Error("현재 실행이 끝난 뒤 복구하세요.");
    const controller=new AbortController();pending.current=controller;let next:LoadedPdf|null=null;
    try{const {file,bundle}=await projectFile(record);next=await openPdf(file,controller.signal,()=>{});
      const restored=await validateProject(bundle,next.source);
      if(pending.current!==controller||controller.signal.aborted)throw Error("프로젝트 열기가 취소되었습니다.");
      const old=current.current;current.current=next;setLoaded(next);setPdfFile(file);next=null;
      setInitialProject(restored);setProjectContext(bundle.context??undefined);setProjectReceipt(readProjectReceipt(record));setWorkspaceVersion(v=>v+1);
      setNoteDirty(false);
      setAgentHandoff(null);setNotes(bundle.notes);setSelected(null);setQuery("");setConfirmed(false);setComment("");setPage(1);setReadyPage(null);setError("");setNotice("");setPane(restored.session?"design":"fields");
      if(old)void old.destroy().catch(()=>{});
    }finally{if(next)await next.destroy().catch(()=>{});if(pending.current===controller)pending.current=null;}
  }
  function choose(span: PdfSpan) {
    if (span.page !== page) setReadyPage(null);
    setPage(span.page); setSelected(span); setConfirmed(false); setComment(""); setNotice("");setNoteDirty(false);
  }
  function changePage(next: number) { setPage(next); setReadyPage(null); setSelected(null); setConfirmed(false); }
  function saveNote() {
    if (!loaded || !selected || readyPage !== selected.page) return;
    try {
      const note = attestSpan(loaded.source, selected.id, question, comment, confirmed);
      if (notes.length >= PDF_LIMITS.notes && !notes.some(n => n.spanId === note.spanId)) throw new Error("문서당 메모는 100개까지 지원합니다.");
      setNotes(list => [...list.filter(n => n.spanId !== note.spanId), note]);
      setNoteDirty(false);
      setConfirmed(false); setError(""); setNotice("원문 확인 메모를 추가했습니다. 같은 문구를 다시 저장하면 해당 메모가 갱신됩니다.");
    } catch (e) { setError(e instanceof Error ? e.message : "메모를 저장하지 못했습니다."); }
  }
  const source = loaded?.source;
  const visible = source?.pages[page - 1].spans.filter(s => s.text.toLowerCase().includes(query.toLowerCase())) ?? [];
  const canConfirm = selected?.box && readyPage === selected.page && !busy;
return <div className="pdf-workspace">
    <ProjectShelf available={!!loaded} locked={busy||agentBusy||reviewBusy} receipt={projectReceipt} onSave={saveProject} onRestore={restoreProject} onBusy={setProjectBusy}/>
    {projectBusy&&<Alert severity="info">프로젝트 기록 처리 중 · PDF·검토·설계 연결을 확인하고 있습니다.</Alert>}
    <div inert={projectBusy}>
    {loaded&&projectContext&&<Alert severity="info">검토 문맥: {projectContext.asset} · {projectContext.study} · {projectContext.indication}. 수집 기록 연결이며 PDF가 같은 시험·분석집단이라는 검증은 아닙니다.</Alert>}
    {scoutContext?.document&&<Alert severity="info" action={<Button disabled={busy} onClick={()=>void openCollectedDocument()}>수집한 공개 PDF 열기</Button>}>{scoutContext.document.title}. 공개 출처에서 최대5MB를 내려받아 DB에 보관하고 원문을 엽니다. FDA 문서는 약물 단위이며 선택 시험과 같다는 뜻이 아닙니다. 40페이지 초과 자료는 현재 뷰어 제한으로 열리지 않을 수 있습니다.</Alert>}
    {isMocSource(source) && <MocBadge detail="합성 PDF · 추출·확인 예제는 테스트 기록 · 계산은 실제 로컬 엔진" />}
    <div className="intake-heading"><span className="document-kicker">PDF에서 설계 회의까지</span><h1>원문을 확인하고, 검토를 이어가세요</h1><p>원문 선택 → 에이전트 검토 → 사람의 확인 → 설계 비교·회의. 모델 전송과 로컬 계산은 각각 동의 후 실행합니다.</p></div>
    <div className="pdf-file-bar"><FileText size={26} /><div><strong>{source?.name ?? "공개·사용 허가된 PDF 한 개"}</strong><p>{source ? `${source.pages.length}페이지 · 원문 메모 ${notes.length}개 · 파일 교체 시 검토·설계·회의 기록 초기화` : "최대 5 MB · 40페이지 · 스캔 OCR·암호 PDF·HWPX 미지원"}</p></div>
      <Button variant="contained" component="label" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <Upload size={16} />} disabled={busy}>{source ? "PDF 바꾸기" : "PDF 선택"}<input className="file-input" type="file" accept=".pdf,application/pdf" onChange={e => { void accept(e.target.files?.[0]); e.target.value = ""; }} /></Button>
      <MocFileButton name="SYNTHETIC-DEMO-NOT-CLINICAL.pdf" disabled={busy} onFile={accept}>MOC 예제 PDF 열기</MocFileButton>
      {busy ? <Button onClick={cancel}>읽기 취소</Button> : source && <Button onClick={clear} aria-label="PDF와 메모·필드 검토 제거"><Trash2 size={17} /></Button>}
    </div>
    <p className="pdf-privacy">PDF 열기·원문 확인은 브라우저에서 처리합니다. ‘에이전트 검토’는 별도 동의 후 선택 문구·주변 문맥·질문을 설정된 실행 모델(대회 API 또는 명시적으로 선택한 Codex)에 전송합니다. 로컬 계산과 프로젝트 저장도 각각 동의 후 처리합니다. 자동 저장하지 않으므로 종료 전 프로젝트를 저장하거나 JSON을 보관하세요. 환자 식별정보나 기업 기밀자료는 넣지 마세요.</p>
    <div aria-live="polite">{busy && <p role="status">PDF 읽는 중 · {progress}페이지 추출 완료</p>}{error && <Alert severity="error">{error}{source && " 기존 자료는 유지됩니다."}</Alert>}{notice && <Alert severity="info">{notice}</Alert>}</div>
    {!source && <div className="pdf-start"><h2>이번 단계에서 할 수 있는 것</h2><ol><li>공개 문서 PDF를 선택합니다.</li><li>페이지별 추출 문구를 눌러 원문 강조 위치를 확인합니다.</li><li>‘필드 검토’에서 관측값을 만들거나 같은 PDF의 에이전트 결과를 불러옵니다.</li><li>용량·분모·집단 등의 값을 원문에 연결하고 확인·수정·보류 사유를 기록합니다.</li><li>‘설계 비교·KOL’에서 검토한 관측값에 용량군을 연결하고, 복수 설계와 가정을 입력합니다.</li><li>계산 결과를 비교하고 KOL 질문에 답변·담당자·다음 행동을 기록합니다. 계산은 별도 로컬 서비스와 전송 동의가 필요합니다.</li><li>필드 검토 JSON과 회의 JSON을 각각 내려받아 다음 검토를 이어갑니다.</li></ol><p>표의 열·분모·관찰기간은 자동 연결하지 않습니다. 글자가 추출되지 않은 페이지는 “텍스트 없음”으로 남깁니다.</p><a href="https://www.accessdata.fda.gov/drugsatfda_docs/appletter/2021/214665Orig1s000ltr.pdf" target="_blank" rel="noreferrer">FDA 공개 승인서한 열기 → 내려받은 파일로 시작</a></div>}
    {source && loaded && <>
      {projectContext&&<section className="pdf-source-trail" aria-label="이 PDF의 수집 출처"><span className="document-kicker">SOURCE TRAIL · 저장 맥락</span><h3>{projectContext.asset} · {projectContext.study}</h3><p>{projectContext.document?.title??"사용자가 별도로 연 PDF · 수집 문서 자동 연결 없음"}</p><p>수집 기록 → {projectContext.document?"저장된 공개 문서 → ":""}현재 PDF → 필드 검토 → 설계·회의. 이 연결은 동일 시험·코호트의 임상적 확인이 아닙니다.</p><Button disabled={busy||projectBusy||agentBusy||reviewBusy||!onResearch} onClick={()=>onResearch?.(projectContext)}>이 PDF의 수집 근거로 돌아가기</Button><details><summary>출처 식별 정보</summary><p>수집 {projectContext.receiptId}</p>{projectContext.document&&<p>조사 {projectContext.document.runId} · 출처 {projectContext.document.sourceId}</p>}<p>PDF SHA-256 {source.sha256}</p></details></section>}
      {source.status !== "TEXT_EXTRACTED" && <Alert severity="warning">{source.status === "NO_TEXT" ? "추출 가능한 텍스트가 없습니다. 스캔·이미지 문서 또는 빈 페이지일 수 있습니다. OCR을 수행하지 않았습니다." : "일부 페이지에 추출 가능한 텍스트가 없습니다. 나머지 문구가 문서 전체를 대표하지 않습니다."}</Alert>}
      <div className="pdf-page-bar"><Button onClick={() => changePage(page - 1)} disabled={page === 1 || busy} startIcon={<ChevronLeft size={16} />}>이전</Button><span>PDF {page} / {source.pages.length}페이지 · 인쇄된 쪽수와 다를 수 있음</span><Button onClick={() => changePage(page + 1)} disabled={page === source.pages.length || busy} endIcon={<ChevronRight size={16} />}>다음</Button></div>
      <div className="field-tabs" role="group" aria-label="검토 방식"><Button variant={pane === "text" ? "contained" : "outlined"} onClick={() => setPane("text")}>01 원문 문구</Button><Button variant={pane === "agent" ? "contained" : "outlined"} onClick={() => setPane("agent")}>02 에이전트 검토</Button><Button variant={pane === "fields" ? "contained" : "outlined"} onClick={() => setPane("fields")}>03 필드 검토</Button><Button variant={pane === "design" ? "contained" : "outlined"} onClick={() => setPane("design")}>04 설계 비교·KOL</Button></div>
      <div hidden={pane !== "agent"}><PdfAgentRunner scoutContext={projectContext} onReveal={span=>{choose(span);setPane("text");}} onBusy={setAgentBusy} key={`${source.sha256}-${workspaceVersion}`} source={source} notes={notes} active={pane === "agent" && !busy && !projectBusy} onHandoff={raw=>{setAgentHandoff({raw,id:crypto.randomUUID()});setPane("fields");}}/></div>
      <div hidden={pane === "agent"} className={`pdf-review-grid${pane === "design" ? " pdf-design-view" : ""}`}><div><section hidden={pane === "text"} className="pdf-extracted"><FieldReviewPanel context={projectContext} key={`${source.sha256}-${workspaceVersion}`} checkpoint={checkpoint} onCheckpointBusy={setReviewBusy} initialProject={initialProject} source={source} pdf={pdfFile} agentHandoff={agentHandoff} selected={selected} readyPage={readyPage} disabled={busy||projectBusy} onChoose={choose} onText={() => setPane("text")} view={pane === "design" ? "design" : "fields"} onFields={() => setPane("fields")} onDesign={() => setPane("design")} /></section><section hidden={pane !== "text"} className="pdf-extracted" aria-label="페이지 추출 문구"><div className="pdf-pane-title"><strong>추출 문구</strong><span>읽기 순서·표 관계 미검증</span></div>
        <TextField fullWidth size="small" label="현재 페이지에서 찾기" value={query} onChange={e => setQuery(e.target.value)} />
        <div className="pdf-span-list">{visible.slice(0, 200).map(span => <button key={span.id} type="button" disabled={busy} onClick={() => choose(span)} aria-pressed={selected?.id === span.id}><span>{span.text}</span><small>{span.id}{!span.box && " · 위치 확인 불가"}{notes.some(n => n.spanId === span.id) && " · 메모 있음"}</small></button>)}
          {!visible.length && <p>{source.pages[page - 1].status === "NO_TEXT" ? "이 페이지에서 텍스트를 추출하지 못했습니다. 내용을 없다고 판단하지 마세요." : "검색한 문구가 없습니다."}</p>}
          {visible.length > 200 && <p>앞의 200개 문구를 표시합니다. 검색어로 범위를 좁혀 주세요.</p>}
        </div>
        <div className="pdf-attest"><h2>선택한 문구의 확인 메모</h2>{selected ? <blockquote>{selected.text}</blockquote> : <p>위 목록에서 확인할 문구를 선택하세요.</p>}
          <TextField fullWidth multiline minRows={2} label="검토 질문" value={question} onChange={e => { setQuestion(e.target.value); setConfirmed(false);setNoteDirty(true); }} slotProps={{ htmlInput: { maxLength: 500 } }} />
          <TextField fullWidth multiline minRows={2} label="메모 · 적용 범위와 추가 확인할 점" value={comment} onChange={e => { setComment(e.target.value); setConfirmed(false);setNoteDirty(true); }} slotProps={{ htmlInput: { maxLength: 2000 } }} />
          <FormControlLabel control={<Checkbox checked={confirmed} disabled={!canConfirm} onChange={e => setConfirmed(e.target.checked)} />} label="강조 위치의 원문과 추출 문구가 일치하는지 직접 확인했습니다." />
          <Button variant="contained" onClick={saveNote} disabled={!canConfirm || !confirmed || !question.trim()}>원문 확인 메모 추가</Button><Button disabled={!notes.length || busy} onClick={()=>setPane("agent")}>확인한 문구로 에이전트 검토</Button><p>문구의 임상적 의미·정확성·적용 가능성을 승인하는 기능이 아닙니다.</p>
        </div>
      </section></div><div hidden={pane === "design"}><PagePreview loaded={loaded} page={page} selected={selected} onReady={setReadyPage} /></div></div>
      <section className="pdf-notes"><div className="pdf-pane-title"><h2>원문 확인 메모 {notes.length}개</h2><div><Button disabled={!notes.length} startIcon={<ArrowDownToLine size={16} />} onClick={() => downloadText("trialboard-pdf-evidence.md", evidenceMarkdown(source, notes), "text/markdown;charset=utf-8")}>Markdown</Button><Button disabled={!notes.length} onClick={() => downloadText("trialboard-pdf-evidence.json", JSON.stringify(evidenceExport(source, notes), null, 2), "application/json")}>추출 원문 포함 JSON</Button></div></div>
        {!notes.length && <p>원문을 직접 확인한 문구만 여기에 남깁니다. CSV 규칙 검사나 가정 실험에는 아직 전달하지 않습니다.</p>}
        {notes.map(note => <article key={note.spanId}><div><strong>{note.question}</strong><p>{note.quote}</p><p className="pdf-caption">{note.comment || "추가 메모 없음"}</p></div><Button disabled={busy} onClick={() => { const span = source.pages[note.page - 1].spans.find(s => s.id === note.spanId); if (span) { setPane("text"); choose(span); setQuestion(note.question); setComment(note.comment); } }}>원문 p.{note.page}</Button><Button aria-label={`${note.spanId} 메모 삭제`} onClick={() => setNotes(list => list.filter(n => n.spanId !== note.spanId))}><Trash2 size={16} /></Button></article>)}
        <p className="hash">원본 PDF SHA-256 {source.sha256}</p><p className="pdf-caption">{source.extractor} · 인증되지 않은 사용자 확인 · 명시적 프로젝트 저장 전에는 브라우저 메모리만 사용. JSON에는 추출 문구 전체가 포함되니 공유 범위를 확인하세요.</p>
      </section>
    </>}
    </div>
  </div>;
}
