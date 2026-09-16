# 근거 연결 설계 비교 · 첫 실행 단계

2026-09-14. 팀 피드백을 반영해 통합 보고서보다 **검토 근거 → 복수 설계안 → 시뮬레이션 → KOL 의제** 연결을 우선한다.
최초 로컬 Python 엔진/CLI에 이어 [설계 편집·비교·KOL 회의 UI와 opt-in 로컬 계산](DESIGN_WORKSPACE.md)을 연결했다.
완성된 프로토콜 생성은 아직 아니다. 아래 초기 수치 예는 첫 엔진 구현 당시의 기록이다.

## 구현 범위

- 같은 PDF/검토 버전의 관측값을 사용자가 용량군에 명시적으로 연결한다.
- 2–4개 용량군, 표본수가 서로 다른 2–4개 고정 균등배정 설계안, 1–6개 가정 시나리오를 비교한다.
- 계획 표본수·설계 사유·반응/이상반응 확률·효용 가중치·가정한 이상반응 한계는 사용자 입력이다.
  원문 관측 비율을 미래 시험의 참확률로 자동 추정하거나 보고 비율에서 사건 수를 역산하지 않는다.
- 사용자 보류/미확인·규칙 제외·잘못된 용량 연결·평가변수 누락·비교 문맥 불일치가 있으면 계산을 중단한다.
  설계안과 선결 KOL 질문은 남기며 없는 근거를 시나리오로 채웠다고 표시하지 않는다.
- AI 재검토 파일을 제공하면 현재 검토/규칙 입력과 다시 대조한다. AI 관측값 오류와 관련 비교 제한은 계산을 막는다.
  AI 파일이 없으면 `NOT_SUPPLIED`로 명시한다. 다른 파일을 자동 탐색하거나 이전 AI 의견을 추측해 재사용하지 않는다.
- 사용자가 입력한 첫 설계안을 기준으로 각 대안의 추가 모집 인원, 가정 규칙상 올바른 선택/보류 빈도,
  가정상 한계 초과 군 선택·선택 보류 빈도의 차이와 Monte Carlo 표준오차를 기록한다.
- 선결 근거 쟁점과 설계안별 모집 부담/계산 차이를 KOL 질문에 연결한다. 질문은 규칙 기반 미답변 의제다.

**제품이 임상 설계안을 권고하는 상태는 아니다.** 현재 대안들은 같은 군의 표본수만 바뀐다.
DROID/MERIT·적응형 배정·중간중단·검정력/제1종 오류·기간/탈락·결측·PK/PD·확정 프로토콜은 구현하지 않았다.
새 LLM 호출, 설계안 자동 최적화 또는 최종안 자동 선택을 추가한 것도 아니다.

## 실행

```bash
uv run python -m trialboard.agent.design_compare \
  --brief /path/to/design-brief.json \
  --review /path/to/trialboard-field-review.json \
  --source-export /path/to/pdf-evidence-review.json \
  --pdf /path/to/original.pdf \
  --agent-report /path/to/original-agent-report.json \
  --ai-review /path/to/current-recritique-report.json
```

수동으로 시작한 검토는 `--agent-report` 대신 `--asset --indication --study --question`을 지정한다.
`--ai-review`는 선택 사항이다. 제공한 파일이 과거 버전/실패 결과이면 무시하지 않고 오류로 종료한다.
대회 API·현재 Codex 사용량은 소비하지 않는다. 결과는 `output/design-comparison/<run-id>/report.json`과 Markdown이다.
입력 파일과 이전 실행은 덮어쓰지 않으며 디렉터리 0700/파일 0600을 사용한다. 결과에는 원문과 검토 이력이 포함된다.

### design-brief/1 입력 계약

| 필드 | 의미 |
| --- | --- |
| source_digest / review_content_digest | PDF hash와 전체 검토 JSON의 canonical SHA-256. 새 확인 이력도 새 버전이다. |
| question | 원래 검토 질문과 정확히 같아야 한다. |
| arms | id, 원문 용량 문자열 source_dose, 해당 관측값 observation_ids. 한 관측값을 여러 군에 연결하지 않는다. |
| plans | id, label, per_arm(2–500), rationale. 최소 2개, 서로 다른 표본수. 권장 표본수 아님. |
| scenarios | id, label, response/adverse_event 확률 배열, adverse_event_penalty, maximum_adverse_event_rate, rationale, provenance. |
| provenance | 시나리오별 `user_declared_hypothetical` 고정. 실자료 추정치라는 주장은 거부한다. |
| seed / repetitions | 고정 seed와 반복 수 100–20,000. 군×설계×시나리오×반복은 1,000,000 이하. |

확률 배열 순서는 arms 순서다. SHA는 이전 AI 재검토 결과의 `review_content_digest`를 재사용하거나
`trialboard.serialization.sha256_json`으로 현재 export 전체를 계산한다. sourceName/limitations도 검토 내용에 포함된다.
가정·표본수·사유를 정하지 않은 상태에 기본 임상 값을 채워 실행하지 않는다.

## 출력과 해석

`design-comparison/1`에는 brief/검토/엔진 hash, Python/NumPy 버전, 근거 관측값, 설계안,
시뮬레이션·설계 차이, blockers, KOL 질문, 원래 규칙 결과와 선택적으로 AI 기록이 포함된다.
항상 `clinical_approval=false`, `recommended_plan_id=null`, `model_calls=0`다.

`HYPOTHETICAL_COMPARISON_ONLY`는 근거 연결 검사를 통과해 선언된 가정으로 계산했다는 뜻이다.
`BLOCKED_EVIDENCE_LINK`는 선결 쟁점이 있어 계산하지 않았다는 뜻이며 실패한 계산을 0으로 채우지 않는다.
모든 군이 가정한 한계를 넘는 시나리오에서 ‘올바른 선택/보류’는 아무 군도 선택하지 않는 빈도다.
MC 오차는 모수 불확실성·임상 효과의 불확실성이나 검정력을 대신하지 않는다.
파일 내부 일관성과 AI 참조 검사도 실행 진위·원문 의미·임상 비교 가능성을 인증하지 않는다.

## 확인한 결과

신규 35개 / 전체 Python 357개 테스트 통과. 정상 2설계×2시나리오, 근거 보류, 문맥 불일치,
이력/hash 변경, AI 오류/비교 제한, 가정/예산 경계, 재현성, 입력 보존과 CLI 파일 권한을 검사했다.
합성 예제 500회에서 60명 추가 모집의 ‘올바른 선택/보류’ 차이는 plateau 가정 +0.8%p,
차이의 MC SE 약 2.8%p였다. 이 결과는 더 큰 설계가 우월하다는 근거가 아니라 가정/계산 오차를 보여주는 개발 예다.
일반 의제 6개+시나리오별 모집/빈도 차이 의제 2개, 총 8개의 미답변 KOL 질문을 생성했다.
실제 임상 문서·실제 KOL·최종 temporal 평가·브라우저 QA는 이번에 검증하지 않았다.

## 다음

입력/비교 화면과 KOL 메모·회의 패키지는 후속 구현했다. 설계 가정의 자동 수정 계보·프로젝트 저장은 아직 없다.
다음은 화면 실제 QA, 공개 문서 범위 확대·KOL/통계 검토와 제출 시연 패키지다.
개발 입력/규칙을 고정한 뒤 [시간 분할 최종 평가](TEMPORAL_EVALUATION.md)를 실행한다.
