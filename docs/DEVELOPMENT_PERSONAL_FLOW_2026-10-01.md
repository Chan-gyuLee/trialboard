# 개인 개발 — 저장 검토 다음 행동 연결

2026-10-01 사용자80% 승인,78부터작은마무리/80또는조회실패중단. 기존개인agent1만재개,부모UI/독립검수,자식backend·tests·본상태문서. 배포·도메인찬규별도. 실Dacon/외부API·실DB·영상·commit·추가agent0. 전체계획79±10%p유지.

## 첫 10분 묶음: 선택 검토 handoff

- 계약: `RESEARCH_SAVED_REVIEW_HANDOFF_CONTRACT_2026-10-01.md`,부모승인후구현.
- 새 `trialboard/research/saved_review_handoff.py`: COMPLETED append-only시도phase0/1·SQLkey·context/selectedbinding 검증,기존selected SOURCE_TEXT+RAW 원문권리교집합재사용,같은readonlyBEGIN에서기존artifact+선택source메타데이터/현재run검색receipt ID구성. 실identity입출력전재확인(admin/reviewer/viewer조회),다른team/run/권리회수시닫음.
- `trialboard/api/saved_review.py` GET `/api/research/runs/{run_id}/review-attempts/{attempt_id}/handoff`; `api/team_auth.py`정확route추가. nested기존artifact와canonicalSHA,clinical_verified:false. 기존artifactroot/저장DB변경0,새모델·수집0.
- 인용anchor서버재생성·원문quote정확대조,서로다른source/질문context재결속금지. URL은http(s)/host/사용자정보없음/2048자제한. pdf_url은위치일뿐PDF_BYTES허가아님. 임의본문·새통계·임상수치·box/OCR생성0.
- 선택되지않은자료UNKNOWN때wholeCollection403이어도선택handoff정상200. external_ai철회는새모델전송차단이며original_storage유지시기존artifact조회는유지한다. 당시정책revision/history불변.

## 검증 이력

신규 `tests/test_saved_review_handoff.py`. 최초13+기존SavedReview18+RAWgates8=39pass(exec61341). RAWfixture는source digest를a*64로바꾸지만base요청binding이1*64인설정불일치로후속1fail →test요청을fixture의실digest에맞춤,제품게이트완화0. 이후handoff15+SavedReview18+RAW8+team_auth28+usage17=86pass(exec34056,기존경고2). boolspan/model/notices의엄격contract부정3개추가후신규18개모두통과(exec28890 exit0).

최종Ruff/diffclean. usageRPC1790846257/6342/6419/6502=70%,6528/6611/6642/6714=71%,secondary미제공/읽기모델0. 일부긴편집조회간격60초초과는하드상한보장으로표현하지않음. 첫묶음서버freeze·신규18/관련86검증확정후부모에인계.

## 한계 / 부모 다음 UI

search_id는현재run request의연결이며SOURCE provenance가있는기록은그requestdigest결속도검증한다. 구형artifact에없던원래search_id를복원·새기록한것처럼주장하지않는다. 검색receipt본문을handoff에서반환하지않고해당후속조회는기존scout검증을따른다. artifact결과나질문을임상수치관측으로자동변환하지않는다. PDF다운로드·PDF수치검토/설계는별도명시행동과기존권리게이트를유지한다. 부모는엄격reader→KOLexport/선택원문intake/TEAM공통정책확인흐름을담당한다.

fixture인계: `tests/test_saved_review_handoff.scenario.__wrapped__(tmp_path, monkeypatch)`는기존savedReviewtuple; `completed(value)`는 `(attempt_id, handoff_url, artifact)`를반환. realTEAM·fakeprovider·임시DB만사용. 부모독립UI/전체회귀가다음검수다.

## PDF 정상 흐름 읽기 감사 / handoff 웹 계약 회귀

- 감사 중 제품 수정0. 기존 `PdfWorkspace.openCollectedDocument`의 consent-only POST는 권리 ALLOW인 단일 cache에서 정상 HIT지만 신규 cache 없음/복수 버전은409, viewer POST는403이다. 부모가 기존 pdf-metadata→명시 SHA선택→exact cached GET→bounded `verifiedPdfBytes`→accept callback 연결을 담당한다. 기존 durable ScoutContext.document exact키는 유지하고 별도 transient 선택 상태를 사용한다.
- 브라우저 PDF.js→수동 필드 확인→로컬 결정론적 설계 비교는 서버 PDF preparation(macOS 미지원)과 별도 경로다. enable_designs/loopback/TEAM 역할/정확 PDF·필드 재검증/명시 동의 필요, ProjectReceipt와 AI 추출은 수동 경로의 필수조건이 아니다. 전역 authenticatedFetch가 TEAM 쿠키·CSRF를 적용한다. 별도 AI 설계 제안의 imported_agent_report/project model binding 조건은 그대로이며 saved review 서술을 임상 수치로 자동변환하지 않는다. 수동 LocalDesignRunner 문맥 입력은 기존 화면에서 재입력이 필요하다. 이는 초기 scout/연구 권리 모델 전체가 일반 수동 업로드·로컬 계산까지 자동 전파된다는 뜻이 아니다.
- 기존 Python `test_design_api`17+`test_research_pdf_policy`14+`test_saved_review_handoff`18=49개 모두 통과(exec75122,기존경고2), collect-only로 수 확인.
- 부모 예외 위임으로 새 `web/tests/saved-review-handoff.test.mjs`만 추가. 실제 TEAM 임시DB+fake provider로 완료한 artifact/handoff를 Python spawn으로 받아 TS strict reader/canonical Unicode SHA/GET-only no-store/권리403·버전409/중복키/abort전후/선택source 문맥/정성 KOL markdown 검사. 원래 fixture의 example.org는 기존 프런트 allowlist 밖이라 첫4개 실패→fixture 생성 전에 가짜 PubMed 형식 URL로 교체(실네트워크0/제품검증완화0). 이후 strictJson의 null-prototype 객체에 deepStrictEqual을 쓴 test 기대1개 실패→canonical 값 비교로 수정. 최종 신규5개 모두 통과(exec74627).
- 이번 묶음 backend/제품 UI 변경0, 모델 호출은 synthetic fake1회뿐이며 실제 공급자 호출0. 사용률 RPC1790846950/7003/7073/7121=73%, secondary미제공/조회model_calls0. 부모가 새 PDF 흐름 UI와 전체 회귀를 독립 검수한다.
