# 개인 개발 C4 체크포인트 — 2026-10-01

사용자 최신 상한70%/68%부터작은묶음 정책을 AGENTS/SESSION_HANDOFF/NEXT_TASKS에서 확인했다. 시작 RPC1790836290 및1790836320 ChatGPT/codex 주간50%, secondary미제공/model_calls0. 대회 실API/별도모델CLI/추가agent/영상/실DB/배포/commit0 유지. 전체계획79±10%p 불변.

기존 저장 검토 lazy per-call gate/append-only SSE와 PDF 준비 exactsha·snapshot 권리검증 구조를 감사했다. 새 REVIEW-only 계약은 RESEARCH_PREPARED_PDF_REVIEW_CONTRACT_2026-10-01.md에 제안했으며 부모 범위 확정 전 제품코드 수정은 하지 않았다. 부모가 UI를 맡고 본인은 backend/tests/contracts만 담당한다.

## 첫 묶음: preparation metadata + PDF gate/anchor core

부모 계약 승인 후 `pdf_preparation.py`에 capabilities/목록과 같은con의 `decode_artifact`/`read_record`를 구현했다. capabilities는TEAM인증 필요, Linux RUNTIME_CHECK_REQUIRED/macOS UNSUPPORTED_SANDBOX를 구분하며 실제 hardlimit 성공을 보장하지 않는다. 목록은 exact source/PDF original_storage를 같은 읽기 snapshot에서 확인하고 본문 없이 최근30개 반환, run의 전체준비행1000개 초과422. 조회는 DB/파서/모델 쓰기0. persisted artifact의 정확root/schema/mode/UUID/rowbinding/protocol/digest를 검사한다. 기존 wrong-row-binding409 상세문구도 보존했다.

`prepared_pdf_review.py`는 아직 route에 연결되지 않은 검토 core다. 요청은 exact 준비 UUID/digest, 현재 PDF policy revision, strict consent만 받는다. 준비rev1 후 별도 external_ai 허가rev2를 정상지원한다. 실제 TeamIdentity·현재 context·team/role/session과 현재 storage+external_ai/정확source/PDFbytes/prep내용을 같은con으로 검증하며 LazyResearchProvider factory전/호출직전/응답후에 반복한다. 서버 준비문서만 최대40개의1000 Unicode codepoint 조각으로 만들어 실제인용을 서버복사한다. 모델은 알려진anchor ID만 선택하며 임의quote/offset/중복/알수없는anchor를 거부한다. 좌표/가짜span/OCR/수치·임상 검증은 없다.

수정 파일: `trialboard/research/pdf_preparation.py`, `trialboard/research/prepared_pdf_review.py`, `trialboard/api/research.py`, `trialboard/api/team_auth.py`, 새 `tests/test_pdf_preparation_metadata.py`/`tests/test_prepared_pdf_review.py`, 본 상태/계약문서. 부모 UI파일은 수정하지 않았다.

실제 검증: metadata7+gate17 신규24개, 기존 prep31/race4/PDF정책14/모델정책15/team_auth28를 합친 **116 passed, 기존경고2** (exec98311 exit0). Ruff 대상6파일 및 git diff --check 통과. 초기회귀에서 wrong-row-binding 상세문구가 integrity로 바뀐1실패를 확인해 제품호환문구를 복원하고 재통과했다. 준비rev1→전송rev2 positive fake1call, UNKNOWN/DENY/만료/viewer/다른team/source변경/bytes변조/revision변경/임의payload factory0, factory후철회request0/응답후철회결과차단, Unicodeemojioffset/서버quote 검증을 포함한다. 준비 성공은 합성 parser stub이며 실제Linux PDF 추출 성공 증거가 아니다.

마지막 RPC1790836845 주간52%, secondary미제공/model_calls0. 중간50→51→52 조회했고 일부 편집구간은60초 목표를 초과했으므로 실시간 상한준수 보장을 하지 않는다. 현재 서버 첫묶음 freeze. **다음 미완료**: 실제 review-prepared-pdf route/SSE/append-only attempts/권리GET/별도관측usage 연결. 기존 TEAM automation/run 모델403, macOS 실제추출미지원, RAW권리 미구현, 실대회API0 유지. 부모 독립검수 뒤 같은agent 후속묶음으로 진행한다.

## 두 번째 묶음: C3B2 전용 실행/이력/관측 사용량 연결

부모 첫묶음 독립검수/승인 뒤 `trialboard/api/prepared_pdf_review.py` 전용라우트를 추가하고 app/TEAM route 정책에 연결했다. 엄격8192byte 요청으로 서버준비 UUID/digest/현재PDFpolicy revision/명시동의만 받는다. 공통 모델slot, lazy Dacon 또는명시시험double, 최대1call/180초/출력2500token, 자동재시도0. 준비본문만 전송하며 기존 browser-text automation/run의403은 유지한다. factory전/호출직전/응답후/결과확정전 exact권리와실권한을 다시 검사한다.

`prepared_pdf_review.py`에 별도 append-only `research_pdf_review_records` start/terminal을 추가했다. SSE는 metadata6필드만 STARTED1→COMPLETE/FAILED2이며 원문/인용/제목0. 실패·취소도 observed calls/tokens만 기록, 공급자응답이없으면 해당토큰 null. start/terminal 쓰기실패에도slot해제; terminal 저장실패는SSE실패와종료미확정을알리고 원래RUNNING기록을 보존한다. 프로세스강제종료도 자동재실행하거나 호출0으로확정하지 않는다.

부모제안에따라 이력은 `pdf-review-attempts?preparation_id=<UUID>` 필수query/response root `{run_id,preparation_id,attempts}`로 확정했다. 다른준비이력을 섞지 않으며 최신30개metadata만 반환한다. 개별GET은 같은snapshot으로현재PDF저장허가/source/PDFbytes/prep결속을 검사하고 서버원문에서인용을다시구성해변조quote/page/offset을거부한다. external_ai철회는새전송차단이며 original_storage가허용된과거결과조회는유지한다. 저장허가철회시본문GET403,metadata/관측사용량은원문없이접근가능하다.

`review_usage.py` 집계엔진은 내부고정 SOURCE/PDF 종류로 schema/scope/table/binding만 분리해공유한다. 외부query로table을받지않으며 source계약/집계결과는변경하지않는다. PDF schema `research-pdf-review-usage/1`, scope PREPARED_PDF_REVIEW_ONLY, run전체PDF시도만 집계한다. start+terminal 중복0,미종결global별도,unknown토큰방향별표시,실제DACON/시험double/호출0분리,10000행한도/형식·binding불일치failclosed422. 비용/대회잔여quota/계정사용량추정0.

실제검증: 새 `tests/test_prepared_pdf_review_api.py` **30개**, 기존core17/metadata7/source usage17/source saved18/team_auth28/researchmodel15/workerdisabled1을 합쳐 **133 passed, 기존경고2**(exec75751 exit0). 별도 collect-only로개수를확인했다. 변경제품/시험Ruff 및diffcheck통과. 실제TEAM 임시fixture에서 정상1fakecall,preflight denial0,provider생성후철회request0,응답중session/role/source/bytes/policy철회게시0,취소·공급자실패토큰unknown,가짜인용거부,동시busy409후slot재사용,start/terminal쓰기실패후slot재사용,PDF/SOURCE집계분리·오염응답거부,다른팀knownid404/추가factory0를검증했다. 최초policy철회시험이동일TestClient이벤트루프재진입으로실패한1건은 실제권리모듈직접호출로합성시험구성만수정한후재통과했다.

최종 두번째묶음freeze: RPC1790837583 **주간55%**, secondary미제공/model_calls0 (시작52→53→54→55). 대회/개인대체API 실호출0,실제DB·영상·배포·commit변경0. C3B2정상경로는 합성parser+fakeprovider로 연결검증했으며 **현재macOS서버추출 미지원/실제Linux격리·추출성공/실대회런타임/임상검증은 여전히 미검증**이다. UI는부모가별도구현·검수중이며이서버체크포인트로UI완료를주장하지않는다. RAW권리·큐/OCR등은여전히범위밖미완료,전체계획79±10%p유지.

## RAW R1 첫 체크포인트: metadata/CAS/공통reader

부모승인후 `raw_policy.py`와 raw-metadata/raw-usage-policy GET/POST를추가했다. exact run/source/sourceDigest/rawsnapshotDigest·현재Collection/source_versions/research_links 소속·strictJSON/canonicalSHA를검증한다. UNKNOWN최초기본값,owner/admin실권한을write lock과본문검증뒤재확인,CAS/append-only/동일hash다른source·run허가전파0. 정책current/history형식15필드/유효UTC/연속revision·시간역행검사. body없음metadata readonly는DENY에서도관리진입가능하다.

부모감사반영: RawReadContext는동일run/열린transaction에서sources한번검증·고유SHA한번parse/cache,개별5MB·요청고유총25MB를본문적재전제한한다. sources500/refs100/runbinding1000/history100. 독립identityDB의권한회수를rawparse중일으킨시험도정책저장0으로차단했다. 이공통reader는아직기존파생/전송소비자에연결하지않은첫단계이며신규수집의사전권리R2도미완료다.

수정: raw_policy.py/research.py/team_auth.py, tests/test_research_raw_policy.py, RAW계약제안문서. 신규raw27+기존TEAM28/source7/PDFreview30 **92통과**(exec87355),이후권한회수검증1추가하여 raw **28통과**(exec64392). Ruff/diff통과. actualAPI합성JSON2source 공유SHA→metadata→ALLOW정상reader→DENY/CAS/role/다른team404/noDBcreation/동시CAS1승자/같은snapshot/변조/상한검증. 실API·실DB·모델0. RPC1790838507 주간58%,secondary미제공/model_calls0(시작56→57→58). 이제부모사전승인된 R1파생/전송교집합후속을별도검수묶음으로연결한다.

## RAW R1 연결 체크포인트

source_policy 공통같은con 게이트를 fullread/FTS에 연결하고 saved SOURCE_TEXT REVIEW 및 기존 ResearchModelGate에 실제raw dependency의storage/external권리와raw policy revision핀을추가했다. 선택저장검토는선택source raw만전송검사하고, 기존PLAN/REVIEW전체run문맥은기존보수적전체의존성검사를유지한다. 사용하지않는SOURCE/PDF허가로RAW를대체하지않으며prepared PDF모델은독립PDF자원경계를유지한다.

registry_results는TEAM현재run/출처/RAW를읽기전용같은snapshot에서검사하며파생표를만든다. SOURCE+RAW 게이트의RawReadContext를재사용해전체원본중복parse/25MB예산우회를없앴다. 저장exploration/automation/curation GET는권리검사와실제artifactSELECT를같은read-only transaction으로묶었고automation은PDFbytes검증도같은snapshot에서수행한다. exploration/automation/curation쓰기및recover반환도실제write transaction에서내용권리/버전검사한다. legacy동작은기존경로를보존했다.

검증: 기존권리/auth/모델96통과, 신규gate6+legacy결과표·exploration·automation43=49통과, 관련통합 **145통과**(exec33675). 이후기존PLAN raw revision pin·cached automation RAW/PDF교집합2추가하여 gate **8통과**(exec31154). Ruff/diff통과. 새시험은SOURCE허가만으로raw fullread/FTS/resulttable차단→각목적명시ALLOW정상경로,선택source만저장review1fakecall,raw철회/같은ALLOW새revision/원본변조시결과게시0,캐시파생물snapshot일관성/readonly,RAW철회cachedGET403을포함한다. RPC1790839139 주간60%,secondary미제공/model_calls0. 부모전체검수대기/제품서버freeze.

R2미완료경계(아래후속으로대체): 수집원본의사전저장권리와fetch전후실권한은이시점연결전이었다. 초기registry의in-memory새run과strict저장조회충돌·반복수집provenance문제를발견하고부모승인R2로이관했다.

## R2 사전 저장 허가 / 정상 수집→정책→검토 연결

부모승인15분묶음. 신규 `raw_capture.py` 요청별guard/append-onlycapture, `source_binding.py` canonical본문과run provenance구분. models optional raw_storage_permissions, store receipt없는TEAMsnapshot금지·save_run단일transaction provenance+storage assertion, collector별fetch전후실auth/request/role검사,새registry결과표순수변환, API요청전용store/권한철회시metadataERROR종료. raw/pdf/saved source공통검증을같은helper로연결. `api/scout.py`는권리범위확장아닌strictJSON decoder검증만변경했다.

사용률 RPC1790839400=62%,9459=62%,9523=62%,9622=62%,9678=63%,9727=63%,9812=63%,9851=64%,9916=64%;secondary없음/읽기모델0. 일부편집구간약90초조회간격으로목표60초초과가있었고하드상한보장은주장하지않는다. 사용자최신70상한/68작은단위유지. 실API/실DB/영상/배포/commit/추가agent0.

실제검증: 최초R2신규12중11통과/1SKIPPED SSE사유누락실패→GAP명확사유수정. 이후새19tests통과(exec43975):없음network0,명시3수집기exactRAWstorage1+다른권리UNKNOWN,동일paper다중query/반복run정상,posted-results생성보존,raw추가/삭제+link/time변조409,실sessionfetch후철회raw0/stream종료,request엄격검증,실mockHTTP duplicate/nonfinite/nonobject거절6,수집후SOURCE+모든RAW전송명시→fake1call+서버인용GET정상. 통합12파일220pass(exec86695)/legacyresearch·pagination·scout+새tests74pass(exec73088);2기존경고. 후속role/request철회2시험추가후새21pass(exec30594),Ruff전체/diffclean. 마지막RPC1790840014=64%. 단일통합실행220+추가개별시험이며현재collected229를별도실행229pass로과장하지않는다. freeze후취소분기도공유store→권리guard있는run_store로바꾸어철회시새저장0/기존미확정기록보존하도록좁게보정했다.

한계: 초기scout EvidenceStore사전저장권리별도미구현; 실제외부허가적법성/실Dacon/실Linux PDF/운영·임상검증미완료. 사전진술은사용자진술일뿐법적검증아님. SOURCE_TEXT/PDF허가자동승격0. 강제프로세스중단미확정기록/예약큐/OCR등기존남은범위보존. 전체79±10%p추정유지.

취소최종회귀: `test_stream_cancellation_preserves_fresh_write_authority[False/True]`는실route StreamingResponse 첫SSE→가짜collector대기→iterator.aclose로정상취소CANCELLED저장/실session철회후취소기존RUNNING유지를검증했다. 초기test직접호출mock의Origin포트와헤더대소문자오류2회실패수정(제품인증완화0). 단독2pass(exec56726),최종신규23전체pass(exec47815),직전model+capture36pass(exec72830),Ruff전체/diffclean. 마지막RPC1790840201 주간65%,secondary없음/읽기모델0. R2서버freeze후부모독립fullPython/실API→TS/웹검수로인계했다.

## 초기 Evidence Scout 읽기감사와 승인된 좁은 결함수정

읽기감사(제품수정전) 임시TEAM+fakefetch 진단exec33bbcd: POST중session철회후에도COMPLETE/검색1건저장·본문publication,정확NCT00000002요청에NCT00000001응답수락,raw변조후receipt반환을실제로재현했다. 실제네트워크0. 부모승인으로 `api/scout.py`, `api/app.py`만좁게보완하고 `tests/test_scout_integrity.py`를추가했다. frontend scout엄격reader는부모소유다.

현재public_query_confirmed는검색어외부CT.gov전송과정규화결과·원본JSON의로컬저장동의이며,공개·허가·비민감자료임을자동증명하지않는다. 단어regex는기밀/개인정보판별기가아니다. 초기scout에는research RAW와독립된정책/CAS/원본이용조건관리모델이아직없다. GET searches metadata 및GET receipt/NDJSON COMPLETE의정규화study본문은team역할·freshsession으로통제하지만resource original_storage/internal_search/external_ai정책으로통제하지않는다. 새권리자동ALLOW0/기존public_query_confirmed계약유지.

수정: TEAM POST fetch전후/저장thread전/동일쓰기transaction전후/COMPLETE직전실identity재검증,GET history·receipt는await read전후실identity검증. originalviewer조회허용/쓰기금지유지. NCT검색결과exact일치검사. 신규save는rawcanonicalSHA+receiptcanonicalSHA를append-only search_receipt_integrity에기록하고저장전·조회때SQL id/time/digest결속까지확인. 조회는read-onlyBEGIN/없는DB생성0/개별raw·receipt5MB한도. hash없는기존receipt는rawSHA·SQL결속·normalize rows·total/fetched/truncated/mode/source/clinicalfalse와query형식을검사한다. **기존hash없는원래query문자열은별도원본증거가없어완전복원·동일성증명불가**하며자동으로새허가를부여하지않는다.

기존scout1차회귀중saveclosure가sibling stream지역data를참조한NameError발견→save(data,rows)로수정. 그후신규11+기존scout19+R2 23=53pass(exec63405). GET동시철회/legacy계산필드부정시험추가후87pass/2실패(exec16373)는새fixture TEAM디렉터리755문제였고fixture를700으로수정(제품경계완화0),최종89회귀재실행중. RPC1790840439=65%,0473=66%,0607=66%,0641=66%,0766=67%,0806=67%,0836=67%. 68부터새범위없이검증·기록만,70또는조회실패중단.

최소후속(미구현): scout별resource/사전저장진술/metadata·CAS·owner/실receiptDigest정책정의→fullreceipt/NDJSON본문gate→ResearchStore.start·ProjectStore._validate_context·복귀reader의exactreceipt연결집행. 권리승격은research RAW와독립. scoutraw/전체study본문을모델로자동보내는직접경로는이번감사에서찾지못했다. 모델context의asset/indication/study는receipt선택값/사용자입력에서복사되므로메타데이터사용범위정의와pin검토는후속필요하다. PDF모델은별도project/PDF gate,REVIEW본문은SOURCE+RAW gate를유지한다. 초기scout정책없는것을researchgate구현완료와동일시하지않는다.

최종체크포인트: `tests/test_scout_integrity.py`19 +기존scout19+R2capture23+team_auth28 = **89개 모두통과**(exec75521 exit0,기존경고2),Ruff대상3파일/diffclean. 마지막RPC1790840904 ChatGPT/codex주간68%,secondary미제공/읽기모델0. 부모요청대로새작업없이이기록후자식종료;제품코드freeze,부모최종full회귀·handoff진행. 실네트워크/실모델/실DB/영상/배포/commit0,전체추정79±10%p유지. 본문권리는새로완성한것이아닌위에명시한별도후속이다.
