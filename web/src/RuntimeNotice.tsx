import { useEffect, useState } from "react";
import { Alert, Button } from "@mui/material";
import { isLocalDemo } from "./agent-live";

/** Server-owned configuration only; never accepts, renders or stores credentials. */
export default function RuntimeNotice() {
  const [message, setMessage] = useState("실행 모델 확인 중 · 모델 호출 없음");
  const [warning, setWarning] = useState(false);
  const [probe, setProbe] = useState(0);
  useEffect(() => {
    if (!isLocalDemo(window.location)) {
      setMessage("실제 에이전트는 로컬 개발 화면에서만 실행할 수 있습니다."); return;
    }
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    fetch("/api/agent-demo/capabilities", { signal:controller.signal, cache:"no-store" })
      .then(async response => { if (!response.ok) throw Error(); return response.json(); })
      .then(caps => {
        if (caps.provider === "DACON_RESPONSES") {
          if (!["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].includes(caps.model)) throw Error();
          setWarning(!caps.configured);
          setMessage(`대회 API · ${caps.model} · 팀 공용 토큰 사용 · 개인 Codex 사용 안 함. ${caps.configured ? "키 설정됨(유효성·잔여량은 미검증)." : "서버에 대회 키를 설정해야 실제 실행할 수 있습니다."}`);
        } else if (caps.provider === "CODEX_CHATGPT") {
          setWarning(false); setMessage("개인 Codex 로그인 · 개인 계정 사용량 소비 · 대회 API 아님. 로그인 유효성은 미검증.");
        } else throw Error();
      }).catch(() => { if (active) { setWarning(true); setMessage("실행 모델을 확인하지 못했습니다. 서버 설정을 확인하세요."); } })
      .finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [probe]);
  return <Alert severity={warning ? "warning" : "info"} action={<Button onClick={() => setProbe(value => value + 1)}>연결 확인</Button>}>{message} 자동 재시도·다른 공급자 전환 없음.</Alert>;
}
