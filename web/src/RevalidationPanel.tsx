import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Chip, Tab, Tabs } from "@mui/material";
import { FileInput } from "lucide-react";
import { FIELD_LABELS, type FieldName, type FieldReview } from "./field-review";
import type { PdfSource } from "./pdf-contract";
import { findingLabel, findingTargets, isCurrent, readResult, reviewKey, RESULT_BYTES, type RevalidationResult } from "./revalidation-result";
import "./revalidation.css";

type View = "current" | "added" | "no_longer_emitted" | "unchanged";
export default function RevalidationPanel({ review, source, disabled, hasDraft, onSelect }: {
  review: FieldReview; source: PdfSource; disabled: boolean; hasDraft: boolean;
  onSelect: (rowId: string, field: FieldName | null) => void;
}) {
  const [result, setResult] = useState<RevalidationResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>("current");
  const ticket = useRef(0);
  const key = useMemo(() => reviewKey(review, source), [review, source]);
  useEffect(() => { ticket.current++; setLoading(false); setError(""); return () => { ticket.current++; }; }, [key, source]);
  const current = useMemo(() => result ? isCurrent(result, review, source, hasDraft) : false, [result, review, source, hasDraft]);
  async function load(file?: File) {
    if (!file || disabled || loading || hasDraft) return;
    const id = ++ticket.current; setLoading(true); setError("");
    try {
      if (file.size > RESULT_BYTES) throw new Error("재검증 JSON은 8 MiB 이하만 지원합니다.");
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const next = readResult(raw, review, source);
      if (id !== ticket.current) return;
      setResult(next); setView("current");
    } catch (e) {
      if (id === ticket.current) setError((e instanceof Error ? e.message : "결과를 읽지 못했습니다.") + (result ? " 이전 결과는 유지됩니다." : ""));
    } finally { if (id === ticket.current) setLoading(false); }
  }
  const findings = result ? view === "current" ? result.findings : result.delta[view] : [];
  return <section className="revalidation" aria-label="수정 후 재검증 결과">
    <div className="field-title"><div><h2>수정 후 재검증</h2><p>로컬에서 다시 검사한 결과를 현재 검토와 대조합니다.</p></div>
      <Button component="label" variant="outlined" startIcon={<FileInput size={16} />} disabled={disabled || loading || hasDraft || !review.rows.length}>
        재검증 결과 불러오기<input className="file-input" type="file" accept=".json,application/json" onChange={e => { void load(e.target.files?.[0]); e.target.value = ""; }} />
      </Button></div>
    <details className="field-help"><summary>재검증 결과는 어떻게 준비하나요?</summary><p>원문 확인 메모의 ‘추출 원문 포함 JSON’, 필드 검토의 ‘이력 JSON’, 원본 PDF로 로컬 재검증을 실행한 뒤 생성된 report.json을 선택하세요. 에이전트 결과를 가져왔다면 그 원래 파일도 필요합니다.</p><p>새로고침했다면 같은 PDF를 열고 ‘저장한 검토 이어하기’로 당시 이력 JSON을 복구한 다음 결과를 불러오세요. 결과 파일만으로 검토 내용을 복원하거나 덮어쓰지 않습니다. 이 화면에서 Python·AI를 실행하거나 파일을 서버로 보내지 않습니다.</p></details>
    <div aria-live="polite">{loading && <p role="status">현재 PDF와 검토 이력을 대조하는 중…</p>}{error && <Alert severity="error">{error}</Alert>}</div>
    {hasDraft && <Alert severity="info">기록하지 않은 편집이 있습니다. 확인·수정·보류를 기록하거나 편집을 취소한 뒤 결과를 확인하세요.</Alert>}
    {result && !current && <Alert severity="warning">검토 이력이 바뀌었거나 미기록 편집이 있어 이전 결과를 현재 결과로 표시하지 않습니다. 현재 이력을 내려받아 다시 재검증하세요.</Alert>}
    {!result && !loading && <p className="revalidation-empty">아직 불러온 재검증 결과가 없습니다. 미확인·보류 자료는 재검증에서 제외됩니다.</p>}
    {result && current && <>
      <Alert severity="info">현재 PDF·검토 내용과 일치합니다. 파일 내부 일관성을 확인한 것이며 실행 진위·규칙의 정확성·임상 승인을 인증하지 않습니다.</Alert>
      <p className="revalidation-context"><strong>실행 시 지정한 시험:</strong> {result.study}<br /><strong>질문:</strong> {result.question}</p>
      <div className="revalidation-counts"><Chip label={`남은 관측값 ${result.acceptedIds.length}개 · 미승인`} /><Chip label={`보류로 제외 ${result.excludedIds.length}개`} /><Chip label={`현재 쟁점 ${result.findings.length}개`} /></div>
      <Tabs value={view} onChange={(_, value: View) => setView(value)} variant="scrollable" scrollButtons="auto" aria-label="재검증 쟁점 구분">
        <Tab value="current" label={`현재 ${result.findings.length}`} /><Tab value="added" label={`추가 ${result.delta.added.length}`} />
        <Tab value="no_longer_emitted" label={`미발생 ${result.delta.no_longer_emitted.length}`} /><Tab value="unchanged" label={`유지 ${result.delta.unchanged.length}`} />
      </Tabs>
      {view === "no_longer_emitted" && <Alert severity="warning">쟁점이 더 이상 발생하지 않아도 해결된 것은 아닙니다. 보류로 자료가 제외되어 검사 대상이 줄었을 수도 있습니다.</Alert>}
      <div className="revalidation-findings" role="region" aria-label="선택한 쟁점 목록" tabIndex={0}>
        {!findings.length && <p>{view === "current" ? "현재 규칙에서 보고한 쟁점이 없습니다. 임상적 정확성·비교 가능성을 확인한 것은 아닙니다." : "이 구분에 해당하는 쟁점이 없습니다."}</p>}
        {findings.map((f, i) => <article key={`${view}-${i}`}><h3>{findingLabel(f.code)}</h3>
          <p>{f.observation_id ? `관측값 ${review.rows.findIndex(r => r.id === f.observation_id) + 1}` : "전체 자료 또는 관측값 간 비교"}{f.field && ` · ${FIELD_LABELS[f.field]}`}</p>
          {f.detail && <p>{f.detail}</p>}
          {!f.observation_id && <p className="revalidation-meta">단일 인용 위치가 없는 쟁점입니다. 관련 관측값의 문맥을 함께 확인하세요.</p>}
          <div className="field-toolbar">{findingTargets(f, review).map(t => <Button key={t.rowId} size="small" disabled={disabled || hasDraft} onClick={() => onSelect(t.rowId, t.field)}>
            관측값 {review.rows.findIndex(r => r.id === t.rowId) + 1}{t.field ? ` · ${FIELD_LABELS[t.field]}` : " 살펴보기"}
          </Button>)}</div><small>{f.code}</small>
        </article>)}
      </div>
      <details className="field-help"><summary>남은 관측값과 제외 내역</summary>{review.rows.map((row, i) => <p key={row.id}>
        {i + 1}. {row.fields.dose.current.value ?? "용량 미보고"} · {result.acceptedIds.includes(row.id) ? "규칙 검사 후 남음 · 비교 미승인" : result.excludedIds.includes(row.id) ? "사용자 보류로 제외" : "미확인 또는 규칙 쟁점으로 남지 않음"}
      </p>)}</details>
      <p className="revalidation-meta">원래 값과 현재 값을 동일한 규칙으로 비교한 기록입니다. AI 반론은 재실행하지 않았고, 이전 AI 쟁점은 아래 별도 기록으로 유지합니다.</p>
      <details className="field-help"><summary>결과 식별 정보</summary><p>실행: {result.runId}</p><p>규칙 코드 hash: {result.rulesDigest}</p><p>규칙 버전의 최신 여부나 파일 서명을 인증하지 않습니다.</p></details>
    </>}
  </section>;
}
