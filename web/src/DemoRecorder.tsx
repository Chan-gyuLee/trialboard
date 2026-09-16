import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "@mui/material";

/** Local-only, explicit browser picker. No microphone, upload, or persistence. */
export function DemoRecorder() {
  const [recording, setRecording] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState(""), [output, setOutput] = useState("");
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null);
  const url = useRef(""), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach(t => t.stop());
    if (url.current) URL.revokeObjectURL(url.current);
  }, []);
  async function start() {
    if (pending || recording) return;
    setPending(true); setError("");
    try {
      const media = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "browser", frameRate: 24 }, audio: false,
        preferCurrentTab: true, selfBrowserSurface: "include", monitorTypeSurfaces: "exclude", surfaceSwitching: "exclude" } as DisplayMediaStreamOptions);
      stream.current = media;
      if (media.getVideoTracks()[0]?.getSettings().displaySurface !== "browser") throw new Error("탭만 녹화합니다. TrialBoard 탭을 선택해 주세요.");
      const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(t => MediaRecorder.isTypeSupported(t));
      if (!mimeType) throw new Error("이 브라우저는 WebM 녹화를 지원하지 않습니다.");
      const r = new MediaRecorder(media, {mimeType, videoBitsPerSecond: 4_000_000});
      const chunks: Blob[] = []; let size = 0;
      r.ondataavailable = e => { if (e.data.size) { chunks.push(e.data); size += e.data.size; } if (size > 250_000_000 && r.state === "recording") r.stop(); };
      r.onstop = () => {
        if (timer.current) clearTimeout(timer.current);
        media.getTracks().forEach(t => t.stop()); setRecording(false);
        if (chunks.length) { if (url.current) URL.revokeObjectURL(url.current); url.current = URL.createObjectURL(new Blob(chunks, {type:mimeType})); setOutput(url.current); }
      };
      r.onerror = () => { setError("녹화 오류가 발생했습니다. 저장된 영상이 있다면 확인하세요."); if (r.state === "recording") r.stop(); };
      media.getVideoTracks()[0].onended = () => { if (r.state === "recording") r.stop(); };
      recorder.current = r; r.start(1000); setRecording(true);
      timer.current = setTimeout(() => { if (r.state === "recording") r.stop(); }, 600_000);
    } catch (e) { stream.current?.getTracks().forEach(t => t.stop()); setError(e instanceof Error ? e.message : "녹화를 시작하지 못했습니다."); }
    finally { setPending(false); }
  }
  return <div className="demo-recorder" aria-label="로컬 시연 녹화">
    {recording ? <Button color="error" onClick={() => recorder.current?.stop()}>● 녹화 종료</Button> : <Button disabled={pending} onClick={() => void start()}>{pending ? "탭 선택 대기…" : "시연 녹화"}</Button>}
    {!recording && output && <Button component="a" href={output} download="trialboard-moc-demo.webm">영상 저장</Button>}
    {!recording && <small>TrialBoard 탭 선택 · 무음 · 최대 10분 · 로컬 저장</small>}
    {error && <Alert severity="warning">{error}</Alert>}
  </div>;
}
