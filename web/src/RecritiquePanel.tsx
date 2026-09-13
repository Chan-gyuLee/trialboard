import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Chip } from "@mui/material";
import { FileInput } from "lucide-react";
import type { FieldReview } from "./field-review";
import type { PdfSource, PdfSpan } from "./pdf-contract";
import { concernSpans, isRecritiqueCurrent, readRecritique, type RecritiqueResult } from "./recritique-result";
import { reviewKey, RESULT_BYTES } from "./revalidation-result";
import "./revalidation.css";

const STATUS = { COMPLETED: "AI 응답 수신 · 미승인", NO_CANDIDATES: "검토 대상 없음 · 호출 안 함", FAILED: "실행 실패", BUDGET_EXCEEDED: "예산 제한으로 중단" };
const ERRORS: Record<string, string> = { RECRITIQUE_TIMEOUT: "응답 대기 시간 초과", INVALID_CRITIQUE_SCHEMA: "응답 형식 불일치", INVALID_CRITIQUE_REFERENCE: "응답의 관측값·원문 참조 불일치", MODEL_REQUEST_FAILED: "모델 요청 실패", REQUEST_RESERVATION_EXCEEDED: "호출 전 예약 예산 부족", REPORTED_TOKEN_BUDGET_EXCEEDED: "응답에서 보고한 사용량이 예산 초과" };

export default function RecritiquePanel({ review, source, disabled, hasDraft, onSelectRow, onChoose }: {
  review: FieldReview; source: PdfSource; disabled: boolean; hasDraft: boolean;
  onSelectRow: (id: string) => void; onChoose: (span: PdfSpan) => void;
}) {
  const [result, setResult] = useState<RecritiqueResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const ticket = useRef(0);
  const key = useMemo(() => reviewKey(review, source), [review, source]);
  useEffect(() => { ticket.current++; setLoading(false); setError(""); return () => { ticket.current++; }; }, [key, source, hasDraft]);
  const current = result !== null && isRecritiqueCurrent(result, review, source, hasDraft);
  const locked = disabled || hasDraft || loading;
  async function load(file?: File) {
    if (!file || locked) return;
    const generation = ++ticket.current; setLoading(true); setError("");
    try {
      if (file.size > RESULT_BYTES) throw new Error("AI 재검토 JSON은 8 MiB 이하만 지원합니다.");
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const next = await readRecritique(raw, review, source);
      if (generation === ticket.current) setResult(next);
    } catch (e) {
      if (generation === ticket.current) setError((e instanceof Error ? e.message : "결과를 읽지 못했습니다.") + " 현재 검토와 이전 결과는 바꾸지 않았습니다.");
    } finally { if (generation === ticket.current) setLoading(false); }
  }
  const rowLabel = (id: string) => `관측값 ${review.rows.findIndex(r => r.id === id) + 1}`;
  return <section className="revalidation" aria-label="수정 후 AI 재검토 결과">
    <div className="field-title"><div><h2>수정 후 AI 의견</h2><p>사용자 판단·규칙 검사와 구분해서 살펴보세요.</p></div>
      <Button component="label" variant="outlined" startIcon={<FileInput size={16} />} disabled={locked || !review.rows.length}>
        AI 재검토 결과 불러오기<input className="file-input" type="file" accept=".json,application/json" onChange={e => { void load(e.target.files?.[0]); e.target.value = ""; }} />
      </Button></div>
    <details className="field-help"><summary>어떤 파일을 불러오나요?</summary><p>이력 JSON·추출 원문 포함 JSON·원본 PDF로 로컬 AI 재검토를 실행한 뒤 output/recritique의 report.json을 선택하세요. 에이전트에서 시작한 검토는 원래 에이전트 결과 파일도 필요합니다. 새로고침했다면 같은 PDF와 저장한 이력부터 복구하세요.</p><p>이 버튼은 결과 파일을 읽기만 합니다. AI 실행·업로드·사용자 값 변경은 하지 않습니다. 규칙 재검증 파일과 새 AI 재검토 파일은 서로 다릅니다.</p></details>
    <div aria-live="polite">{loading && <p role="status">PDF·검토 버전·AI 의견을 대조하는 중…</p>}{error && <Alert severity="error">{error}</Alert>}</div>
    {hasDraft && <Alert severity="info">미기록 편집을 기록하거나 취소한 뒤 AI 결과를 확인하세요.</Alert>}
    {result && !current && <Alert severity="warning">검토 이력이 달라졌거나 미기록 편집이 있어 이전 AI 의견을 숨겼습니다. 현재 이력으로 다시 실행한 결과를 불러오세요.</Alert>}
    {!result && !loading && <p className="revalidation-empty">아직 불러온 새 AI 의견이 없습니다. 이전 모델 의견은 아래 별도 기록으로 남아 있습니다.</p>}
    {result && current && <>
      <Alert severity={result.mode === "SCRIPTED_TEST_DOUBLE" ? "warning" : "info"}>{result.mode === "SCRIPTED_TEST_DOUBLE" ? "스크립트 테스트 결과 · 실제 AI 실행 아님." : "파일에 기록된 Codex 재검토 결과 · 실행 진위 미인증."} 현재 PDF·검토와 파일 내부 일관성을 대조했으며, 임상적 정확성·전문가 승인을 인증하지 않습니다.</Alert>
      <p className="revalidation-context"><strong>시험:</strong> {result.rules.study}<br /><strong>질문:</strong> {result.rules.question}</p>
      <Chip label={STATUS[result.status]} />
      {result.status !== "COMPLETED" ? <Alert severity="warning">완료된 새 AI 의견이 없습니다. {result.status === "NO_CANDIDATES" ? "사용자 보류·미확인·규칙 쟁점을 먼저 살펴보세요." : result.errors.map(e => ERRORS[e] ?? e).join(" · ")}</Alert> : <>
        <div className="revalidation-counts"><Chip label={`검토 후보 ${result.candidateIds.length}개`} /><Chip label={`초안 유지 ${result.remainingIds.length}개 · 미승인`} /><Chip label={`AI 의견상 보류 ${result.withheldIds.length}개`} /></div>
        <div className="revalidation-findings" role="region" aria-label="새 AI 쟁점" tabIndex={0}>
          {!result.concerns.length && <p>새 AI가 보고한 쟁점이 없습니다. 과거 쟁점 해결이나 비교 가능성·임상 정확성을 확인한 것은 아닙니다.</p>}
          {result.concerns.map((c, i) => <article key={i}><h3>{c.scope === "observation_error" ? "관측값 오류 의심 · AI 의견상 보류" : "비교 근거의 한계 · 관측값은 초안 유지"}</h3><p>{c.reason}</p>
            <div className="field-toolbar">{[...new Set(c.observation_ids)].map(id => <Button key={id} size="small" disabled={locked} onClick={() => onSelectRow(id)}>{rowLabel(id)} 살펴보기</Button>)}</div>
            <details><summary>AI가 참조한 원문 문구</summary><p>문구 전체 참조입니다. 특정 필드·단어의 근거라고 자동 판단하지 않습니다.</p>
              {concernSpans(c, source).map(span => <div key={span.id}><p>PDF p.{span.page} · {span.id}</p><blockquote>{span.text}</blockquote><Button size="small" disabled={locked || !span.box} onClick={() => onChoose(span)}>p.{span.page} 원문 위치 열기</Button>{!span.box && <p>위치 표시 미지원 · 위 추출 문구를 확인하세요.</p>}</div>)}
            </details>
          </article>)}
        </div>
        {result.questions.length > 0 && <div><h3>추가로 확인할 질문</h3><ol>{result.questions.map((q, i) => <li key={i}>{q}</li>)}</ol></div>}
        <p className="revalidation-meta">AI 의견상 보류는 사용자의 보류 기록과 다릅니다. 사용자 값·사유·이력을 자동 변경하지 않습니다. 같은 모델의 반복 검토는 독립 전문가 평가가 아닙니다.</p>
      </>}
      <details className="field-help"><summary>이 실행의 규칙 검사와 자료 제외</summary><p>규칙 검사 후 후보 {result.rules.acceptedIds.length}개 · 사용자 보류로 제외 {result.rules.excludedIds.length}개 · 규칙 쟁점 {result.rules.findings.length}개. 위의 별도 규칙 결과와 다른 실행일 수 있습니다.</p>
        {review.rows.map(row => <p key={row.id}>{rowLabel(row.id)}: {result.rules.excludedIds.includes(row.id) ? "사용자 보류로 제외" : !result.candidateIds.includes(row.id) ? "미확인 또는 규칙 쟁점으로 제외" : result.status !== "COMPLETED" ? "규칙 후보 · AI 검토 미완료" : result.withheldIds.includes(row.id) ? "AI 의견상 보류 · 사용자 기록은 유지" : "초안 유지 · 비교 미승인"}</p>)}
      </details>
      <details className="field-help"><summary>실행 정보·보고된 사용량</summary><p>실행: {result.runId}</p><p>모델: {result.model}</p><p>호출 시도 {result.callCount}회 · 입력 {result.inputTokens ?? "미확인"} / 출력 {result.outputTokens ?? "미확인"}토큰</p><p>파일에 기록된 사용량이며 구독 잔여량이나 실제 과금 인증이 아닙니다. 실패한 호출의 사용량은 미확인일 수 있습니다.</p></details>
    </>}
  </section>;
}
