# 연구 PDF_BYTES 이용조건 계약 v1

C3A: TEAM PDF 다운로드·저장·캐시조회 권리. SOURCE_TEXT와 완전히 별도이며 PDF 자동화 외부모델 전송 C3B는 계속403 차단한다. 공개 URL만으로 허가를 추정하지 않는다. 아래는 부모 UI/자식 backend 공유 확정 계약이다.

## Metadata / 정책

- GET `/api/research/runs/{run_id}/pdf-metadata`
- GET/POST `/api/research/runs/{run_id}/documents/{source_id}/usage-policy`
- GET query는 `source_digest`와 `pdf_sha256`, 둘 다64 lowercasehex 필수.
- 모든 새 API는 TEAM 전용, legacy404. 기존 인증/CSRF 적용. metadata/이력은viewer도 가능, 정책변경·새다운로드는현재run owner/admin만. 신규수집owner없는legacyrun은admin만 관리.

metadata 정확필드: `{run_id,resource_kind:'PDF_BYTES',can_manage,sources}`. sources는최대500, 각항목정확필드 `{source_id,source_digest,title,download_available,cached_versions}`. cached_versions최대100개, 정확필드 `{pdf_sha256,byte_length,binding_status,usage_policy}`. binding_status=`EXACT` 또는 `LEGACY_UNBOUND`. source text/PDFbytes/원본URL을 metadata에 넣지 않는다. download_available은현재source에 pdf_url이있다는 뜻일뿐허가가아니다. 기존receipt는sourceDigest가없으므로LEGACY_UNBOUND/UNKNOWN; 사용자명시정책진술전에ALLOW/정확binding으로자동이전하지않는다.

policy 정확필드: `{resource_kind:'PDF_BYTES',run_id,source_id,source_digest,pdf_sha256,policy_revision,original_storage,internal_search,external_ai,training,evidence_reference,reason,asserted_by,created_at,verification}`. 네목적은ALLOW/DENY/UNKNOWN. UNKNOWN초기 revision0/evidence·reason·subject·time=null/verification=`UNVERIFIED`; 실제진술revision1..100/verification=`USER_ATTESTED_UNVERIFIED`, asserted_by인증subjectUUID,UTC시간. 근거/사유는기존source정책과같은1..2000/1..4000자(공백금지). 사용자의진술이지법적검증완료가아니다.

GET/POST응답정확필드 `{current,history,can_manage}`. history최근먼저최대100개. POST엄격본문: `{source_digest,pdf_sha256,expected_policy_revision,original_storage,internal_search,external_ai,training,evidence_reference,reason}`. expected_policy_revision정수0..100(bool거부),추가필드거부. 정확sourceDigest와receipt/pdfSha검증, CAS409는입력보존후재조회; 자동최신버전재연결없음. 기존LEGACY_UNBOUND bytes도명시정책진술시현재sourceDigest에결속하되SOURCE_TEXT정책재사용없음. 네목적을기록하나C3A에서실제집행은original_storage만이며external_ai기록만으로자동화실행이열리지않는다.

## 다운로드 / 캐시

기존 POST `/api/research/runs/{run_id}/documents/{source_id}`의새TEAM요청:

```json
{"consent":true,"source_digest":"64 lowercasehex","storage_permission":{"original_storage":"ALLOW","evidence_reference":"근거","reason":"이번 URL에서 받는 PDF 저장이 허용된 근거와 사유"}}
```

strict실제true만,추가필드없음. evidence/reason위정책범위동일. 네트워크전현재run/sourceDigest/pdf_url과실세션·owner/admin을확인한다. 다운로드후같은source/url/세션/역할을재확인한다. 정확수신sha256 PDF_BYTES버전에만사용자가명시한original_storage ALLOW revision1을저장하며internal_search/external_ai/training은UNKNOWN이다. 허가진술없이새네트워크호출0. 기존정책DENY/철회를이요청으로덮어쓰지않고409/403후정책관리화면으로안내한다. 이미cache존재하면새다운로드/자동권리상승없음.

기존 `{consent:true}`는현재정확binding의original_storage ALLOW인cachehit만허용한다. 새다운로드나권리미확정cache는403/409와다음조치코드를준다. 여러cached버전은암묵선택하지않고409 `PDF_VERSION_SELECTION_REQUIRED`; 사용자가exactsha GET을선택한다. 정상응답기존application/pdf + X-Source-Sha256/Cache(no-store) 유지. GET cached의sha256은필수이며현재sourceDigest의정확receipt/policy original_storage ALLOW+bytes길이/sha검사를같은snapshot으로수행한다.

오류: 다른팀/없음404,권리/관리권한403,source/policy/version충돌409,계약422,공통초과413/Content-Type415/세션401. 다운로드권리입력누락409 `PDF_STORAGE_PERMISSION_REQUIRED`; cached권리차단403 `PDF_STORAGE_NOT_ALLOWED`; 구receipt정확결속누락403 `PDF_BINDING_REQUIRED`. 고정코드와UI한국어다음조치안내로대응한다. 실네트워크/실API시험없음.

자동화read/prepare는저장된PDF의exactsha권리검사도적용한다. 실제모델run은C3B까지403이며브라우저추출텍스트의원본진실성은여전히검증완료가아니다. 일반rawcollector/모든원자적동시철회보장/실DB자동마이그레이션은범위밖이다.
