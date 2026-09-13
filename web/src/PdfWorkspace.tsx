import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, CircularProgress, FormControlLabel, TextField } from "@mui/material";
import { ArrowDownToLine, ChevronLeft, ChevronRight, FileText, Trash2, Upload } from "lucide-react";
import type { RenderTask } from "pdfjs-dist";
import { openPdf, type LoadedPdf } from "./pdf-loader";
import { attestSpan, evidenceExport, evidenceMarkdown, PDF_LIMITS, type EvidenceNote, type PdfSpan } from "./pdf-contract";
import { downloadText } from "./review";
import "./pdf.css";
import FieldReviewPanel from "./FieldReviewPanel";

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

export default function PdfWorkspace() {
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
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
  const [notes, setNotes] = useState<EvidenceNote[]>([]);
  const [notice, setNotice] = useState("");
  const [pane, setPane] = useState<"text" | "fields">("text");
  useEffect(() => () => { pending.current?.abort(); void current.current?.destroy().catch(() => {}); }, []);

  async function accept(file?: File) {
    if (!file || pending.current) return;
    if (current.current && !window.confirm("PDF를 바꾸면 현재 메모와 필드 검토가 초기화됩니다. 필요한 기록을 내려받았나요?")) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setProgress(0); setError(""); setNotice("");
    try {
      const next = await openPdf(file, controller.signal, n => { if (pending.current === controller) setProgress(n); });
      if (pending.current !== controller || controller.signal.aborted) { void next.destroy(); return; }
      const old = current.current; current.current = next;
      setLoaded(next); setPage(1); setReadyPage(null); setSelected(null); setQuery(""); setNotes([]); setConfirmed(false); setComment("");
      if (old) void old.destroy().catch(() => {});
    } catch (e) {
      if (pending.current === controller && !controller.signal.aborted) setError(e instanceof Error ? e.message : "PDF를 읽지 못했습니다.");
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }
  function cancel() { pending.current?.abort(); pending.current = null; setBusy(false); setNotice("읽기를 취소했습니다. 기존 자료와 메모는 유지됩니다."); }
  function clear() {
    if (current.current && !window.confirm("이 브라우저의 PDF·메모·필드 검토를 제거할까요? 내려받지 않은 기록은 복구할 수 없습니다. 원본 파일은 삭제하지 않습니다.")) return;
    cancel(); void current.current?.destroy().catch(() => {}); current.current = null;
    setLoaded(null); setNotes([]); setSelected(null); setConfirmed(false); setError(""); setNotice(""); setReadyPage(null);
  }
  function choose(span: PdfSpan) {
    if (span.page !== page) setReadyPage(null);
    setPage(span.page); setSelected(span); setConfirmed(false); setComment(""); setNotice("");
  }
  function changePage(next: number) { setPage(next); setReadyPage(null); setSelected(null); setConfirmed(false); }
  function saveNote() {
    if (!loaded || !selected || readyPage !== selected.page) return;
    try {
      const note = attestSpan(loaded.source, selected.id, question, comment, confirmed);
      if (notes.length >= PDF_LIMITS.notes && !notes.some(n => n.spanId === note.spanId)) throw new Error("문서당 메모는 100개까지 지원합니다.");
      setNotes(list => [...list.filter(n => n.spanId !== note.spanId), note]);
      setConfirmed(false); setError(""); setNotice("원문 확인 메모를 추가했습니다. 같은 문구를 다시 저장하면 해당 메모가 갱신됩니다.");
    } catch (e) { setError(e instanceof Error ? e.message : "메모를 저장하지 못했습니다."); }
  }
  const source = loaded?.source;
  const visible = source?.pages[page - 1].spans.filter(s => s.text.toLowerCase().includes(query.toLowerCase())) ?? [];
  const canConfirm = selected?.box && readyPage === selected.page && !busy;
  return <div className="pdf-workspace">
    <div className="intake-heading"><span className="document-kicker">PDF 근거 검토 · 로컬 처리</span><h1>원문과 값을 나란히 확인하세요</h1><p>문구를 찾아 필드에 연결하거나, 같은 PDF의 추출 결과를 불러와 확인·수정·보류합니다. 이 화면은 AI를 호출하지 않습니다.</p></div>
    <div className="pdf-file-bar"><FileText size={26} /><div><strong>{source?.name ?? "공개·사용 허가된 PDF 한 개"}</strong><p>{source ? `${source.pages.length}페이지 · 원문 메모 ${notes.length}개 · 파일 교체 시 메모·필드 검토 초기화` : "최대 5 MB · 40페이지 · 스캔 OCR·암호 PDF·HWPX 미지원"}</p></div>
      <Button variant="contained" component="label" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <Upload size={16} />} disabled={busy}>{source ? "PDF 바꾸기" : "PDF 선택"}<input className="file-input" type="file" accept=".pdf,application/pdf" onChange={e => { void accept(e.target.files?.[0]); e.target.value = ""; }} /></Button>
      {busy ? <Button onClick={cancel}>읽기 취소</Button> : source && <Button onClick={clear} aria-label="PDF와 메모·필드 검토 제거"><Trash2 size={17} /></Button>}
    </div>
    <p className="pdf-privacy">PDF 내용은 이 브라우저에서만 처리합니다. 서버 전송·자동 저장은 없습니다. 새로고침·제거하면 사라집니다. 환자 식별정보나 기업 기밀자료는 넣지 마세요.</p>
    <div aria-live="polite">{busy && <p role="status">PDF 읽는 중 · {progress}페이지 추출 완료</p>}{error && <Alert severity="error">{error}{source && " 기존 자료는 유지됩니다."}</Alert>}{notice && <Alert severity="info">{notice}</Alert>}</div>
    {!source && <div className="pdf-start"><h2>이번 단계에서 할 수 있는 것</h2><ol><li>공개 문서 PDF를 선택합니다.</li><li>페이지별 추출 문구를 눌러 원문 강조 위치를 확인합니다.</li><li>‘필드 검토’에서 관측값을 만들거나 같은 PDF의 에이전트 결과를 불러옵니다.</li><li>용량·분모·집단 등의 값을 원문에 연결하고 확인·수정·보류 사유를 기록합니다.</li><li>원문 메모와 필드 검토 이력을 각각 내려받습니다.</li></ol><p>표의 열·분모·관찰기간은 자동 연결하지 않습니다. 글자가 추출되지 않은 페이지는 “텍스트 없음”으로 남깁니다.</p><a href="https://www.accessdata.fda.gov/drugsatfda_docs/appletter/2021/214665Orig1s000ltr.pdf" target="_blank" rel="noreferrer">FDA 공개 승인서한 열기 → 내려받은 파일로 시작</a></div>}
    {source && loaded && <>
      {source.status !== "TEXT_EXTRACTED" && <Alert severity="warning">{source.status === "NO_TEXT" ? "추출 가능한 텍스트가 없습니다. 스캔·이미지 문서 또는 빈 페이지일 수 있습니다. OCR을 수행하지 않았습니다." : "일부 페이지에 추출 가능한 텍스트가 없습니다. 나머지 문구가 문서 전체를 대표하지 않습니다."}</Alert>}
      <div className="pdf-page-bar"><Button onClick={() => changePage(page - 1)} disabled={page === 1 || busy} startIcon={<ChevronLeft size={16} />}>이전</Button><span>PDF {page} / {source.pages.length}페이지 · 인쇄된 쪽수와 다를 수 있음</span><Button onClick={() => changePage(page + 1)} disabled={page === source.pages.length || busy} endIcon={<ChevronRight size={16} />}>다음</Button></div>
      <div className="field-tabs" role="group" aria-label="검토 방식"><Button variant={pane === "text" ? "contained" : "outlined"} onClick={() => setPane("text")}>원문 문구</Button><Button variant={pane === "fields" ? "contained" : "outlined"} onClick={() => setPane("fields")}>필드 검토</Button></div>
      <div className="pdf-review-grid"><div><section hidden={pane !== "fields"} className="pdf-extracted"><FieldReviewPanel key={source.sha256} source={source} selected={selected} readyPage={readyPage} disabled={busy} onChoose={choose} onText={() => setPane("text")} /></section><section hidden={pane !== "text"} className="pdf-extracted" aria-label="페이지 추출 문구"><div className="pdf-pane-title"><strong>추출 문구</strong><span>읽기 순서·표 관계 미검증</span></div>
        <TextField fullWidth size="small" label="현재 페이지에서 찾기" value={query} onChange={e => setQuery(e.target.value)} />
        <div className="pdf-span-list">{visible.slice(0, 200).map(span => <button key={span.id} type="button" disabled={busy} onClick={() => choose(span)} aria-pressed={selected?.id === span.id}><span>{span.text}</span><small>{span.id}{!span.box && " · 위치 확인 불가"}{notes.some(n => n.spanId === span.id) && " · 메모 있음"}</small></button>)}
          {!visible.length && <p>{source.pages[page - 1].status === "NO_TEXT" ? "이 페이지에서 텍스트를 추출하지 못했습니다. 내용을 없다고 판단하지 마세요." : "검색한 문구가 없습니다."}</p>}
          {visible.length > 200 && <p>앞의 200개 문구를 표시합니다. 검색어로 범위를 좁혀 주세요.</p>}
        </div>
        <div className="pdf-attest"><h2>선택한 문구의 확인 메모</h2>{selected ? <blockquote>{selected.text}</blockquote> : <p>위 목록에서 확인할 문구를 선택하세요.</p>}
          <TextField fullWidth multiline minRows={2} label="검토 질문" value={question} onChange={e => { setQuestion(e.target.value); setConfirmed(false); }} slotProps={{ htmlInput: { maxLength: 500 } }} />
          <TextField fullWidth multiline minRows={2} label="메모 · 적용 범위와 추가 확인할 점" value={comment} onChange={e => { setComment(e.target.value); setConfirmed(false); }} slotProps={{ htmlInput: { maxLength: 2000 } }} />
          <FormControlLabel control={<Checkbox checked={confirmed} disabled={!canConfirm} onChange={e => setConfirmed(e.target.checked)} />} label="강조 위치의 원문과 추출 문구가 일치하는지 직접 확인했습니다." />
          <Button variant="contained" onClick={saveNote} disabled={!canConfirm || !confirmed || !question.trim()}>원문 확인 메모 추가</Button><p>문구의 임상적 의미·정확성·적용 가능성을 승인하는 기능이 아닙니다.</p>
        </div>
      </section></div><PagePreview loaded={loaded} page={page} selected={selected} onReady={setReadyPage} /></div>
      <section className="pdf-notes"><div className="pdf-pane-title"><h2>원문 확인 메모 {notes.length}개</h2><div><Button disabled={!notes.length} startIcon={<ArrowDownToLine size={16} />} onClick={() => downloadText("trialboard-pdf-evidence.md", evidenceMarkdown(source, notes), "text/markdown;charset=utf-8")}>Markdown</Button><Button disabled={!notes.length} onClick={() => downloadText("trialboard-pdf-evidence.json", JSON.stringify(evidenceExport(source, notes), null, 2), "application/json")}>추출 원문 포함 JSON</Button></div></div>
        {!notes.length && <p>원문을 직접 확인한 문구만 여기에 남깁니다. CSV 규칙 검사나 가정 실험에는 아직 전달하지 않습니다.</p>}
        {notes.map(note => <article key={note.spanId}><div><strong>{note.question}</strong><p>{note.quote}</p><p className="pdf-caption">{note.comment || "추가 메모 없음"}</p></div><Button disabled={busy} onClick={() => { const span = source.pages[note.page - 1].spans.find(s => s.id === note.spanId); if (span) { choose(span); setQuestion(note.question); setComment(note.comment); } }}>원문 p.{note.page}</Button><Button aria-label={`${note.spanId} 메모 삭제`} onClick={() => setNotes(list => list.filter(n => n.spanId !== note.spanId))}><Trash2 size={16} /></Button></article>)}
        <p className="hash">원본 PDF SHA-256 {source.sha256}</p><p className="pdf-caption">{source.extractor} · 인증되지 않은 사용자 확인 · 브라우저 메모리만 사용. JSON에는 추출 문구 전체가 포함되니 공유 범위를 확인하세요.</p>
      </section>
    </>}
  </div>;
}
