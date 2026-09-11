import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, CircularProgress, FormControlLabel, Radio, RadioGroup } from "@mui/material";
import { ArrowDownToLine, ArrowRight, Check, FileSpreadsheet, FileText, FolderOpen, Upload, X } from "lucide-react";
import { downloadText } from "./review";
import { EXAMPLE, HEADERS, MAX_BYTES, QUESTIONS, numeric, metricLabel, intakeMarkdown, prepareTable, reviewTable,
  type IntakeReport, type Question, type Table } from "./intake";
import "./intake.css";

export function Intake({ onEvidence }: { onEvidence: () => void }) {
  const [table, setTable] = useState<Table | null>(null);
  const [question, setQuestion] = useState<Question>("compare");
  const [confirmed, setConfirmed] = useState(false);
  const [report, setReport] = useState<IntakeReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState<number[]>([]);
  const [dragging, setDragging] = useState(false);
  const source = useRef<HTMLDivElement>(null);
  const resultSection = useRef<HTMLElement>(null);
  useEffect(() => { if (report) resultSection.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [report]);
  const sequence = useRef(0);
  async function accept(text: string, name: string, origin: Table["origin"]) {
    const ticket = ++sequence.current;
    setBusy(true); setError("");
    try {
      const next = await prepareTable(text, name, origin);
      if (ticket !== sequence.current) return;
      setTable(next); setReport(null); setConfirmed(false); setHighlight([]);
    } catch (e) { if (ticket === sequence.current) setError(e instanceof Error ? e.message : "파일을 읽지 못했습니다."); }
    finally { if (ticket === sequence.current) setBusy(false); }
  }
  async function openFile(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { setError("현재는 양식에 맞춘 UTF-8 CSV만 지원합니다. PDF·HWPX 문서 읽기는 아직 지원하지 않습니다."); return; }
    if (file.size > MAX_BYTES) { setError("256 KB 이하의 CSV를 선택해 주세요."); return; }
    const ticket = ++sequence.current; setBusy(true); setError("");
    try {
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      if (ticket !== sequence.current) return;
      await accept(text, file.name, "user_file");
    } catch { if (ticket === sequence.current) { setError("UTF-8 텍스트를 읽을 수 없습니다. UTF-8 CSV로 다시 저장해 주세요."); setBusy(false); } }
  }
  function clear() {
    sequence.current++; setBusy(false); setTable(null); setReport(null); setConfirmed(false); setError(""); setHighlight([]);
  }
  function showLines(lines: number[]) {
    setHighlight(lines);
    requestAnimationFrame(() => document.getElementById(`intake-row-${lines[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }
  function exportResult() {
    if (!table || !report) return;
    downloadText("trialboard-table-review.json", JSON.stringify({
      report, source: { name: table.name, origin: table.origin, sha256: table.digest, text: table.text },
      confirmedByUser: true, persisted: false, execution: "browser_deterministic_rules",
    }, null, 2), "application/json");
  }
  return <div className="intake">
    <div className="intake-heading"><span className="document-kicker">자료 검토</span><h1>{report ? "다음 판단 전에 확인할 것" : "검토할 자료부터 시작하세요"}</h1><p>{report ? "제출한 표에서 확인한 사실과, 아직 판단할 수 없는 부분을 구분했습니다." : "용량별 요약표를 넣고 질문을 고르면, 불일치와 빠진 항목을 원래 행과 함께 확인합니다."}</p></div>
    <div className="intake-steps" aria-label="검토 순서"><span className={table ? "complete" : "current"}><i>{table ? <Check size={13} /> : "1"}</i>자료 넣기</span><ArrowRight size={14} /><span className={table && !report ? "current" : report ? "complete" : ""}><i>2</i>내용·질문 확인</span><ArrowRight size={14} /><span className={report ? "current" : ""}><i>3</i>검토 기록</span></div>
    <div className="intake-columns"><section className="intake-main">
      <div className="intake-section-head"><h2>검토 자료</h2><span>용량별 집계표 1개</span></div>
      <div className={`file-drop ${dragging ? "dragging" : ""}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length !== 1) { setError("CSV 파일 한 개를 선택해 주세요."); return; } void openFile(e.dataTransfer.files[0]); }}>
        {table ? <div className="loaded-file"><FileSpreadsheet size={26} strokeWidth={1.5} /><div><strong>{table.name}</strong><p>{table.rows.length}개 행 · {new Set(table.rows.map(r => r.dose)).size}개 용량 · {table.origin === "synthetic_example" ? "합성 예제" : "사용자 파일 / 진위 미검증"}</p></div><Button aria-label="현재 자료 제거" onClick={clear} disabled={busy}><X size={17} /></Button></div> : <><span className="upload-symbol"><Upload size={25} strokeWidth={1.5} /></span><h3>용량별 요약표를 가져오세요</h3><p>파일을 여기에 놓거나 선택하세요.</p></>}
        <div className="file-actions"><Button variant={table ? "outlined" : "contained"} component="label" disabled={busy} startIcon={busy ? <CircularProgress size={15} /> : <FolderOpen size={16} />}>{table ? "파일 바꾸기" : "CSV 선택"}<input className="file-input" type="file" accept=".csv,text/csv" onChange={e => { void openFile(e.target.files?.[0]); e.target.value = ""; }} /></Button>{!table && <Button variant="outlined" onClick={() => void accept(EXAMPLE, "합성_용량비교_예제.csv", "synthetic_example")} disabled={busy}>예제로 시작</Button>}</div>
        <span className="file-format">UTF-8 CSV · 최대 256 KB / 500행 · PDF·HWPX 미지원</span>
      </div>
      <div aria-live="polite">{error && <Alert severity="error" className="intake-error">{error}{table && " 기존에 읽은 자료는 유지됩니다."}</Alert>}</div>
      <div className="privacy-note"><span>파일은 이 탭 안에서만 처리하며 서버에 보내거나 저장하지 않습니다.</span><span>새로고침하면 사라집니다. 환자별 정보·식별정보는 넣지 마세요.</span></div>
      <details className="format-help"><summary>어떤 자료를 넣으면 되나요? <span>양식과 항목 보기</span></summary><p>한 후보물질·적응증·시험의 용량별 집계를 준비하세요. 비율을 추측해서 넣는 대신, 사건 수와 실제 평가 분모를 입력합니다.</p><dl><div><dt>asset / indication / study</dt><dd>후보물질 / 적응증 / 시험 식별자</dd></div><div><dt>dose / metric</dt><dd>용량·투여 일정 / response, adverse_event, dose_reduction, discontinuation</dd></div><div><dt>events / total</dt><dd>사건 수 / 해당 항목의 평가 분모</dd></div><div><dt>population / window / definition</dt><dd>평가집단 / 관찰기간 / 평가 정의</dd></div></dl><Button startIcon={<ArrowDownToLine size={15} />} onClick={() => downloadText("trialboard-template.csv", HEADERS.join(",") + "\n", "text/csv;charset=utf-8")}>빈 양식 받기</Button></details>
      {table && <div className="source-preview" ref={source}><div className="intake-section-head"><h2>읽어 온 내용</h2><span>원본 행 번호 기준</span></div><div className="intake-table"><table><caption className="sr-only">제출한 CSV 요약. 비율은 유효한 정수에서만 계산합니다.</caption><thead><tr><th>행</th><th>용량</th><th>항목</th><th>사건 / 분모</th><th>관찰기간</th></tr></thead><tbody>{table.rows.map(row => <tr key={row.line} id={`intake-row-${row.line}`} className={highlight.includes(row.line) ? "source-highlight" : ""}><td>{row.line}</td><td>{row.dose || "미입력"}</td><td>{metricLabel(row.metric)}</td><td>{row.events || "—"} / {row.total || "—"}{!numeric(row) && <span className="invalid-cell">확인 필요</span>}</td><td>{row.window || "미입력"}</td></tr>)}</tbody></table></div>
        <details className="raw-source" open={highlight.length > 0}><summary>{highlight.length ? "선택한 쟁점의 원본 행" : "전체 원문·출처 확인"}</summary>{table.rows.filter(r => !highlight.length || highlight.includes(r.line)).map(r => <div key={r.line}><span>{r.line}행 · {r.population} · {r.definition}</span><pre>{r.raw}</pre></div>)}<p className="hash">UTF-8 원문 SHA-256 {table.digest}</p>{highlight.length > 0 && <Button onClick={() => setHighlight([])}>전체 원문 보기</Button>}</details>
        <FormControlLabel className="confirm-input" control={<Checkbox checked={confirmed} onChange={e => { setConfirmed(e.target.checked); setReport(null); }} />} label="읽어 온 용량·항목·분모를 확인했습니다." />
      </div>}
    </section>
    <aside className="question-panel"><span className="document-kicker">이번에 확인할 질문</span><h2>무엇을 검토할까요?</h2><RadioGroup value={question} onChange={e => { setQuestion(e.target.value as Question); setReport(null); setHighlight([]); }} aria-label="검토 질문">{QUESTIONS.map(q => <label className={`question-choice ${question === q.id ? "selected" : ""}`} key={q.id}><Radio value={q.id} size="small" /><span><strong>{q.title}</strong><span>{q.description}</span></span></label>)}</RadioGroup>
      <Button fullWidth variant="contained" size="large" disabled={!table || !confirmed || busy} onClick={() => { if (table && confirmed) { setReport(reviewTable(table, question)); setHighlight([]); } }} endIcon={<ArrowRight size={17} />}>자료 검토하기</Button><p className="run-hint">{!table ? "자료를 넣거나 예제로 시작하세요." : !confirmed ? "왼쪽에서 읽어 온 내용을 먼저 확인해 주세요." : "제출한 표를 규칙으로 점검합니다. AI의 임상 판단이 아닙니다."}</p>
      <div className="output-explanation"><FileText size={19} /><div><strong>검토 후 받는 것</strong><p>확인할 쟁점, 해당 원본 행, 추가 자료 요청을 한 장의 기록으로 받습니다.</p></div></div>
    </aside></div>
    {report && table && <section ref={resultSection} className="intake-result" aria-live="polite"><div className="intake-result-header"><div><span className="document-kicker">검토 기록 · 규칙 기반</span><h2>{report.findings.length ? `추가 확인이 필요한 항목 ${report.findings.length}개` : "설정된 표 점검에서 불일치를 찾지 못했습니다"}</h2><p>{QUESTIONS.find(q => q.id === report.question)?.title}</p></div><div className="intake-exports"><Button variant="outlined" startIcon={<ArrowDownToLine size={16} />} onClick={() => downloadText("trialboard-review.md", intakeMarkdown(table, report), "text/markdown;charset=utf-8")}>검토 문서 받기</Button><Button onClick={exportResult}>원문 포함 JSON</Button></div></div>
      {table.origin === "synthetic_example" && <p className="example-note">합성 예제입니다. 용량 A의 반응 관찰기간은 12주, B는 8주로 일부러 다르게 넣었습니다.</p>}
      <div className="findings">{report.findings.map((f, i) => <article key={f.id}><span className="finding-index">{String(i + 1).padStart(2, "0")}</span><div><span className={`finding-type ${f.level}`}>{f.level === "issue" ? "확인 필요" : "미제공"}</span><h3>{f.title}</h3><p>{f.reason}</p><div className="next-action"><strong>다음 행동</strong><span>{f.action}</span></div><footer><span>확인 담당 제안 · {f.owner}</span>{f.lines.length > 0 ? <Button size="small" onClick={() => showLines(f.lines)}>원본 {f.lines.slice(0, 5).join(", ")}{f.lines.length > 5 ? " 외" : ""}행 보기 <ArrowRight size={14} /></Button> : <span>해당 행 없음</span>}</footer></div></article>)}</div>
      <div className="unassessed"><h3>아직 평가하지 않은 것</h3><p>표에 오류가 없더라도 실제 용량 선택이나 시험 설계가 정당화되는 것은 아닙니다.</p><ul>{report.notAssessed.map(item => <li key={item}>{item}</li>)}</ul><Button onClick={onEvidence}>별도의 FDA 공개 참고 근거 보기 <ArrowRight size={15} /></Button></div>
      <p className="record-boundary">외부 원문 대조·의미 추출·LLM·투여 권고는 수행하지 않았습니다. 검토 기록은 서버에 보관되지 않습니다.</p>
    </section>}
  </div>;
}
