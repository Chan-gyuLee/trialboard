import { GlobalWorkerOptions, getDocument, version } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { openPdfSession } from "./pdf-session";
import type {PdfPageSelection} from './pdf-contract';
export type { LoadedPdf } from "./pdf-session";

GlobalWorkerOptions.workerSrc = workerUrl;
export const openPdf = (file: File, signal: AbortSignal, progress: (page: number) => void) =>
  openPdfSession(file, signal, progress, getDocument, version);
export const openAutoPdf = (file: File, signal: AbortSignal, progress: (page: number) => void) =>
  openPdfSession(file, signal, progress, getDocument, version, 40000, 'auto');
export const openSelectedPdf = (file:File, signal:AbortSignal, progress:(page:number)=>void, selection:PdfPageSelection) =>
  openPdfSession(file,signal,progress,getDocument,version,40000,selection);
export const openReviewPdf = (file:File,signal:AbortSignal,progress:(page:number)=>void) =>
  openPdfSession(file,signal,progress,getDocument,version,40000,'review');
