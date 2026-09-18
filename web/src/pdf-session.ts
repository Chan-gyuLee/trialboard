import type { getDocument, PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { extractPages } from "./pdf-extract.ts";
import { PDF_LIMITS, sourceStatus, validatePdfBytes, type PdfSource, type PdfWindowSource } from "./pdf-contract.ts";
import { extractAutoPages, type PdfCoverage } from "./pdf-auto-pages.ts";

export type LoadedPdf = { source: PdfSource; coverage?: PdfCoverage; pdf: PDFDocumentProxy; destroy: () => Promise<void> };
export type LoadedWindowPdf = Omit<LoadedPdf,'source'> & {source:PdfWindowSource};

export function openPdfSession(file:File,signal:AbortSignal,onProgress:(page:number)=>void,createDocument:typeof getDocument,version:string,timeoutMs:number,mode:'auto'):Promise<LoadedWindowPdf>;
export function openPdfSession(file:File,signal:AbortSignal,onProgress:(page:number)=>void,createDocument:typeof getDocument,version:string,timeoutMs?:number,mode?:'manual'):Promise<LoadedPdf>;
export async function openPdfSession(file: File, signal: AbortSignal, onProgress: (page: number) => void,
  createDocument: typeof getDocument, version: string, timeoutMs: number = PDF_LIMITS.timeoutMs, mode:'manual'|'auto'='manual'): Promise<LoadedPdf|LoadedWindowPdf> {
  if (file.size > PDF_LIMITS.bytes) throw new Error("PDF는 5 MB 이하만 지원합니다.");
  let task: PDFDocumentLoadingTask | undefined;
  let stopped = false;
  const stop = () => { stopped = true; void task?.destroy().catch(() => {}); };
  let abortHandler: () => void;
  const abort = new Promise<never>((_, reject) => {
    abortHandler = () => reject(new DOMException("취소되었습니다.", "AbortError"));
    signal.addEventListener("abort", abortHandler, { once: true });
  });
  signal.addEventListener("abort", stop, { once: true });
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { stop(); reject(new Error("처리 제한 시간 안에 PDF를 읽지 못했습니다. 문서 범위를 줄여 다시 시도하세요.")); }, timeoutMs); });
  try {
    signal.throwIfAborted();
    const work = async (): Promise<LoadedPdf|LoadedWindowPdf> => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      validatePdfBytes(bytes);
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      if (stopped) throw new DOMException("취소되었습니다.", "AbortError");
      const sha256 = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
      task = createDocument({ data: bytes, stopAtErrors: true, enableXfa: false, useSystemFonts: false,
        cMapUrl: "/pdf-assets/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdf-assets/standard_fonts/", wasmUrl: "/pdf-assets/wasm/",
        maxImageSize: 16000000, canvasMaxAreaInBytes: 16000000, verbosity: 0 });
      const pdf = await task.promise;
      if (pdf.isPureXfa) throw new Error("XFA 양식 PDF는 지원하지 않습니다.");
      const extracted = mode==='auto' ? await extractAutoPages(pdf,onProgress,signal) : {pages:await extractPages(pdf,onProgress,signal),coverage:undefined};
      const {pages,coverage} = extracted;
      if (stopped) throw new DOMException("취소되었습니다.", "AbortError");
      const source:Omit<PdfSource,'schemaVersion'>={name:file.name,byteLength:file.size,sha256,
        extractor:`pdfjs-dist/${version}`,pages,status:sourceStatus(pages),coordinateSystem:'normalized_top_left_rotated_viewport'};
      const session={coverage,pdf,destroy:()=>pdf.loadingTask.destroy()};
      return mode==='auto'
        ? {...session,source:{...source,schemaVersion:'pdf-evidence-window/1'}}
        : {...session,source:{...source,schemaVersion:'pdf-evidence/1'}};
    };
    return await Promise.race([work(), timeout, abort]);
  } catch (e) {
    stop();
    if (e instanceof Error && e.name === "PasswordException") throw new Error("암호가 필요한 PDF는 지원하지 않습니다.");
    if (e instanceof Error && ["InvalidPDFException", "UnknownErrorException"].includes(e.name)) throw new Error("PDF 구조를 읽을 수 없습니다. 원본을 확인해 주세요.");
    throw e;
  } finally {
    clearTimeout(timer!);
    signal.removeEventListener("abort", stop);
    signal.removeEventListener("abort", abortHandler!);
  }
}
