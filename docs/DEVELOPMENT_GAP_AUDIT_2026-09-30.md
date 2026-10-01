# 개발 전용 현재 코드 감사

2026-09-30 대회 gpt-5.6-sol 읽기 전용 실행 완료. 원문: `output/dacon-worker/20260930-141928-d6c0af2a/result.md`. 감독이 주요 계약/생성/저장 경로를 독립 대조했다. 영상 및 기술명세 원본 수정 없음.

| 항목 | 현재 상태 / 코드 근거 |
|---|---|
| A 반대검색 | 부분. `research/models.py` SearchPlan 최대2문자열; `validation.py` 검색어 안전검사; `agent.py` 실제 실행/coverage 있으나 반대 intent/연결 없음 |
| B 질문긴급도 | 부분. 실제 엔진 `agent/design_compare.py`, 두 단계 priority만. `web/src/design-result.ts` strict 질문/trigger 재검증; `meeting-packet.ts` reportKey 결속. 점수/이유 없음 |
| C 영향조회 | 미구현. `research/store.py` source ID+digest/run/project 저장. research_links는 LINK_BASIS/RAW_SNAPSHOT 메타데이터이지 완전 의존성 그래프 아님. Source digest와 PDF 바이트 digest도 다름 |
| 새 약물 입력 | CSV/PDF 및 NCT 조사 존재, 전용 신약 dossier 구조화 없음 |
| Tabular 모델/최적용량 | 없음. `review/engine.py` 결정론적 가정 계산; `agent/design_compare.py` recommended_plan_id null |
| 합리적 불일치 자동판단 | 조건/원문 불일치 검출·차단까지만. 임상적 합리성 판단 아님 |
| 그래프 완전성 | 전체 graph/metric 없음 |
| 계정/권한/테넌트/협업 | 없음. local Origin 체크는 인증 아님 |
| 주기갱신/재시도큐 | 없음. 수동 refresh 및 명시 재실행 |
| 조건부 의미캐시/다문서병합 | 없음. 정확 PDF 바이트 캐시/ID 중복 제거만 |
| 한영 사전 | `agent/clinical.py` 소수 endpoint 정규화만 |
| 인용 감시 | `research/citations.py` ID/digest/offset/원문 일치, validation의 좁은 allocation 모순 검사. 일반 의미함의 검증 아님 |
| 타임슬립 | `api/projects.py` PDF/review/draft/meeting hash 결속 및 append revision 있음. 인증·전체 의존성 추적 아님 |

수용할 구현은 A/B/C뿐. A 2회 검색 예산/동의/기존저장본 보존, B 기존 결과/회의메모 reader와 명시 버전호환, C 동일 프로젝트·정확한 source 버전의 **저장된 직접 후보**로 범위를 한정한다. 자동 최신화/추천/임상 검증 주장은 하지 않는다.

감사 worker 자체는 테스트 미실행. 부모가 별도로 확인한 baseline: pytest725, 웹1011통과/1skip, ruff, TS/Vite 모두 종료0. 기존 경고 유지. 계획추정79%(±10%p) 유지.
