# 제품 에이전트 · 대회 API 연결

2026-09-16. 사용자가 제품 실행의 대회 API 전환과 기존 팀 키의 실제 테스트를 승인했다.
메일의 비밀키·연락처·본문 전체는 저장하지 않는다.

## 개발 계정과 제품 실행의 분리

- 이 저장소를 개발하는 Codex 도구의 로그인/사용량은 기존 개인 계정 그대로다.
- 제품 API 서버와 에이전트/재검토 CLI의 기본 provider는 `dacon`이다.
- 약물 조사 AI 계획/검토, 고정 사례 추출/반론, PDF 추출/반론에 같은 서버 provider를 주입한다.
- 개인 Codex는 `--agent-provider codex`(API) 또는 `--provider codex`(CLI)로 명시할 때만 사용한다.
- 스크립트 MOC/자료 수집만/규칙 검사/설계 계산은 모델을 호출하지 않는다.
- 인증 실패, 403, 429, 응답 실패에도 개인 Codex·다른 API·저장 성공으로 자동 전환하지 않는다.

## 실행 방법

저장소 루트의 터미널에서:

```bash
uv run python -m trialboard.api \
  --agent-provider dacon --prompt-dacon-key \
  --enable-designs --enable-agent-demo --enable-pdf-agent --enable-evidence-scout
```

프롬프트가 뜨면 운영진에게 받은 키를 입력한다. 입력은 비표시이며 파일/명령 이력에 저장하지 않는다.
키는 해당 서버 프로세스의 환경에만 보관한다. 종료 후 다시 입력해야 한다.
이미 `TRIALBOARD_DACON_API_KEY`가 안전하게 설정된 서버 환경이라면 `--prompt-dacon-key`는 생략한다.
`.env` 파일을 자동 로드하지 않으며 `VITE_` 환경변수에는 키를 넣지 않는다.

별도 터미널에서 `npm --prefix web run dev` 후 http://127.0.0.1:5173 에 접속한다.
화면의 모델 안내에는 `대회 API · gpt-5.6-terra · 팀 공용 토큰`이 표시된다.
키가 설정되었다는 표시는 유효성/잔여량 검증이 아니며 실제 실행에는 별도 전송 동의가 필요하다.

단 한 번의 합성 연결 검사:

```bash
uv run python -m trialboard.agent.dacon_smoke --allow-external --prompt-key
```

이 명령도 팀 토큰을 소비한다. API 키를 인자로 직접 전달하거나 소스에 붙이지 않는다.

## 연결 규격과 제한

운영진이 제공한 메일 기준:

- 고정 주소: `https://dacon-apim-hackathon-0903.azure-api.net/hackathon/openai/v1/responses`
- 인증: `api-key` 헤더. 개인 OpenAI Bearer 키를 전송하지 않는다.
- 모델: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`만 허용.
- 기본 모델: `gpt-5.6-terra`; 변경은 서버의 `TRIALBOARD_DACON_MODEL`로 명시.
- 팀 전체 누적 30,000,000토큰 / 500,000 TPM / 300 RPM. 팀원 공유 한도다.
- fast/우선처리 옵션은 보내지 않는다. 클라이언트 자동 재시도·리다이렉트·환경 프록시는 끈다.
- 고정 공개 사례는 최대 2회, PDF/합성 사례는 최대 4회, AI 조사는 최대 2회. 기존 전체 실행 시간 제한을 유지한다.
- HTTP 응답은 제한된 크기로 읽고, 구조화 출력/완료 상태/거부 응답을 확인한다.
  [공식 Responses 구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs)을 참고해
  strict object schema의 required/additionalProperties를 맞췄다. 임상 정확성을 보장하는 기능은 아니다.
- 전송은 `store:false`. 이 옵션이 대회 운영자의 로그/보존 정책까지 보장한다는 뜻은 아니다.
- 모델 응답 토큰 자체는 현재 비스트리밍으로 받는다. 웹의 실제 작업 상태 스트림은 기존 서버 이벤트로 유지한다.

| HTTP | 공개 오류 코드 | 처리 |
| --- | --- | --- |
| 401 | DACON_AUTH_FAILED | 서버 키/헤더 확인 |
| 400 | DACON_REQUEST_REJECTED | 요청/구조화 출력 규격 확인 |
| 404 | DACON_MODEL_OR_ENDPOINT_UNAVAILABLE | 모델명·주소 확인 |
| 429 | DACON_RATE_LIMITED | 자동 재시도 없음; 한도 회복 후 사용자가 재실행 |
| 403 | DACON_QUOTA_EXHAUSTED | 팀 전체 한도 확인; 자동 전환 없음 |

모델 오류의 원문 본문·인증 헤더는 UI/보고서에 넣지 않는다.
사용량은 응답의 input/output 토큰과 숫자로 검증된 네 가지 `x-team-*` 헤더만 기록한다.
잔여량 헤더는 **추정치**이며 지연/차이가 있을 수 있다. 실패/취소 요청의 사용량은 미확인일 수 있다.
HTTP 요청을 중단해도 원격 모델 처리가 취소되거나 토큰이 환불된다고 보장하지 않는다.

## 실제 검증 · 2026-09-16

1. 기존 팀 키를 비표시 터미널 입력으로 전달. 파일 저장 없음.
2. `gpt-5.6-terra` 합성 구조화 연결 검사: OK, 입력63/출력14 = 77토큰.
3. 로컬 API를 대회 모드로 실행하고 고정 공개 FDA 발췌 사례를 요청.
   추출→규칙 검사→반론, 2회 모두 RECEIVED, mode `DACON_RESPONSES`.
   입력1,989/출력716 + 입력2,823/출력373 = 5,901토큰.
   초안 채택2개, 최종 `PARTIAL_ABSTENTION`. 설계에 충분한 근거/임상 승인은 아니다.
4. 합계3요청, 보고된 입력/출력 합계5,978토큰. 개인 Codex fallback0회.
   마지막 잔여량 헤더29,994,099는 추정치이므로 위 합계에서 뺀 정확한 장부 값으로 해석하지 않는다.

자동 검증: Python503/웹751, build/Ruff. HTTP 인증/한도/리다이렉트/거부/비정상 출력,
키 누락 시 개인 계정 전환 금지, 서버 capability와 프런트 실행 mode 일치 포함.
기존 Chrome의 에이전트 브리핑에서 대회API/모델/팀공용 안내, 별도 전송 동의와 미동의 실행 비활성,
이전 Codex 저장 기록과의 구분을 확인했다. 이 화면 점검 중 새 모델 호출은 없다.
실제 대회 PDF/다중 출처 조사/재검토의 모든 UI 경로를 새로 완주한 것은 아니다.
실제 임상·통계 독립 평가와 기업 보안/호스팅은 별도다. 전체77% 유지.
