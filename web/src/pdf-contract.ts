/** Local PDF evidence v1: text locations, not clinical claims or table semantics. */
export const PDF_LIMITS = { bytes: 5 * 1024 * 1024, pages: 40, documentPages: 200, items: 20000, characters: 250000, timeoutMs: 20000, notes: 100 } as const;
export type Box = { x: number; y: number; width: number; height: number };
export type PdfSpan = { id: string; page: number; item: number; text: string; box: Box | null };
export type PdfPage = { number: number; width: number; height: number; rotation: number; spans: PdfSpan[]; status: "TEXT_EXTRACTED" | "NO_TEXT" };
type PdfSourceBase = {
  name: string; sha256: string; byteLength: number;
  extractor: string; pages: PdfPage[]; status: "TEXT_EXTRACTED" | "PARTIAL_NO_TEXT" | "NO_TEXT";
  coordinateSystem: "normalized_top_left_rotated_viewport";
};
/** Selected pages keep their ORIGINAL PDF numbers; never fill gaps with invented pages. */
export type PdfSource = PdfSourceBase & ({schemaVersion:'pdf-evidence/1'} | {schemaVersion:'pdf-evidence-selected/1';totalPages:number});
export type PdfPageSelection = {totalPages:number;pageNumbers:number[]};
/** Original page numbers may be sparse; not accepted as a legacy project/review source. */
export type PdfWindowSource = PdfSourceBase & {schemaVersion:'pdf-evidence-window/1'};
export const pdfPage = (source:Pick<PdfSource,'pages'>, number:number) => source.pages.find(p=>p.number===number);
export const pdfTotalPages = (source:PdfSource) => source.schemaVersion==='pdf-evidence-selected/1'?source.totalPages:source.pages.length;
export function reviewPageSelection(source:PdfSource):PdfPageSelection|undefined {
  if(source.schemaVersion==='pdf-evidence/1')return undefined;
  if(source.schemaVersion!=='pdf-evidence-selected/1'||!Array.isArray(source.pages))throw Error('지원하지 않는 원문 검토 범위입니다.');
  const selection={totalPages:source.totalPages,pageNumbers:source.pages.map(p=>p.number)};
  validatePageSelection(selection);return selection;
}
export function validatePageSelection(selection:PdfPageSelection):void {
  const {totalPages,pageNumbers}=selection;
  if(!Number.isSafeInteger(totalPages)||totalPages<1||totalPages>PDF_LIMITS.documentPages||!Array.isArray(pageNumbers)||!pageNumbers.length||pageNumbers.length>PDF_LIMITS.pages||pageNumbers.some((n,i)=>!Number.isSafeInteger(n)||n<1||n>totalPages||(i>0&&n<=pageNumbers[i-1])))throw Error('PDF 선택 페이지 범위를 확인해 주세요. 원문 최대 200쪽 · 선택 최대 40쪽입니다.');
}
export type EvidenceNote = {
  sourceDigest: string; spanId: string; quote: string; page: number; box: Box;
  question: string; comment: string; userAttestedAt: string;
  locationStatus: "USER_ATTESTED_VISUAL_MATCH"; meaningStatus: "NOT_ASSESSED";
};
export type TextGeometry = { transform: number[]; width: number; dir: string };
export type ViewportGeometry = { width: number; height: number; transform: number[] };

export function validatePdfBytes(bytes: Uint8Array): void {
  if (!bytes.byteLength || bytes.byteLength > PDF_LIMITS.bytes) throw new Error("PDF는 5 MB 이하만 지원합니다.");
  if (new TextDecoder("ascii").decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("PDF 파일 서명을 확인할 수 없습니다.");
}

/** Font-metric estimate, not glyph/semantic verification. Unsupported geometry is explicit. */
export function textBox(item: TextGeometry, style: { ascent?: number; descent?: number; vertical?: boolean }, view: ViewportGeometry): Box | null {
  const t = item.transform, v = view.transform;
  if (t.length !== 6 || v.length !== 6 || ![...t, ...v, item.width, view.width, view.height].every(Number.isFinite)
      || view.width <= 0 || view.height <= 0 || item.width <= 0 || style.vertical || item.dir !== "ltr") return null;
  const h = Math.hypot(t[2], t[3]), w = Math.hypot(t[0], t[1]);
  const ascent = style.ascent ?? (style.descent === undefined ? 0.8 : 1 + style.descent);
  if (!h || !w || !Number.isFinite(ascent) || ascent <= 0 || ascent > 1.5 || Math.abs(t[0] * t[2] + t[1] * t[3]) > 0.01 * h * w) return null;
  const points = [0, item.width].flatMap(dx => [ascent - 1, ascent].map(dy => {
    const x = t[4] + t[0] / w * dx + t[2] * dy;
    const y = t[5] + t[1] / w * dx + t[3] * dy;
    return [(v[0] * x + v[2] * y + v[4]) / view.width, (v[1] * x + v[3] * y + v[5]) / view.height];
  }));
  const left = Math.min(...points.map(p => p[0])), right = Math.max(...points.map(p => p[0]));
  const top = Math.min(...points.map(p => p[1])), bottom = Math.max(...points.map(p => p[1]));
  // Do not clamp off-page text into a fake on-page location.
  if (left < 0 || top < 0 || right > 1 || bottom > 1 || right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function sourceStatus(pages: PdfPage[]): PdfSource["status"] {
  if (!pages.length || pages.length > PDF_LIMITS.pages) throw new Error("PDF 페이지 수가 지원 범위를 벗어났습니다.");
  const empty = pages.filter(p => p.status === "NO_TEXT").length;
  return empty === pages.length ? "NO_TEXT" : empty ? "PARTIAL_NO_TEXT" : "TEXT_EXTRACTED";
}

export function attestSpan(source: PdfSource, spanId: string, question: string, comment: string, confirmed: boolean, now = new Date()): EvidenceNote {
  const span = source.pages.flatMap(p => p.spans).find(s => s.id === spanId);
  if (!span?.box || !confirmed) throw new Error("강조 위치와 원문 문구를 먼저 확인해 주세요.");
  if (!question.trim() || question.length > 500 || comment.length > 2000) throw new Error("검토 질문은 1–500자, 메모는 2,000자 이하로 입력하세요.");
  return { sourceDigest: source.sha256, spanId, quote: span.text, page: span.page, box: { ...span.box },
    question: question.trim(), comment: comment.trim(), userAttestedAt: now.toISOString(),
    locationStatus: "USER_ATTESTED_VISUAL_MATCH", meaningStatus: "NOT_ASSESSED" };
}

export function evidenceExport(source: PdfSource, notes: EvidenceNote[]) {
  if (notes.length > PDF_LIMITS.notes || new Set(notes.map(n => n.spanId)).size !== notes.length) throw new Error("근거 메모 수 또는 중복을 확인해 주세요.");
  for (const note of notes) {
    const span = source.pages.flatMap(p => p.spans).find(s => s.id === note.spanId);
    if (!span?.box || note.sourceDigest !== source.sha256 || note.quote !== span.text || note.page !== span.page
        || JSON.stringify(note.box) !== JSON.stringify(span.box)
        || note.locationStatus !== "USER_ATTESTED_VISUAL_MATCH" || note.meaningStatus !== "NOT_ASSESSED") {
      throw new Error("문서 버전 또는 근거 위치가 메모와 일치하지 않습니다.");
    }
  }
  return { schemaVersion: "pdf-evidence-review/1", source, notes, persisted: false, execution: "browser_pdf_text_and_user_attestation",
    limitations: ["좌표는 글꼴 지표 기반 근사 영역이며 사용자 확인은 인증된 전문가 검증이 아닙니다.",
      "텍스트 추출은 표 구조·수치·분모·환자군·임상적 의미의 검증이 아닙니다.",
      "OCR·LLM·CSV와의 자동 대조·설계 권고는 수행하지 않았습니다.",
      "PDF 전체가 아닌 추출 텍스트와 위치를 포함합니다. 원본 PDF를 별도로 보관하세요.",
      "텍스트 추출 순서는 시각적 읽기 순서와 다를 수 있으며 추출되지 않은 내용이 있을 수 있습니다.",
      ...(source.schemaVersion==='pdf-evidence-selected/1'?[`전체 ${source.totalPages}쪽 중 ${source.pages.length}쪽만 검토 작업에 포함됩니다. 원래 PDF 쪽수를 유지하며, 선택되지 않은 페이지는 검토하지 않았습니다.`]:[])] };
}

const escapeMd = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(/([\\`*_{}\[\]()#+.!|~-])/g, "\\$1").replace(/[\r\n]+/g, " ");
export function evidenceMarkdown(source: PdfSource, notes: EvidenceNote[]): string {
  const packet = evidenceExport(source, notes);
  return ["# PDF 원문 확인 메모", "", `자료: ${escapeMd(source.name)}`, `SHA-256: ${source.sha256}`,
    `추출기: ${source.extractor} · 전체 ${pdfTotalPages(source)}쪽 중 ${source.pages.length}쪽 포함 · ${source.status}`, "",
    "사용자가 원문 위치를 확인한 메모입니다. 임상적 판단 또는 전문가 승인 문서가 아닙니다.", "",
    ...notes.flatMap((n, i) => [`## ${i + 1}. ${escapeMd(n.question)}`, "", `원문: PDF p.${n.page} · ${n.spanId}`,
      `> ${escapeMd(n.quote)}`, "", `검토자 메모: ${escapeMd(n.comment || "없음")}`, `사용자 확인 시각: ${n.userAttestedAt}`, ""]),
    "## 확인하지 않은 것", "", ...packet.limitations.map(l => `- ${l}`), ""].join("\n");
}
