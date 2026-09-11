# 로컬 검토 실행 API

이 API는 입력을 받을 때마다 Python 검토 엔진을 실행한다. 현재 제공하는 근거 입력은
합성 fixture 3종뿐이다. 사용자가 바꾸는 확률은 임상자료에서 추정한 값이 아니라 합성 가정이다.
실제 자료 업로드·원문 의미 검증·LLM·자동 설계 추천·임상 권고는 구현하지 않았다.
비공개 배포 웹은 여전히 저장 결과를 탐색한다. 로컬 웹 개발 서버는 `/api`를 이 서버로
중계하며 조건 편집·재실행·이전 결과 비교를 지원한다. 원격 연결은 아직 구현하지 않았다.

## 실행

```bash
uv sync
uv run trialboard-api --port 8000
```

서버는 `127.0.0.1`에만 바인딩한다. 실행 중인 터미널에서 Ctrl-C로 종료한다.
실행 후 `http://127.0.0.1:8000/docs`에서 입력 계약과 호출 화면을 확인할 수 있다.
대화형 문서 화면의 JS/CSS는 기본 FastAPI CDN 리소스를 사용한다. API 실행 자체에는
외부 자료 조회·API 키·LLM 호출이 필요 없다.

| 경로 | 내용 |
| --- | --- |
| `GET /health` | 서버 응답 여부, 합성 전용 표시 |
| `GET /api/reviews/defaults` | 편집 가능한 기본 입력, 고정 용량군 순서, 실행 제한 |
| `POST /api/reviews` | 입력 검증 → 합성 원본 대조 → 새 계산 → JSON/Markdown 반환 |

예를 들어 비교할 각 군 표본수를 24명·72명으로 바꾼다. 생략한 항목은 기본값을 사용한다.

```bash
curl --fail-with-body http://127.0.0.1:8000/api/reviews \
  -H 'Content-Type: application/json' \
  -d '{"mode":"normal","per_arm":[24,72],"repetitions":10000,"seed":42}'
```

`mode`는 `normal`, `denominator-error`, `missing-evidence` 중 하나다.
오류·결측 모드에서도 합성 가정 탐색은 가능하지만 보고서의 `PARTIAL_ABSTENTION`은 유지된다.
계산 결과로 근거 결측을 채우거나 실제 용량 선택을 허용하지 않는다.

## 입력과 실행 제한

시나리오는 `id`, `label`, `response`, `adverse_event`, `adverse_event_penalty`,
`maximum_adverse_event_rate`, `rationale`을 받는다. 확률 배열의 순서는 항상
`dose_a`, `dose_b`다. 기본 입력을 조회해 값을 수정한 뒤 POST하면 된다.

- 확률은 유한한 수 0–1, 이상반응 가중치는 유한한 수 0–10이다. 문자열·boolean을 수로 바꾸지 않는다.
- 표본수는 각 군 2–500명인 정수 두 개다. 중복 없이 오름차순으로 지정한다.
- 시나리오는 1–5개이고 ID는 중복할 수 없다. 라벨·설명에도 길이 제한이 있다.
- seed는 0–4,294,967,295인 정수, 반복은 100–100,000회다.
- `반복 × 2개 군 × 시나리오 수 × 2개 설계`가 1,000,000을 넘으면 거부한다.
  이것은 계산량 제한 지표이며 환자 수·임상적 적정성·실행시간 보장이 아니다.
- JSON 본문은 최대 32,768바이트다. Content-Length뿐 아니라 실제 수신량도 검사한다.
  본문 수신 제한은 10초이며 계산 강제 종료 제한과는 다르다.
- 프로세스당 동시 계산 2건까지만 허용한다. 대기열은 없으며 초과 요청은 429와 Retry-After를 받는다.

## 재현과 반환값

반환에는 매번 새로운 `execution_id`, UTC 실행 시각, 계산·검토 소요시간 `elapsed_ms`,
정규화한 `input`, 실제 대조에 사용한 `evidence_input`, `report`, 동일 보고서의 `markdown`이 있다.
소요시간은 HTTP 전송·응답 직렬화를 포함한 사용자 체감 시간은 아니다.

`report.input_digest`는 근거 입력·시나리오·설계·seed·반복을 정규 직렬화한 SHA-256이다.
같은 입력과 실행 환경에서는 보고서가 같고, 실행 ID·시각은 달라진다. 보고서에는
엔진·Python·NumPy·난수 생성기 버전과 가정, Monte Carlo 표준오차도 포함한다.
환경 버전이 다른 실행까지 비트 단위 동일성을 보장하지 않는다.

결과는 서버에 저장하지 않는다(`persisted: false`). 실행 ID로 재조회하는 기능이나
불변 감사로그는 아직 없다. 저장이 필요하면 응답 전체를 보관해야 한다.
Markdown은 데이터로 반환한다. 향후 웹에서 사용자가 입력한 라벨·설명을 렌더링할 때는
HTML을 이스케이프하고 Markdown의 raw HTML을 허용하지 않아야 한다.

## 오류와 개발 환경 경계

| 상태 | 의미 |
| --- | --- |
| 400 | 잘못된 Host 또는 Content-Length |
| 403 | 허용하지 않은 브라우저 Origin |
| 408 | 본문 수신 시간 초과 |
| 413 | 본문 크기 초과 |
| 415 | application/json이 아닌 POST |
| 422 | 잘못된 JSON·값·중복 ID·표본수 순서·계산량 초과 |
| 429 | 동시 계산 한도 초과; 잠시 후 다시 요청 |
| 500 | 실행 실패; 입력값·예외 본문을 반환하지 않음 |

422 응답은 문제 필드의 경로와 오류 유형을 제공한다. `work_budget_exceeded`는
시나리오 수나 반복을 줄이면 되고, `sample_size_order`는 표본수 순서를 수정하면 된다.
실패 로그에는 실행 ID와 예외 클래스만 기록하며 입력값·예외 메시지는 기록하지 않는다.

Host는 localhost·127.0.0.1만 허용한다. 브라우저 Origin은 같은 출처 또는
`http://localhost:5173`, `http://127.0.0.1:5173`만 허용하며 wildcard CORS를 사용하지 않는다.
이는 인증이나 운영용 보안 체계가 아니다. **외부 네트워크에 노출하거나 기업 자료를 넣지 않는다.**
일반 로컬 프로그램의 호출을 인증하지 않으며, 여러 worker를 띄우면 계산 한도도 프로세스별로 적용된다.
원격 연결에는 별도 호스팅·인증·권한·요청 제한·관측·보관 정책이 필요하다.

## 검증

```bash
uv run pytest
uv run ruff check .
```

테스트는 엔진과 API의 결과 일치, 입력 변경에 따른 재계산, 동일 입력 재현,
오류·결측 보류, 입력·본문·계산량 제한, 동시 실행 제한과 회복, 로컬 Origin/Host를 확인한다.
의료적 타당성·전문가 평가·제품 성능을 입증하는 테스트가 아니다.

구현 참고: [FastAPI testing](https://fastapi.tiangolo.com/tutorial/testing/),
[FastAPI concurrency](https://fastapi.tiangolo.com/async/),
[Pydantic strict mode](https://docs.pydantic.dev/latest/concepts/strict_mode/).
