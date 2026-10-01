# 서버 준비 PDF 검토 계약 (C3B2 v1)

개인 개발 계정, 실제 외부 호출0/합성 parser·provider만 시험한다. 기존 browser-text automation/run 차단과 macOS UNSUPPORTED_SANDBOX는 유지한다. PDF 좌표/OCR/수치 검증/임상 검증을 추가하지 않는다.

## C3B1 재개용 읽기 metadata

- `GET /api/research/pdf-preparation-capabilities`: `{schema:"research-pdf-preparation-capabilities/1", status:"RUNTIME_CHECK_REQUIRED"|"UNSUPPORTED_SANDBOX", limits:{max_pdf_bytes:5000000,max_pages:10,max_text_chars:30000,wall_seconds:5,cpu_seconds:2,memory_bytes:536870912,max_output_bytes:200000}}`. 기존 preparation LIMITS와 동일하다. Linux도 실제 각 실행의 hard-limit 검증 전 성공을 보장하지 않는다. TEAM 인증 필요, 모델/파서/DB 쓰기0.
- `GET /api/research/runs/{run_id}/documents/{source_id}/pdf-preparations?source_digest=...&pdf_sha256=...`: `{schema:"research-pdf-preparation-list/1",run_id,source_id,source_digest,pdf_sha256,preparations:[{preparation_id,preparation_digest,created_at,page_count}]}`. 정확 source/PDF와 현재 original_storage ALLOW를 같은 읽기 snapshot에서 확인. 최대 최신30개 반환, 조회대상 총1000개 초과422, 본문/URL0. UUID/digest로 기존 GET 원문 준비 조회 가능.

## REVIEW-only 전용 경로

- `POST /api/research/runs/{run_id}/review-prepared-pdf`: 정확 필드 `{model_consent:true,preparation_id:<UUID>,preparation_digest:<sha256>,policy_revision:<현재 PDF_BYTES revision 1..100>}`. 추가필드/임의본문/비엄격bool 거부, 요청 max8192bytes. 준비 당시 revision과 현재 전송 revision은 다를 수 있다(준비 후 external_ai 명시허용 정상경로).
- `GET /api/research/runs/{run_id}/pdf-review-attempts?preparation_id=<UUID>`: 필수 준비 UUID query. `{run_id,preparation_id,attempts:[{attempt_id,run_id,status,created_at,completed_at,model_calls}]}` 해당 준비만 최신30개, metadata 수준, 본문0. 선택준비가 다른팀/다른run이면404. 원문저장권리철회 뒤에도 metadata는 접근 가능하며 실제결과 GET은 현재권리검사.
- `GET /api/research/runs/{run_id}/pdf-review-attempts/{attempt_id}`: 아래 artifact. 정확 source/PDF/preparation 해시와 현재 original_storage ALLOW 확인. 과거 결과 GET에는 external_ai 재허가를 요구하지 않으며 새 전송은 반드시 요구한다.
- `GET /api/research/runs/{run_id}/pdf-review-usage`: 기존 saved review usage와 같은 counts/usage_by_mode, 단 schema=`research-pdf-review-usage/1`, scope=`PREPARED_PDF_REVIEW_ONLY`. 별도 attempt 테이블만 집계, start+terminal 중복0, max10000행, unknown/시험모드 분리. 기존 SOURCE_TEXT 사용량에 섞지 않는다.

POST는 실제 세션/팀/role(admin 또는 reviewer) 확인 후 exact 준비artifact/PDF/source, original_storage+external_ai ALLOW, 현재 요청 revision 검증. 같은 검증을 provider factory 전/실호출 직전/응답 후/게시 전 반복한다. provider는 lazy DACON_RESPONSES 또는 SCRIPTED_TEST_DOUBLE만, 최대1call/180초/출력2500token. Collection 및 preparation 불변, 별도 append-only start/terminal 기록. 작업중 프로세스 강제종료는 RUNNING 종료미확정으로 남고 자동재실행하지 않는다.

SSE 필드 정확히 `{schema:"research-pdf-review-event/1",run_id,attempt_id,sequence,type,message}`. STARTED/1 후 COMPLETE 또는 FAILED/2, heartbeat는 comment. 본문/제목/인용 전송0. 실패·취소도 metadata 이력에 보존.

## 저장 artifact

정확 root: `schema:"research-pdf-review/1",mode:"PREPARED_PDF_REVIEW_ONLY",run_id,attempt_id,status,created_at,completed_at,asserted_by,preparation_id,preparation_digest,source_id,source_digest,pdf_sha256,policy_revision,model_calls,execution_mode,model,response_id,input_tokens,output_tokens,review,error_code,notices`.

status RUNNING/COMPLETED/FAILED/CANCELLED, execution_mode COLLECTORS_ONLY/DACON_RESPONSES/SCRIPTED_TEST_DOUBLE. 최초/관측불명 tokens null, 모델실호출0이면 COLLECTORS_ONLY. review null 또는 `{findings:[{anchor_id,page,start,end,quote,interpretation}],questions:[string],conclusion:"NEEDS_EXPERT_REVIEW"|"INSUFFICIENT_EVIDENCE"}`. findings max12/questions max6, interpretation max1400/questions max700. FAILED error_code는 MODEL_POLICY_DENIED/MODEL_FAILED/MODEL_RESPONSE_REJECTED/CANCELLED 중 하나, 정상 null.

## 인용/모델 payload

서버가 준비 pages를 page별 최대1000 Unicode code point 구간으로 나누며 공백뿐인 구간 제외, max40 anchors. anchor_id는 준비digest/page/start/end의 sha256으로 결정. start/end는 Python Unicode code point 반열림 범위이며 UTF-16 offset/좌표가 아니다. quote는 서버가 원문 slice를 복사한다. 모델은 anchor_id와 interpretation만 반환하며 임의 quote/page/offset은 허용하지 않는다.

모델 payload 정확히 `{preparation_id,preparation_digest,pdf_sha256,segments:[{anchor_id,page,start,end,text}]}`. 사용자 query/브라우저 text/Collection SOURCE_TEXT/raw/PDF bytes 포함0. 서버 response schema는 정확anchor enum/추가필드금지/개수·길이 제한, unknown/중복anchor 거부. 본문은 신뢰할 수 없는 자료이며 그 안의 지시를 따르지 않도록 명시한다.
