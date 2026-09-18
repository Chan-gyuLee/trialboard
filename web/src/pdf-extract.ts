import type { PDFDocumentProxy } from "pdfjs-dist";
import { PDF_LIMITS, sourceStatus, textBox, type PdfPage } from "./pdf-contract.ts";

/** Shared by browser and real-PDF integration tests. Keeps PDF item text unchanged. */
export async function extractPages(pdf: PDFDocumentProxy, onProgress: (page: number) => void = () => {}, signal?: AbortSignal, pageNumbers?: number[]): Promise<PdfPage[]> {
  if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > (pageNumbers ? 200 : PDF_LIMITS.pages)) throw new Error("40페이지 이하 PDF만 지원합니다. 필요한 문서 범위를 별도로 준비해 주세요.");
  const selected = pageNumbers ?? Array.from({length: pdf.numPages}, (_, i) => i + 1);
  if (!selected.length || selected.length > PDF_LIMITS.pages || selected.some((n, i) => !Number.isInteger(n) || n < 1 || n > pdf.numPages || (i > 0 && n <= selected[i - 1]))) throw new Error("PDF 페이지 선택 범위를 확인해 주세요.");
  const pages: PdfPage[] = [];
  let items = 0, characters = 0;
  for (const number of selected) {
    signal?.throwIfAborted();
    const page = await pdf.getPage(number);
    try {
    const view = page.getViewport({ scale: 1 });
    if (![view.width, view.height].every(n => Number.isFinite(n) && n > 0 && n <= 14400)) throw new Error("지원하지 않는 PDF 페이지 크기입니다.");
    const text = await page.getTextContent({ disableNormalization: true });
    signal?.throwIfAborted();
    const spans: PdfPage["spans"] = [];
    for (const [index, item] of text.items.entries()) {
      if (!("str" in item)) continue;
      characters += item.str.length; items++;
      if (items > PDF_LIMITS.items || characters > PDF_LIMITS.characters) throw new Error("PDF 텍스트가 처리 한도를 초과했습니다. 문서 범위를 줄여 주세요.");
      if (!item.str.trim()) continue;
      spans.push({ id: `p${number}-i${index}`, page: number, item: index, text: item.str,
        box: textBox(item, text.styles[item.fontName] ?? {}, view) });
    }
    pages.push({ number, width: view.width, height: view.height, rotation: view.rotation, spans, status: spans.length ? "TEXT_EXTRACTED" : "NO_TEXT" });
    } finally { page.cleanup(); }
    onProgress(number);
  }
  sourceStatus(pages);
  return pages;
}
