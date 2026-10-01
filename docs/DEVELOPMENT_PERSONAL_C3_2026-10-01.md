# 개인 개발 C3A — PDF_BYTES 저장·조회 권리

2026-10-01 동일 개인 내장 agent1. 부모승인 C3A backend/Python 전담, UI는 부모소유. 대회API/모델API/인증파일직접읽기/추가agent/영상/실DB/배포/commit/설치 없음. 작은임시SQLite/가짜PDF bytes/가짜download만 사용. 전체완료율 계획추정79±10%p 유지.

## 확정 계약 / 구현

[공유계약](RESEARCH_PDF_POLICY_CONTRACT_2026-10-01.md)을부모에게전달하고구현했다. 신규 `trialboard/research/pdf_policy.py`, `tests/test_research_pdf_policy.py`; 수정 research/automation/team_auth 라우트. `tests/test_team_auth.py` 기존격리fixture에 정확PDFdocument와별도PDF정책진술을추가했다. 부모UI파일미수정.

- PDF_BYTES정책은SOURCE_TEXT와독립, 정확run/source/sourceDigest/pdfSha를결속한다. 읽기metadata/history는기존DB read-only·본문/URL0, current UNKNOWN revision0, owner/admin CAS변경과최대100이력. binding/policy SQL UPDATE/DELETE불가.
- 구 public_pdf_receipts에는sourceDigest가없으므로metadata는LEGACY_UNBOUND와UNKNOWN을보여준다. 사용자명시정책진술시만현재sourceDigest에결속한다. 자동마이그레이션/자동ALLOW/출처텍스트권리재사용 없음.
- 신규다운로드요청은실제true+정확sourceDigest+original_storage ALLOW 근거/사유가필수. 네트워크전현재source/URL/실세션/role/owner관리권한 확인, fetch후같은내용·세션을확인한뒤수신sha256해시와PDF형식/5MB범위를검사한다. 이번사용자진술의저장허가만그정확PDF에revision1로기록하고search/external_ai/training은UNKNOWN이다. 공개URL만으로허가를추정하지않는다.
- 기존consent-only는권리있는정확cachehit만허용한다. cache권리UNKNOWN/DENY는403, 새다운로드허가누락409,복수PDF는409로exactsha GET선택을요구한다. 명시download요청으로도기존DENY를덮어쓰지않는다.
- cached GET과POSTcachehit는동일snapshot에서current sourceDigest/binding/original_storage/bytes길이/sha를검사한다. 기존legacy loopback다운로드는보존했다.
- TEAMautomation read/prepare도정확PDFsha의저장권리를검사한다. malformed기존automation document는원문을내보내지않고409고정코드로거부한다. 모델automation/run은C3B까지기존403유지. 실제모델전송·일반rawcollector권리는미완료다.

## 검증

신규14개합성PDF tests 통과(7.59초), team_auth+PDF 관련40개통과(20.50초). 정상명시다운로드1회,storage만ALLOW, SOURCE_TEXT UNKNOWN보존, CAS409·철회·SQL불변, 캐시해시변조, 구receipt UNKNOWN→명시결속, 허가없는입력/비관리자network0, fetch중세션/role/source/url변경저장0, 실제다른팀knownrun/PDFmetadata/정책/cache404와새폴더생성0을검사했다. Ruff/diffcheck통과. 전체Python은진행중이며최종결과아래추가.

초기fixture는pdf_url을추가하고같은digest를재사용해서불변source_versions대조에409로차단되었다. 제품gate를완화하지않고합성fixture의새버전digest를갱신해12개통과. 기존team_auth의document없는가짜automation행2개는새경계와맞지않아수정했다. 단순기대status완화대신최소exactPDFdocument와정책API명시진술을넣어정상격리경로검증을유지했다.

## 미완료 / 운영 한계

- PDF 외부모델전송 C3B는미구현으로TEAM자동화계속403. external_ai 정책은기록되지만현재모델gate를해제하지않는다.
- 브라우저PDF추출텍스트는여전히`textVerifiedAgainstPdf=False`; 바이트SHA일치가임의제출본문의실제PDF일치를보증하지않는다. C3B는이경계감사후진행해야한다.
- 전체rawcollector권리/불변receipt기존스키마정리/일반갱신큐/OCR/임상검증/실배포는범위밖이다.
- 이미전송한bytes회수또는identity/evidence별도DB간완전한원자적철회보장은하지않는다. POST 다운로드최종identity검사후SQLite저장·응답은작은동기구간이지만모든동시성보장이라고표현하지않는다.

## 사용량

시작 RPC1790833251 주간38%, 이후39→40%. 최신확정1790833725 주간40%, secondary미제공/model_calls0. 모든보고유효window45%선제중단/조회실패중단유지. 일부큰편집은60초조회목표를초과했으며50%하드보장을주장하지않는다. 다음검수checkpoint에서도실제관측을확인한다.

최종 전체 Python회귀 `.venv/bin/pytest -q -o addopts=''`: **852 passed, 기존경고2, 68.13초, exit0**. 장기명령은1초yield로시작하고진행중사용량별도조회했다. Ruff전체backend/관련tests 및git diff --check통과. 부모에게C3A검수체크포인트전달.

## 후속 UI 독립감사 — 선택 PDF 버전 정상 경로

부모가 구현한 새SavedResearchReview/ResearchPdfPolicy와엄격reader를독립검토했다. frontend-design을본인이완전재독하고기존TrialBoard MUI·색/타입/간격/명시동작문구를그대로재사용했다. Sites도구discovery/공통지침은확인했으나세션에적용가능한Sites SKILL은제공되지않았다. 로컬합성검증만진행/외부사이트생성·배포0.

- 실제결함:복수PDF버전선택UI는있지만exactsha원문을여는동작이없어consent-only POST의복수버전409이후정상조회가막혔다. 선택버전의exactcachedGET→현재서버권리재검사→MIME/길이/%PDF/응답sha/선택sha/실수신sha검증후명시적‘선택한 PDF 파일 저장’을추가했다. viewer도storageALLOW이면읽기만가능,정책작성은기존관리권한유지. 매번재요청하며원문BlobURL은짧게폐기하고이미내려받은파일은철회로지워지지않음을표시한다.
- 공통수신검증 `verifiedPdfBytes`는비동기body/hash전후AbortSignal을확인한다. 잘못된파일헤더/sha/형식/취소는파일저장전에거부한다. PDF새다운로드수신확인에도재사용했다.
- SavedResearchReview는취소된작업의늦은SSE완료뒤추가artifactGET을시작하지않도록current검사를추가했다. 후속조회실패시이미보인artifact도지워오래된본문을남기지않는다.
- 변경: `web/src/ResearchPdfPolicy.tsx`, `web/src/research-pdf-policy.ts`, `web/src/SavedResearchReview.tsx`, `web/tests/research-pdf-policy.test.mjs`; 새 `web/scripts/check-pdf-exact-download-ui.mjs`.
- 실제검증: TypeScript noEmit통과, 관련reader11tests통과(실TEAM backend→TSroundtrip포함), 새mountedStrictMode1440/390두화면에서정확두번째버전GET·viewer정책readonly·키보드·wrongsha저장0·철회403저장0·overflow0/pageerror0. 기존SavedUI1440/390 CAS입력보존·동의·취소지연결과무시·철회결과clear재통과. 부모에게최신소스전체web/build검수를인계했다.

**최신 사용량 정책 변경:** 사용자‘50퍼까지계속해’반복승인으로부모가중단기준을보고된어떤window든50%이상또는조회실패로변경했다.48%부터큰새묶음금지/짧은수정·검증·체크포인트와빈번조회. 이전45%기준은이후작업에대체된다. 관측지연때문에50%하드보장은주장하지않는다. UI묶음시작41%,RPC1790834113에도41%,secondary미제공/model_calls0.

## C3B1 — 서버 PDF preparation-only (현재 macOS는 미지원 차단)

부모승인후 [준비계약](RESEARCH_PDF_PREPARATION_CONTRACT_2026-10-01.md) 작성/공유. 신규 `trialboard/research/pdf_preparation.py`, `trialboard/research/pdf_extract_worker.py`, `tests/test_pdf_preparation.py`; `api/research.py`, `api/team_auth.py` 두라우트/동시성slot 연결. 원래 Collection/automation/UI는수정하지않았다. 기존PDF바이트정책과저장원문을재사용하되새권리추정없음.

- POST prepare-server는stricttrue+sourceDigest+pdfSha+정수policyRevision만받고브라우저텍스트/경로/공급자옵션은금지한다. 실제run owner/admin, exactPDF storageALLOW/currentrevision, sourceversion/원문해시를전후검사한다. 성공시별도UUID와canonicalSHA256의append-only preparation한행, GET도현재권리·정확원문·artifact해시·SQLrun/id결속을검사한다. 준비는로컬처리이므로external_ai허가를새로생성하지않고모델호출0이다.
- 파서별도process(`python -I`,최소PATH/LANG환경,stderr폐기)는Linux에서RLIMIT_AS512MiB·CPU2초·파일출력200k·FD32를먼저설정하고getrlimit동일성및초과주소공간할당ENOMEM/MemoryError검사를통과해야pdfplumber를import한다. 지원안되는플랫폼이나설정/probe실패는UNSUPPORTED_SANDBOX이며무제한fallback/우회옵션없다. stdout부모누적200k초과는kill/wait, wall5초timeout도kill/wait. 취소cleanup shield, kill종료race보존, spawn오류고정코드 적용.
- 입력5MB/PDFheader/sha,10pages,텍스트총30k문자,출력200k. 암호화·무텍스트·페이지/텍스트초과는고정오류이며빈페이지에는빈문자열만허용하고가짜span/OCR/좌표추정없다. output프로토콜은정확필드/순서/개수/형식/문자수재검증한다.
- **현재환경 실제제약:** macOS에서256MiB RLIMIT_AS설정시험이ValueError로실패했다. 구현은macOS를명시미지원으로닫는다. `UNSUPPORTED_SANDBOX`를정상서버PDF추출성공으로표현하지않는다. 설치pdfplumber0.11.10/pdfminer.six20260107확인만했으며설치없음. CPU/memory자원제한은완전한파일·네트워크OS샌드박스가아니다.
- **검증구분:** 합성parserstub으로준비성공/원문결속/digest/불변저장/철회GET/응답중세션·role·policy철회저장0/모델0을검증했다. 실제현재플랫폼은파서시작전차단·저장0을검증한다. Linux resourcecap은fake resource/mmap 프로토콜테스트이며Linux에서실제PDF추출성공·격리보장으로주장하지않는다. 합성pdfplumber문서double로암호화/빈텍스트/페이지/텍스트상한분기만검사했다.
- subprocess double시험은정상/출력초과/walltimeout/killrace/잘못된JSON/생성실패와reap을확인한다. artifact내용해시가맞더라도SQL저장id와artifactid가다르면409인회귀도포함한다. 기존PDF·TEAM포함관련70개통과(25.89초), Ruff전체backend/newtests·git diffcheck통과. 최신29개신규전체와부모독립전체Python은아래결과추가.

서버코드는부모에게freeze전달했다. C3B2모델연결/준비화면/실Linux파서성공검증/OS완전격리/일반raw권리/중단attempt자동복구는미완료다. TEAMautomation/run은여전히403. RPC1790834386 시작42%,이후43→44%,1790834787주간44%/secondary미제공/model_calls0. 최신50중단·48큰묶음금지유지,전체79±10계획추정유지.

최종신규29개통과(5.61초). 실제현재macOS에서 `.venv/bin/python -I trialboard/research/pdf_extract_worker.py`는exit0과정확JSON `{"status":"ERROR","code":"UNSUPPORTED_SANDBOX"}`을반환했다(추출성공아님). 이후부모요청으로제품코드freeze유지한채Task취소kill/wait/stdin종료와준비route CancelledError후slot재획득두합성회귀만추가했다. 정상Linux추출·실메모리cap의현재환경성공증거로해석하지않는다.

취소시험포함최종 **31 passed, 기존경고2, 5.66초**, Ruff/diffcheck통과. 부모독립전체Python은취소2개추가전881passed/2경고,웹1078pass+1skip/TS/Vite통과보고. 마지막자식확인RPC1790834984 주간45%/secondary미제공/model_calls0. 새10분묶음으로별도read-only review-usage집계를부모승인받았고48%부터는마무리·검증단위만진행한다.

## 후속 — 저장 재검토의 읽기 전용 관측 사용량

부모승인으로 [관측사용량계약](RESEARCH_REVIEW_USAGE_CONTRACT_2026-10-01.md)을확정하고backend `trialboard/research/review_usage.py`, GET `/api/research/runs/{run_id}/review-usage`, TEAM route allowlist를추가했다. UI/엄격reader/전체검수는부모전담이며본인은수정하지않았다.

- 원문/제목/query/인용/responseid/subjectid를반환하지않는다. 현재TEAM의runmetadata접근수준,ro SQLite동일snapshot이며집계중DBbyte-equivalent 보존. source정책DENY여도metadata만조회가능.
- start+terminal이있으면terminal만합산한다. start만있으면unfinished별도,공급자/콜/토큰0으로확정하지않는다. DACON_RESPONSES/SCRIPTED_TEST_DOUBLE/COLLECTORS_ONLY각각5개counter로분리하고합성시험을실제공급자수치에합산하지않는다.
- 실제model_calls와제공된비음수정수토큰만합산,call1이지만null인input/output은각unknown_attempts로표시한다. 이API는SAVED_REVIEW_ONLY범위관측치이지제품전체/대회잔여/개인계정quota/청구비용추정이아니다.
- 10,000개record행(start+terminal합)초과는422로닫고부분총계를반환하지않는다. record JSON당1,000,000문자상한도적용한다. 이상mode/schema/phase/중복phase/rowkey/run/id불일치/시작없는terminal/binding변경/bool·음수·숫자누락/safeinteger합계초과는고정422이다. DB쓰기/모델호출/자동재실행0.
- 신규 `tests/test_review_usage.py`는기록counter·MODE분리·미종결/토큰null·읽기전후DB바이트동일·빈이력무초기화·손상기록·상한·실제TEAM원문철회후metadataGET200을검증한다. 기존team_auth격리test에다른팀usage조회404도추가했다. 초기15개+savedreview18개=33통과(9.18초);중복phase/실제route추가후최종은아래기록.

RPC1790835098시작45%,1790835280주간46%/secondary미제공/model_calls0. 제품backendfreeze를부모에게알렸으며48%가되면큰묶음없이마무리/검증만진행한다. C3B2모델·실Linux격리검증·raw권리·중단attempt상태복구는여전히미완료다.

최종신규17개+team_auth28개 **45 passed, 기존경고2, 15.79초**, Ruff전체backend/관련tests·diffcheck통과. RPC1790835330주간46%/secondary미제공/model_calls0. UI/전체제품회귀는부모독립검수결과와구분한다.

### 사용량 UI 독립 교차검수

부모의SavedReviewUsage/saved-review-usage와SavedResearchReview연결을독립읽기검수했다. useEffect의요청별AbortController/cleanup은이전run·이전revision지연응답을막고,오류/403시에기존수치를비우는경계가정상임을확인했다. 숫자bool·음수·unsafeinteger·다른run·scope·비용필드거부와실제/시험분리설명도정상이다.

좁은실제수정: (1) mode의모든input또는output관측이unknown인데동일방향observed토큰이양수인모순을reader가허용하던부분을거부한다. (2) record한도는attempt수가아닌start+terminal합이므로`attempts_total+(attempts_total-unfinished_attempts)<=10000`도검사한다. (3) 최초mount후parent초기refresh가동일usageGET를다시발생시키므로최초refresh완료이후usagecomponent를mount해중복조회제거. 서버/계약필드변경없음,모델호출추가없음.

수정파일: `web/src/saved-review-usage.ts`, `web/src/SavedResearchReview.tsx`, `web/tests/saved-review-usage.test.mjs`, `web/scripts/check-saved-review-ui.mjs`. 관련reader **6tests통과**(실TEAMfakeAPI→TS포함), TS noEmit/diffcheck통과. 실제mounted1440/390에서최초usageGET1회·CAS입력보존·권리철회수치clear·취소지연결과무시·미종결/토큰미확정설명·overflow0/pageerror0재통과. `/var/folders/nq/5rr31cs56rsgsvvmxnnmzffw0000gn/T/trialboard-saved-review-ui-cOmkwD` 스틸생성및모바일화면직접검토. RPC1790835575주간47%/secondary미제공/model_calls0. 큰새기능은추가하지않았다.

최종UI감사인계RPC1790835633 **주간48%**, secondary미제공/model_calls0. 최신정책에따라이후큰새묶음은시작하지않고작은검증·마무리checkpoint만허용하며50%또는조회실패시새개발중단한다. 부모에게48%도달과UI인계를즉시전달했다.

### 마지막 준비 동시성 부정 회귀 (제품 코드 변경 없음)

별도 `tests/test_pdf_preparation_races.py`에서 실제 TEAM 인증 라우트와 임시 DB/합성 parser만 재사용했다. 준비 도중 source digest 변경 또는 저장 PDF bytes 변조 각각409/본문 게시0/준비artifact 저장0, viewer POST403/parser0, 동시 준비 busy409/parser중복0 및 첫 요청 종료 후 slot 재획득·별도 UUID 생성이 통과했다. 네 경우 모두 외부 모델 factory/request0이며 실제 PDF 파싱 성공이나 Linux 격리 검증을 뜻하지 않는다.

`pytest -q tests/test_pdf_preparation_races.py` **4 passed, 기존경고2**; 해당 파일 Ruff 및 git diff --check 통과. 시작 RPC1790835800 주간48%, 편집 전1790835916 및 완료1790835929 **주간49%**, secondary미제공/model_calls0. 부모 요청의 마지막 작은 회귀 묶음만 완료했으며 신규 기능/제품 코드/실DB/실API 변경은 없고 추가 작업은 시작하지 않는다.

부모 교차검수에 따라 viewer 시험은 역할 변경 후 새 로그인과 `/api/auth/session` 200/role=viewer를 먼저 확인하도록 보강했다. 따라서 만료 세션403이 아닌 유효 viewer의 준비 권한403/parser0를 검증한다. 최종 네 회귀 재통과/Ruff 통과, 마지막 RPC1790835980 주간49%/secondary미제공/model_calls0.
