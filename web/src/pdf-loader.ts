import { GlobalWorkerOptions, getDocument, version } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { openPdfSession } from "./pdf-session";
export type { LoadedPdf } from "./pdf-session";

GlobalWorkerOptions.workerSrc = workerUrl;
export const openPdf = (file: File, signal: AbortSignal, progress: (page: number) => void) =>
  openPdfSession(file, signal, progress, getDocument, version);
