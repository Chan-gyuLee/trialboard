# RAW_SNAPSHOT R1 계약 / R2 후속 제안

## 2026-10-01 R2 채택 계약

R1 조회/파생/전송 교집합 연결 뒤 R2를 구현했다. `ResearchRequest.raw_storage_permissions`는 optional/default `[]`, 최대3·collector중복금지다. 각 exact object는 `{collector:REGISTRY|LITERATURE|REGULATORY,original_storage:"ALLOW",evidence_reference:string(1..2000),reason:string(1..4000)}`이며 공백만/추가필드는 거절한다. TEAM의 없는수집기허가는 네트워크0/coverage SKIPPED+GAP 사유, legacy loopback은 이전경로다.

수집전/응답후/저장transaction에서 실제session·role·team·run owner/admin·불변ResearchRequest를 재검증한다. 응답strictJSON duplicate/nonfinite/object검증(공유registry decoder포함), registryNCT일치/문헌·규제응답구조 검증 후 canonicalSHA·실permission·요청query·asserted_by·시각의 append-only `research_raw_captures`를 snapshot과 함께 저장한다. 개별5MB/실행고유합25MB/고유100raw 상한. 초기scout EvidenceStore의권리모델은 여전히 별도미구현이며 이단계는 공유JSON decoder검증만 강화한다.

실제 수집에서 서버가 만든source provenance는 append-only `research_source_provenance`로 request SHA·source digest·fetched_at·link_basis·rawrefs·capture receipts에 결속한다. 공통 검증은 global canonical source본문과 run-specific provenance를 구분하되 SQL research_links와rawrefs를 정확히 비교한다. 같은content의 반복run/다중query는허용, 다른content가같은sourceID로수집중변경되면합치지않고실패한다. 기존receipt없는데이터는엄격기존binding을유지하고 자동이관·자동허가0.

새 exact source/raw key에는 사전진술의 original_storage만 revision1 ALLOW로 기록한다. internal_search/external_ai/training UNKNOWN, SOURCE_TEXT/PDF_BYTES 자동허가0; 이미존재하는RAW정책은DENY포함절대덮지않는다. registry posted-results는허가된새response만 순수함수변환하여SOURCE UNKNOWN격리저장하므로모델/stream본문노출0. 정상흐름은수집→metadata→SOURCE+RAW권리명시→저장자료1call검토이며합성fake provider로검증한다. direct TEAM ResearchStore.snapshot은receipt없는쓰기차단, legacyPath테스트저장은보존한다.

아래 초기R1/R2설명은 구현전감사이력이다.

R1 metadata/CAS/공통reader는 부모 승인으로 구현 진행한다. 파생/publication 게이트와 R2는 후속 묶음이며 이 문서만으로 RAW정책 집행완료를 뜻하지 않는다.

## 확인한 경로와 최소 순서

`collect.registry/literature/regulatory → ResearchStore.snapshot(data) → snapshots(digest,raw)`는 현재 run/수집대상/권리입력 없이 저장한다. registry는 NCT일치검사보다 저장이 먼저다. `registry_results`는 수집직후·result-tables API·exploration.create·automation.prepare에서 공통으로 사용된다. 기존 exploration/automation 저장결과는 이 함수를 다시 호출하지 않고도 반환될 수 있어 공통 raw-reader만 바꾸면 우회가 남는다. SOURCE_TEXT fullread/FTS/저장재검토/AI PLAN·REVIEW에도 raw-derived본문이 존재한다.

중요: Source.digest는 raw_snapshots를 제외해 계산하고 add_source는 raw_snapshots를 병합한다. 따라서 raw허가를source digest하나에뭉뚱그리거나 공유snapshot내용hash만으로다른run/source에승격하면안된다. 정확키는 `(run_id,source_id,source_digest,snapshot_digest)`이며 현재Collection/출처결속과해당 raw_snapshots 소속까지검증해야한다. PDF_BYTES 허가/전송은 별개이고 PDF준비 전용모델payload에는 registry원문이없으므로 RAW 허가를 PDF허가로 재사용하지 않는다.

## R1 제안: 기존 저장 RAW의 명시허가·조회/파생 경계 (15분씩 분할 가능)

첫 묶음 API경로/response는 아래그대로고정한다. `usage_policy`와 history/current의정확필드는 `{resource_kind:"RAW_SNAPSHOT",run_id,source_id,source_digest,snapshot_digest,policy_revision,original_storage,internal_search,external_ai,training,evidence_reference,reason,asserted_by,created_at,verification}`. 목적4개는 UNKNOWN/DENY/ALLOW. 최초revision0은 모든목적UNKNOWN/나머지진술필드null/verification UNVERIFIED. revision1..100은 비어있지않은evidence/reference(reason포함),실제주체UUID/UTC시간/verification USER_ATTESTED_UNVERIFIED. 기존자료자동ALLOW0.

고정한도: raw JSON UTF-8저장bytes 최대5,000,000, top-level object만허용/중복JSON키·nonfinite숫자거부/canonicalSHA256일치. sources500/출처당raw refs100/run전체bindings1000/history100/policyrevision100; 초과를잘라성공처리하지않고422. evidence_reference1..2000/reason1..4000(공백금지), revision strictint(bool금지),digest64lowerhex,request추가필드금지. 한도숫자별도응답root필드는추가하지않는다. 목록/정책조회는원문·URL·JSONvalue0,metadata만반환하며현재권리가UNKNOWN/DENY여도관리진입은가능하다.

부모보안검수 반영: 동일요청/같은읽기transaction의 동일snapshot SHA는한번만parse/cache한다. 요청의고유raw UTF-8bytes합계 **25,000,000** 초과는본문적재전에422 `RAW_SNAPSHOT_TOTAL_SIZE_LIMIT`. RawReadContext는한run/하나의열린transaction에서sources검증도한번만하며transaction을넘겨재사용하지않는다. policy created_at은실제유효UTC ISO8601(Z또는+00:00)이며 revision history는1부터현재까지연속/시간역행없이검증한다. 응답root/usage_policy 필드추가는없다.

- `GET /api/research/runs/{run_id}/raw-metadata`: 정확root `{run_id,resource_kind:"RAW_SNAPSHOT",can_manage,sources:[{source_id,source_digest,title,snapshots:[{snapshot_digest,byte_length,usage_policy}]}]}`. 본문/JSON값/URL0, readonly, max500sources/출처당100snapshot·run전체1000binding 조회상한. 없는원본은404/변조409(임의추정size0 없음).
- `GET /api/research/runs/{run_id}/sources/{source_id}/raw-usage-policy?source_digest=...&snapshot_digest=...`: `{current,history,can_manage}`.
- 같은path `POST`: `{source_digest,snapshot_digest,expected_policy_revision,original_storage,internal_search,external_ai,training,evidence_reference,reason}`. 목적 enum UNKNOWN/DENY/ALLOW,revision0..100/CAS409,실세션owner/admin,append-only정책·exactbinding. 기존raw는UNKNOWN자동이관0. evidence max2000/reason4000,추가필드금지.
- 새 `raw_policy.py`의 같은con 검사/권리reader를 `registry_results`에 연결. raw bytes는canonical JSON SHA일치·크기상한 검사 후에만 파생한다. 기존 fullread/FTS/파생artifactGET와 SOURCE_TEXT outgoing에도 실제 raw dependencies의현재권리를 각각 교집합 검사한다. 원문접근 original_storage,검색은추가internal_search,전송은추가external_ai. revision핀/철회/교차팀/원본변조/readonly를합성검증한다. source자체정책과RAW정책을둘다확인하고자동승격하지않는다.

R1 정상경로는 **기존저장raw metadata → owner/admin 정확버전허가 → 결과표/파생자료 접근·별도SOURCE_TEXT권리와함께검토재개**다. 기존데이터삭제/실DB마이그레이션0. R1만끝내고신규raw저장권리까지완료했다고말하지않는다. 위파생/publication경계가한묶음에크면metadata/CAS+reader까지만체크포인트하고나머지연결을다음묶음으로명시한다.

## R2 필수 후속: 신규 수집의 사전 저장 허가 정상경로

새 ResearchRequest의 명시 `raw_storage_permissions`를 collector별 scope(REGISTRY/LITERATURE/REGULATORY)에 제한하고 `original_storage:"ALLOW",evidence_reference,reason`만 받는다. 공개URL/public_consent만으로허가추론0. UI선택 scope만 실행하고 없는scope는네트워크0/명확안내. 서버가고정허용endpoint·실제run/search/nct/asset/현재auth에결속한capture receipt를생성한다. fetch전후세션/역할/동일수집대상확인→응답구조/registry NCT검증→bounded canonicalJSON→실제SHA와저장ONLY 허가를한transaction으로저장한다.

공유응답의정확source bindings는서버가해당capture receipt와유도한sources를결속할때만생성한다. 다른run/source로허가전파0,internal_search/external_ai/training은UNKNOWN. 네트워크결과받기전엔SHA가없으므로사전진술과사후exactdigest receipt를별도기록한다. direct snapshot()에run/receipt없이TEAM저장하는우회는failclosed,legacy는기존호환. 별도소비자(초기scout EvidenceStore 등)는확인된범위밖으로정직히남긴다.

R2는새수집→명시저장→metadata허가→저장자료재검토의실제정상연결까지함께검증해야한다. 단순신규수집차단만으로RAW정책완료를주장하지않는다. 모든검증은fake collector/provider+임시DB,실네트워크/실모델0.
