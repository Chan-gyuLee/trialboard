# 저장 검토 다음 행동 연결 — 읽기 전용 계약

GET `/api/research/runs/{run_id}/review-attempts/{attempt_id}/handoff`.
TEAM 전용, 현재 조회 역할(admin/reviewer/viewer)과 실세션 검증. 모델/수집/DB쓰기0.

정확 root:

```text
schema: "research-saved-review-handoff/1"
run_id: UUID
attempt_id: UUID
artifact_digest: 기존 artifact 전체 canonical JSON SHA-256
context: {search_id, asset, indication, nct_id}
sources: [{source_id, source_digest, title, url, pdf_url, content_level}]
artifact: 기존 research-saved-review/1 전체 artifact
clinical_verified: false
```

sources는 기존 선택 bindings와 동일순서1..8개. title최대20000, URL최대2048·http/https·host필수·사용자정보금지, pdf_url은같은형식또는null. source text·미선택source·전체Collection·scout본문0. metadata URL은 위치이며 PDF다운로드/저장/전송허가가아니다. PDF 관련다음동작은기존PDF_BYTES게이트를사용한다.

COMPLETED만허용하며 RUNNING/FAILED/CANCELLED는409 SAVED_REVIEW_HANDOFF_NOT_READY. 없거나다른run/team은404. 현재선택SOURCE_TEXT+실RAW dependencies 원문권리없으면403,현재source digest/context/저장인용불일치는409,저장contract변조는422. 조회는당시전송정책revision을현재revision으로덮지않으며 external_ai철회만으로과거조회까지철회하지않는다. original_storage철회는차단한다.

같은read-only SQLite BEGIN에서row key·불변시도·현재context/선택source/RAW권리와인용anchor구간을확인한다. `search_id`는현재run request의검색receipt연결이며SOURCE provenance requestdigest가있는기록은그결속도검증한다. 구형artifact에search_id를새로기록한것처럼꾸미지않는다. 새임상수치·통계결과·PDFbox/OCR를만들지않고기존review findings/questions와서버복사인용만전달한다. 프런트는기존artifact엄격reader재사용+artifact_digest재계산으로결속한다.

사용처: 현재권리로다시불러온검토질문/KOL브리핑과선택원문위치안내. 문맥이동은새모델·PDF다운로드를자동실행하지않으며이미다운로드된로컬산출물의원격회수는불가능하다.
