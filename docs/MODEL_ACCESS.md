# 모델 사용 방침과 대회 API 안내

## 최신 방침 · 2026-09-16

사용자가 제품 에이전트의 대회 API 전환과 기존 키 테스트를 명시적으로 승인했다.
개발 도구의 개인 Codex 로그인은 유지한다. 제품 API/에이전트 CLI/재검토 CLI 기본값은 `dacon`이다.
연결·키의 비표시 입력·실측 결과·오류 정책은 [DACON_RUNTIME.md](DACON_RUNTIME.md)를 따른다.
개인 Codex는 명시적 선택만 허용하며 대회 실패 시 자동 전환하지 않는다.

아래는 2026-09-13 당시 방침/검증 기록이며 위 전환 전의 상태다.

갱신일: 2026-09-13. 출처: 사용자가 전달한 2026-09-07 DACON 운영진 메일.
**비밀키·메일 주소·메일 원문은 이 문서에 저장하지 않는다.**

## 사용자가 지정한 순서

1. 지금은 사용자 개인 계정의 사용량/토큰으로 개발한다.
2. 대회 API는 중간 검증 단계에서 사용자가 전환을 지시한 뒤 사용한다.
3. 개인 계정 연결 실패·사용 한도 소진 시 대회 API로 자동 전환하지 않는다.
4. 대회 키로 연결 확인 요청이나 잔여량 조회를 먼저 보내지 않는다.

사용자가 **현재 로그인한 Codex의 사용량**을 뜻한다고 확정했다. 2026-09-13 로컬 `codex login status`에서 `Logged in using ChatGPT`를 확인했다.
현재 기본 실행 경로는 `--provider codex`이며, 공식 `codex exec`가 저장된 ChatGPT 로그인을 직접 사용한다. TrialBoard는 인증 파일을 읽거나 로그인 토큰을 API 키처럼 재사용하지 않는다.
별도 개인 API 키와 대회 키를 설정하지 않았으며, 개인 Responses API와 대회 endpoint는 호출하지 않았다. Codex 경로의 실제 실행 기록은 [에이전트 실행 흐름](AGENT_WORKFLOW.md)에 구분한다.

## 현재 Codex 개발 경로

```bash
uv run trialboard-agent --live-example normal --provider codex \
  --allow-external --max-calls 2 --max-repairs 0
```

- `--demo`는 항상 스크립트 테스트다. `--live-example`은 가상자료를 **실제 모델에 전송해 Codex 사용량을 소비**한다.
- 확인한 CLI 버전은 `0.154.0`. 다른 버전은 안전 설정·이벤트 계약을 재검증하기 전 실행을 중단한다.
- 기존 로그인 위치만 유지하고 API 키·외부 provider URL·proxy·부모 세션 환경 변수는 자식 프로세스에 전달하지 않는다. `forced_login_method="chatgpt"`와 공식 provider를 지정한다.
- 사용자 config를 상속하지 않는 일회성 실행, 빈 임시 작업 폴더, read-only sandbox, 승인 요청 없음, 검색·shell·브라우저·앱·플러그인·hook·위임 기능 비활성화를 사용한다. 알 수 없는 도구 이벤트와 오류는 실패 처리한다. 의도적으로 꺼 둔 code-mode host의 정확한 시작 알림만 구분해서 기록한다.
- 선택 원문만 stdin으로 전달한다. 프로젝트 코드나 원본 PDF를 첨부하지 않는다. 인증 갱신·캐시 등 CLI 자체의 상태 관리는 CLI가 수행할 수 있다.
- `--ephemeral`은 로컬 세션 rollout을 남기지 않는 옵션이지 제공사 전체의 무보존 보장이 아니다. 보고서에는 입력 원문이 저장되므로 공개/합성 자료로만 개발한다.
- 응답의 입력·출력 토큰과 CLI turn 수를 기록한다. **구독 잔여량·사용률·API 비용으로 환산하지 않는다.** CLI 내부 재연결/재시도는 turn 수와 다를 수 있고, 실패한 호출은 사용량 미확인일 수 있다.
- 출력 4,000토큰은 CLI 경로에서 프롬프트 목표일 뿐 강제 상한이 아니다. 전체 시간·turn 수·보고된 사용량 검사와 프로세스 종료를 적용하지만 소비량의 절대 상한을 약속하지 않는다.
- 기본 모델의 정확한 ID는 CLI JSONL에 나오지 않아 `codex-cli-default-not-resolved`로 표시한다. 재현 평가에는 계정에서 사용 가능한 ID를 `TRIALBOARD_CODEX_MODEL`로 명시해야 한다. 모델이 지정되면 자동 대체하지 않는다.

이 경로는 **개인 로컬 개발 전용**이다. 친구/기업 사용자를 위해 개인 로그인을 공유하거나 웹 서비스에 노출하지 않는다. 본선/서비스 실행은 별도 승인된 서버 API adapter와 권한·보존 정책을 준비한 뒤 연결한다.

기존 개인 API adapter는 `--provider openai`를 명시하고 `TRIALBOARD_OPENAI_API_KEY`와 `TRIALBOARD_OPENAI_MODEL`을 설정했을 때만 사용할 수 있다. Codex 실패 시 자동 전환하지 않는다.

OpenAI Docs 스킬을 사용해 [공식 비대화형 실행](https://learn.chatgpt.com/docs/non-interactive-mode), [CLI 옵션](https://learn.chatgpt.com/docs/developer-commands?surface=cli), [설정 계약](https://learn.chatgpt.com/docs/config-file/config-reference)을 확인하고 위 인증 분리·실행 제한에 반영했다.

## 대회 연결 계약 — 메일 기준, 아직 호출 검증 안 함

- Base URL: `https://dacon-apim-hackathon-0903.azure-api.net/hackathon/openai/v1`
- 요청: `POST /responses`
- 인증: `api-key` 사용자 지정 헤더. 현재 개인 API adapter의 Bearer 인증만으로 대체하지 않는다.
- 안내된 모델: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`.
- GPT-6 계열 지원은 해당 메일에서 미정. 별도 안내 전 지원한다고 가정하지 않는다.
- 팀 전체 누적 30,000,000토큰, 500,000 TPM, 300 RPM. 팀원 전체가 공유한다.
- streaming 사용 가능. fast/우선 처리 옵션은 지원하지 않는다고 안내됨.

응답 헤더:

| 헤더 | 의미 |
| --- | --- |
| `x-team-remaining-quota-tokens` | 누적 잔여량 추정치; 지연/차이가 있을 수 있음 |
| `x-team-tokens-consumed` | 이번 요청 소비량 |
| `x-team-remaining-tokens` | 단시간 토큰 한도 잔여량 |
| `x-team-remaining-requests` | 단시간 요청 한도 잔여량 추정치 |

오류: 401 인증 헤더/키 확인, 400·404 모델명 확인, 429 속도/토큰 한도, 403 팀 총량 소진.
403을 자동 재시도로 소모하지 않고, 429는 제한된 대기/재시도 정책을 별도로 설계한다.

## 전환할 때 구현·확인할 것

- 개인 키와 대회 키는 별도 설정 이름으로 관리. 예: 개인 `TRIALBOARD_OPENAI_API_KEY`, 대회 `TRIALBOARD_DACON_API_KEY`.
- 명시적 provider 선택과 고정 endpoint allowlist. 개인 키를 대회 서버에 보내거나 반대 방향으로 보내지 않음.
- 대회 모델 allowlist·`api-key` 헤더·사용량 헤더 파싱·403/429 구분 테스트.
- 현재 strict JSON Schema, `store:false`, 사용량 필드 등의 호환성은 메일만으로 입증되지 않음. 전환 후 최소 요청으로 검증.
- 실제 사용량/속도 제한은 다른 팀원의 사용과 함께 변하므로 로컬 카운터만으로 총량을 보장하지 않음.
- 본선 평가는 대회에서 실제 지원하는 모델로 수행하고, 개인 모델 결과와 구분해서 기록.

현재 대회 adapter를 구현하거나 토큰을 설정한 상태는 아니다. 운영진에게 연락하거나 키를 재발급 요청하지도 않았다.
키가 외부에 공개되었거나 다른 사람이 접근할 수 있게 공유되었다면 운영진에게 알려 교체 여부를 확인한다.

개인 API 설정은 [공식 API 안내](https://developers.openai.com/api/docs/quickstart), Codex 계정 인증은 [공식 인증 안내](https://learn.chatgpt.com/docs/auth)를 따른다. OpenAI Docs 스킬로 두 인증 경로가 다른 점을 확인했으며 실제 개인 키나 Codex 로그인 정보를 읽어 내보내지 않았다.
