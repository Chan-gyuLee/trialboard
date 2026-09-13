# 사용자 수정 후 AI 반론 재실행

구현일: 2026-09-13. 로컬 Python 엔진/CLI 단계다. 새 반론의 [웹 결과 표시](RECRITIQUE_RESULT_UI.md)는 후속 구현했다. 웹 자동 실행은 아직 없다.
전체 최신 추정: [구현율 기준](COMPLETION_ESTIMATE.md).

## 무엇이 달라졌나

원본 PDF·추출 원문 export·필드 검토·원래 에이전트 결과를 기존 규칙으로 **새로 대조한 뒤**,
규칙 검사 후 남은 현재 관측값만 단 한 번 AI 반론 검토에 보낸다. 외부의 재검증 보고서를 실행 근거로 신뢰하지 않는다.
AI가 추출/수정하는 단계는 없다. 사용자 원래 값·수정값·확인/보류·사유·이력은 그대로 보존한다.

- `observation_error`: 해당 관측값을 새 모델 의견에서 보류한다. 사용자 기록을 수정하지 않는다.
- `comparison_limitation`: 근거가 있는 관측값은 초안으로 남기고 비교는 미승인 상태를 유지한다.
- 현재 후보가 없으면 `NO_CANDIDATES`, 모델 호출 0회다. 빈 답변으로 대체하지 않는다.
- 잘못된 스키마/인용 참조, 시간 초과/전송 오류는 `FAILED`, 토큰 예산 초과는 `BUDGET_EXCEEDED`다.
- 자동 재시도·API fallback·보류값 재채택·과거 쟁점 해결 인증·임상 승인은 없다.

## 실행

이미 [필드 검토](FIELD_REVIEW_UI.md)를 만든 경우:

```bash
uv run python -m trialboard.agent.recritique \
  --review /path/to/trialboard-field-review.json \
  --source-export /path/to/pdf-evidence-review.json \
  --pdf /path/to/original.pdf \
  --agent-report /path/to/original-agent-report.json \
  --allow-external
```

수동으로 시작한 검토는 `--agent-report` 대신 `--asset --indication --study --question`을 모두 지정한다.
모델 없이 계약 연결만 검사하려면 `--allow-external` 대신 `--scripted-test`를 쓴다.
두 옵션은 동시에 사용할 수 없다. `--scripted-test` 결과는 실제 AI 실행으로 표시하지 않는다.

기본은 현재 공식 Codex CLI의 ChatGPT 로그인이다. 선택 문구·후보 관측값·규칙 쟁점을 외부로 전송하므로
`--allow-external`을 명시해야 한다. 원본 PDF 자체, 사용자 사유/전체 이력, 이전 AI 의견은 모델에 보내지 않는다.
선택 문구에는 제외된 관측값과 관련된 문맥이 포함될 수 있다. 공개/합성 자료 기반 개발을 전제로 한다.
개인 API·대회 API 경로는 활성화하지 않았다. [모델 사용 방침](MODEL_ACCESS.md)을 따른다.

OpenAI Docs 스킬로 [공식 비대화형 실행 지침](https://learn.chatgpt.com/docs/non-interactive-mode)을 확인했다.
기존 adapter의 읽기 전용/도구 비활성화/구조화 출력/인증 분리를 유지했으며 인증 파일을 읽지 않는다.

## 실행 제한과 기록

- 1회 호출, 수정 0회, 기본 전체 120초/보고 사용량 예산 200,000토큰. `--seconds`, `--max-total-tokens`로 낮출 수 있다.
- 기존 보수적 요청 예약량보다 예산이 작으면 호출 전에 중단한다. Codex 출력 목표는 강제 토큰 상한이 아니다.
- CLI 내부 재시도는 제어한 turn 수와 다르며, 실패 시 소비량은 미확인일 수 있다. 구독 잔여량을 추정하지 않는다.
- 외부 취소는 전파해 provider의 프로세스 종료 경로를 실행한다. 취소를 완료로 저장하지 않는다.
- 매번 새 `output/recritique/<run-id>/`에 JSON/Markdown을 저장한다. 디렉터리 0700/파일 0600, 기존 파일 덮어쓰기 없음.
  결과 파일은 원문·사용자 검토를 포함하므로 기밀자료처럼 취급한다. 중간 파일 쓰기 오류 시 일부 출력이 남을 수 있다.

`field-recritique/1`은 전체 검토 내용 hash, 원본 검토 파일 hash, PDF hash, 요청/프롬프트 hash를 포함한다.
값이 같아도 사용자 확인 이력을 한 번 더 남기면 다른 검토 버전이다. 새 AI 의견은 `critique/model_findings`,
규칙 검사와 사용자 이력/과거 AI 결과는 `revalidation` 아래 보존한다. 중첩된 규칙 결과의 `critique_status=NOT_RERUN`은
그 규칙 검사 단계 자체의 상태이며 새 실행 상태는 최상위 `status`로 구분한다.

`COMPLETED`는 형식·참조가 유효한 모델 응답을 받았다는 뜻이다. 인용 의미의 옳음, 독립 전문가 평가,
실제 검토자 진위, 문서 전체의 해석, 임상·설계 결론을 인증하지 않는다. 같은 모델 반복 의견은 독립 리뷰가 아니다.

## 검사와 다음 단계

신규 28개 테스트: 현재/원래 값 분리, 모델 보류/비교 제한 구분, 사용자 보류 유지, 원문/이력 오류,
예산/시간 초과/취소, 스키마·참조 오류, 안전한 실패 메시지, 버전 hash, 파일 권한/덮어쓰기 방지, CLI 명시적 실행 선택.
전체 Python 322개와 웹 250개 회귀 검사, 웹↔Python 계약 왕복, Ruff/format/diff 검사 통과.
브라우저 UI는 이번 단계에서 수정하지 않았고 브라우저 QA·배포는 하지 않았다.

실제 Codex 단일 실행(합성 텍스트·PDF 바이트 계약 fixture, 실제 임상 PDF 아님):
`aa82b1fd-6e4d-4721-ae4f-07638db45909`, `COMPLETED`, 입력 11,000/출력 385토큰, 1 CLI turn.
사용자가 보류한 obs-0은 제외하고 obs-1/2/3을 초안으로 유지했다. 비교 제한 의견 2개와 질문 4개를 기록했다.
모델은 제외된 관측값 복원 없이 반응 비교 근거 부족과 가상 용량/정의 표지의 한계를 지적했다.
원래 사용자 보류 상태와 과거 스크립트 모델 기록의 보존을 확인했다. 모델 임상 정확도·반복 안정성 실증은 아니다.
결과: `output/recritique/aa82b1fd-6e4d-4721-ae4f-07638db45909/report.json` 및 Markdown.
현재 Codex 로그인만 사용했으며 개인 API·대회 API는 사용하지 않았다.

다음은 이 결과를 현재 PDF/검토 이력과 대조해 화면에 표시하고, 새 AI 쟁점에서 해당 관측값·원문으로 돌아가는 흐름이다.
AI 의견을 규칙 검사나 사용자 판단과 섞지 않고, 추가 편집 시 이전 의견을 현재 결과로 표시하지 않아야 한다.
