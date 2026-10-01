# 남은 제품 개발 감독 기록

상태: **실행16 프로젝트이용조건 PART A 독립검증통과, 실행17 프로젝트 외부모델 PART B 착수**. 최신Python788/웹1057+1skip/제품Ruff/build/diffcheck통과. 실제임시TEAM서버1440/390에서정책DENY로열기잠금·ALLOW해제, sourceversion/contextimport회귀, HTTP오류/pageerror/overflow0을확인했고정책관리스크린샷직접검토했다. exact문서정책결속부정QA도통과. PARTA는original_storage저장·원문반환만집행하며다른목적은아직기록만한다. 모델·조사·FTS·자동화전체gate는후속이다. 새[지속정책](DEVELOPMENT_CONTINUATION_POLICY_2026-09-30.md)이이전429재발중지정책을대체한다. 아래중지는당시이력이다. 영상·녹음 키트는 부모의 별도 작업이다. 구현은 대회 API `trialboard_dacon/gpt-5.6-sol`, 감독은 본 세션. 개인 공급자 fallback 없음. 사용자 실사용 데이터/서버/계정은 변경하지 않았다. 전체79%(±10%p)는 기존 계획 추정이며 새 기능 완료나 임상 정확도를 의미하지 않는다.

최신검증: Python780pass/기존경고2, 웹1055pass+1skip(프런트불변실행12결과), 제품Ruff/build/diffcheck통과. 원본context·bundle/hash는불변provenance로보존하고분리된작업context만null, 현재팀조사연결/과거임상승인을자동생성하지않는다. 감독이숫자1동의수용을별도발견해call13에서before엄격boolean검사로보정, 실제API부정QA422확인. 별도합성임시TEAM서버+실제AccessShell/PdfWorkspace1440/390에서로그인→PDF저장→새원문버전→이전PDF복구→별도동의context분리import→복구·원본이력표시전체확인(HTTP오류0/pageerror0/overflow0). 양쪽스크린샷직접확인, 임시서버종료. desktopimport설명grid의좁은줄바꿈은후속UI배치검토사항이며운영/임상QA완료주장은아니다. 자동현재팀context재연결은미지원, 이용조건및단계3~10은계속한다.

실행11최종: Python775pass/기존경고2, 웹1052pass+1skip, 제품Ruff/build/diffcheck통과. 새PDF는별도프로젝트/검토revision가족에원자적계보를저장하며기존원문·검토메모는보존하고새문서에재사용하지않는다. 동시head충돌은409/noorphan, 권한상속·동일bytes중복·비활성ACL거부확인. 감독추가QA에서숨긴후속버전404/구버전head정보생략, 실제ProjectShelf+합성API1440/390에서별도연결동의·정확한선행revision·충돌입력보존/pageerror0/overflow0확인하고스크린샷2개직접검토했다. 실제서버전체PDF E2E/운영보안인증은아니다. context명시분리/이용조건/단계3~10은아직남았다.

실행10최종: Python771pass/기존경고2, productRuff/diffcheckpass, last-owner422/원소유자200. 실제AccessShell/ProjectShelf/TeamReviewPanel+합성API1440/390화면에서ACL409선택보존·자기회수잠금·다른문서지연응답폐기·프로젝트별메모유지검증,4스샷직접확인. frontend-design지침은기존스타일을유지한실패·잠금상태의가시성점검에사용했다. 실제서버전체E2E/임상평가/운영보안인증은아니다. 회원CLI에서기존단독owner를강등·비활성화할경우teamadmin수동복구필요한한계는유지한다.

## 최신 중단 후 검증과 재개점

실행8의429후부분검사·약238초간격을두고허용된단일후속실행9를시작했으나18:17:45에429가재발했다. 규칙에따라추가호출은중지했고두PID종료를확인했다. 총할당량소진403으로확인된것은아니다. 이번확대batch9/24사용/15회잔여이며이는실제대회토큰잔량과별개다.

- Python770pass/기존경고2, 웹1051pass+1기존skip, build/diffcheck통과. 제품Ruff는새테스트의import정렬·줄길이2건실패. 감독은제품테스트를직접수정하지않았다.
- 기존독립결함해소: creator소유권회수이후read/events/manage404, 새owner200; 검토revision을올려도이전메모reader정상복원. 비관리자team-wide/restricted작성자관리도최종코드에서는200.
- 남은실제결함: viewer만owner로남기는ACL요청이200이라마지막쓰기가능owner보호에실패한다(`qa-project-last-owner.py`). 팀admin이복구할수있다는사실은이불변식완료근거가아니다. TEAM_COLLABORATION문서의해당완료주장은검증보다우선하지않는다.
- 가져오기무쓰기·원자적중복방지·동의/지문결속은재통과. 실제ProjectShelf/TeamReviewPanel+합성API1440/390화면은pageerror/overflow0, 파일교체동의초기화·검토충돌입력보존재통과. 이는ACL관리전체실서버E2E나운영보안인증이아니다.
- source-bound복사와기지restrictedPDFdigest파생경로gate/화면잠금이추가됐으나범용DLP나다운로드자료회수를보장하지않는다. ACL관리/receipt전환race/실제PDF전체흐름QA, 새PDFversionchain·과거context재연결, 단계3~10은아직완료아님.

지문`output/dacon-remaining-20260930/stopped-after-call9.sha256`과미실행재개지시`10-resume-acl-final-gate.txt`를남겼다. 새명시방향확인전추가대회호출없음. 실제DB/계정/DNS/배포/영상은변경하지않았다.

실행8은18:06:29에429로종료했다. 독립전체검사는Python767/웹1049+1skip/Ruff/build/diffcheck통과했지만, non-admincreator가소유권을넘긴뒤계속read/events/manage가능한결함과검토revision변경뒤과거메모브라우저계약거부를실제API기반QA로확인했다. 단계2완료로표시하지않는다. 최소60초경과와부분검사후해당단계1회만재개하는기존승인범위에서실행9좁은보정을준비한다. 총할당량소진으로단정하지않으며개인fallback없음.

실행7 감독검증: Python764pass/웹1045pass+1skip/제품Ruff/build/diffcheck통과. 합성임시DB 실제API로 preview무쓰기, 동시import단일등록(200+409), 명시동의·지문/주체기록·공백메모거부를확인했다. 실제협업component와합성API를쓴1440/390px화면QA는오류·가로넘침0, 파일교체시동의초기화·충돌작성내용보존을확인했다. 실제서버전체E2E·운영보안구성은아니다. 과거context재연결·새PDFversionchain·세밀ACL은아직미완료다.

## 시작 근거

- 이전 A/B/C 결과 보존. 부모 독립 baseline: pytest738통과/기존경고2, git diff --check 통과. 이전 웹1032통과/1skip, 제품Ruff와build 통과.
- 경로별 시작 지문: `output/dacon-remaining-20260930/before.sha256`.
- 읽기 전용 감사: `output/dacon-worker/20260930-144757-58b7b0e1/result.md`, exit0.
- 구현 상태·실행 횟수는 [상태 문서](DEVELOPMENT_REMAINING_STATUS_2026-09-30.md), 전체 범위는 [계획](DEVELOPMENT_REMAINING_2026-09-30.md).

## 감사와 안전 설계

현재 API는 공유 evidence DB를 router closure로 전달하므로 단일 인증 endpoint 추가로는 조사·프로젝트·PDF·자동화·탐색 경로가 분리되지 않는다. 별도 opt-in TEAM 모드에서 모든 경로의 서버 권한 판정과 팀 저장 경계를 먼저 만든다. 기존 루프백 모드는 자동 이전하지 않으며 팀 모드 설정 실패 시 기존 모드로 돌아가지 않는다.

권한은 기본 거부 및 매 요청 검사가 원칙이다. [OWASP 권한 지침](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)

세션은 고엔트로피 토큰의 서버측 검증·만료·철회가 필요하고, HttpOnly/SameSite만으로 CSRF 전체를 해결했다고 주장하지 않는다. [OWASP 세션 지침](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [CSRF 지침](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)

새 비밀번호 저장은 검증된 구현을 사용하며, Argon2id를 사용할 수 없을 때 scrypt의 권고 설정을 검토한다. 실제 채택·회귀 결과는 코드 검토 뒤 추가한다. [OWASP 비밀번호 저장 지침](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

현재 단계는 로컬 합성 데이터에서 검증할 개발용 기반이다. 운영 SSO/TLS/KMS·보안 인증, 임상 전문가 승인·정답집·최적 용량/PKPD, 실제 OCR 정확도는 완료로 표현하지 않는다. 내려받은 자료의 소급 회수도 서버 권한 검사로 보장하지 않는다.

## 1단계 부분 구현 후 전송 오류 중단

실행2: `output/dacon-worker/20260930-145353-936139d2`, write true, timeout1200초. 전체 API 역할 정책표, 팀 경계, 세션·CSRF, 로그인/만료 UI 연결과 음성 테스트를 요구했다. 단순 독립 helper나 미연결 로그인 화면은 기능 완료로 인정하지 않는다.

14:59:11 exit1: 대회 응답 stream의 transport/body decoding 오류. 인증/할당량/모델 오류 또는429로 확인된 것은 아니다. 자동 개인 전환 없이 중지했고 부모에게 같은 대회 공급자로 제한 재개할지 요청했다. 구현 코드가 일부 남아 있으며 사용자 변경 보존을 위해 되돌리지 않았다. UI는 아직 연결되지 않았다.

중단 후 감독 독립 검사: Python747통과/기존경고2, 새auth9통과, 제품Ruff·diffcheck통과. 하지만 테스트 수만으로 경계를 완료 처리하지 않았다. 추가 합성 QA에서 로그인 후 `/api/research/runs`가500(`TeamDataPath.exists` 미해결), 비ASCII 세션 쿠키500, legacy evidence DB를 team root 아래 두는 구성을 허용하는 결함을 확인했다. viewer logout은200으로 동작한다. 재현 스크립트 `output/dacon-remaining-20260930/qa-auth-partial.py`, 중간 검토 후보 `phase1-review-notes.md`. 이 결함 보정·범위별 IDOR·UI 통합 검사 전 다음 의존 단계로 진행하지 않는다.

프런트 변경은 `frontend-design` 스킬의 사전 설계 검토/실패 UX/모바일·키보드 원칙을 적용하되 기존 제품 스타일을 유지한다. 부모의 별도 영상 작업은 이 제품 감독 범위 밖이며 제품 worker는 영상에 손대지 않는다.

## 1단계 후속 결과 — 실행3~5

실행3은429로 종료. 최소120초 뒤 허용된단일후속 실행4로 보정했고 정상완료했다. 이후감독이 viewer의자동화GET만으로RUNNING이INTERRUPTED가되는회귀를재현해 실행5에서수정했다. 같은보정에서 일반409프로젝트충돌과SESSION_CONTEXT_MISMATCH를구분하고, 비ASCII컨텍스트헤더500·동일세션가시성재확인의잘못된요청세대변경을검사했다. 모든외부호출은Dacon sol, 개인fallback없음.

현재 확인된 기반: 명시opt-in TEAM/별도identity·teamstorage, 전체분류API서버역할판정, opaque세션해시·scrypt·만료/철회, Origin/CSRF/클라이언트컨텍스트일치검사, 팀별조회/파일/자동화분리, 연결된로그인·잠금·다른계정초기화. 기본legacy유지. 정적공개preview는명시VITE_PUBLIC_PREVIEW=true일때만 API차단상태로허용한다. coarse팀역할이며 프로젝트ACL·협업은다음단계다. TEAM자동복구는실행소유권·lease없이추측하지않고보류한다.

감독독립 최종결과(실행5후): Python756통과/기존경고2, Web1045중1044통과/1기존skip/0실패, 제품Ruff/build/diffcheck통과. 자동화QA GET200후RUNNING유지. 실제AccessShell과합성auth응답을쓴1440/390px브라우저QA:pageerror0/overflow0, 동일계정만료후편집보존·타계정초기화. 실제서버전체E2E/운영SSO보안인증/임상타당성검증을대체하지않는다. frontend-design스킬은기존제품tokens를유지하면서로그인·실패·잠금상태의가시성과모바일구성을점검하는데적용했다.

## 아직 구현 완료로 확인하지 않은 항목

세부프로젝트ACL·계정관리·협업, 이용조건, 갱신큐, 조건캐시, 다문서/전체 의존성, dossier·사전·인용 범위, 표·OCR·지표, 운영·평가 도구와 통합 QA. 각 단계의 실제 diff·테스트 통과 후에만 상태를 갱신한다. worker가부분보정작업을100%로표현했더라도제품전체완료로채택하지않는다.

## 2단계 부분 변경과 중지 지점

실행6 `output/dacon-worker/20260930-152853-897edfcf`가15:35:16 exit1로 종료됐다. 동일stream transport/body decoding오류 재발이며 총할당량초과로확인된것은아니다. 부모지시에따라새대회호출/구현은중지, 부분변경은보존했다. 이번확대batch6회시도/최대24, 현재활성worker없음.

남은코드: `team_members.py`의명시오프라인구성원관리CLI, TEAM등록checkpoint목록/공동검토이벤트/API, ProjectShelf/TeamReviewPanel연결, import preview/commit과관련테스트·사용문서. coarse팀전체공유이며세부ACL아님. 아직완료로채택하지않는다.

중단후감독독립검사: Python758통과/기존경고2, Web1045통과/1기존skip/0실패, 제품Ruff/build/diffcheck통과. 그러나추가합성QA `qa-collaboration-partial.py`에서실제기능결함을확인했다:

- preview200/writes_performed:false인데실제새제품DB1개생성.
- 동일PDF+bundle동시commit두개가모두200으로성공하고프로젝트2개등록(중복조회와저장transaction분리).

따라서worker가쓴TEAM_COLLABORATION문서의‘쓰기없음’/‘중복차단’설명은현재완료근거가아니다. import공개/허가/비민감자료확인동의의UI·서버결속, 기존contextbundle가져오기범위, 같은PDF의검토revision과새원문version구분, 세부프로젝트ACL과새협업화면실제QA도남았다. 단계3~10은착수하지않았다.

재개용미실행지시: `output/dacon-remaining-20260930/06-resume-collaboration-repair.txt`. 반복외부오류중지상태이므로새명시방향확인후이partial상태부터재개한다. 개인계정fallback이나실사용서버활성화로우회하지않는다. CLI토큰표시를대회실차감량으로단정하지않는다.

## 명시 재개 — 실행7

사용자가 대회 API 제품 개발 재개를 승인했다. 부모 최소연결시험은 HTTP200/completed/14tokens로 성공했고, 추정잔여헤더가119999986으로 나왔다. 원래 메일3000만과 다르므로 실제확정잔량·증액이라고 주장하지않는다. 현재소진차단으로확인된상태는아니다. 부모 auth20pass와동일가져오기두결함 재현도 확보했다.

local check network0/ready 후 `output/dacon-worker/20260930-174359-58696cba` 실행7을 시작했다. 무쓰기preview·원자적중복차단·명시동의라는좁은범위이며, 이전미실행지시에새승인문을붙인 `07-authorized-collaboration-repair.txt`를 사용한다. 구현 Dacon sol/개인fallbackfalse. 일시전송오류·429는부분검토와60초이상간격후단계당1회만제한후속, 반복/인증/할당량/모델오류는중지한다. 이전6회에포함하여최대24회제한은유지한다.

## 이후 확정 진전과 최신 정책 (19:51 갱신)

위 중지·1회재시도·24회종료 규칙은 당시 이력이다. 이후 사용자가 “자꾸 중단되면 재개해 끝까지 개발”을 승인했다. 최신 CONTINUATION_POLICY에 따라 일시오류는 안전한 부분검토와120/240/480/900초 backoff,5회연속15분회로차단후작은재개를 따른다.24회는 재감사 지점이지 자동종료점이 아니다. 실제할당량/인증/모델미지원·필수권한없음은 별도 blocker. 개인fallback/영상/실DB/배포금지는불변.

실행7~13에서 문서협업의 무쓰기preview·원자적중복차단·명시bool동의, 서버프로젝트ACL/마지막활성쓰기owner, source-bound복사와private파생차단, 새PDF원문versionchain과기존검토revision구분, 과거context를현재TEAM링크로위장하지않는명시분리가져오기 및원본provenance보존을 구현·독립검증했다. 기존실사용자료는건드리지않았다. 모든사례/한계/명령은 STATUS와 output QA에누적했다. 연구기록은아직팀전체coarse공유이며완전한프로젝트별연구ACL/운영SSO는아니다.

실행14권리감사후15~16에서 PARTA 프로젝트이용조건을구현: exactproject/PDF와결속한네목적상태/근거/인증주체/불변CAS revision, owner/admin관리, UNKNOWN/DENY원본반환차단과metadata회복경로, 신규저장/가져오기/원문버전명시허가, 실제UI관리. 감독최종Python788pass/웹1057pass+1skip/Ruff/build/diffcheckpass. 임시TEAM실API+실제components1440/390에서로그인→PDF원문저장→새원문버전→과거복구→context분리가져오기→정책DENY/ALLOW전체흐름 HTTP/pageerror/overflow0. 생성한QA권리근거는합성fixture전용이며법적권리승인아님.

실행17은 PARTB 프로젝트PDFagent/설계proposal 외부모델권한을연결하다19:40:25 ordinary429로중단. 감독Python792pass이지만추가QA에서실행중restricted전환미차단, 코드검토에서proposal실제PDF↔허가bindingdigest대조누락을확인했다. 웹새fixture1실패/Ruff2건도남아완료로보지않았다.417초뒤실행18 `20260930-194722-5f66ad35` Dacon/sol 단일writer로좁은후속가동, 개인fallbackfalse. 중간독립검사에서다른실제PDF403/providerfactory0, 정확PDF200/fakecall1, restricted전환재검사차단을확인했고1440화면의현재정책metadata갱신도통과했다. 최종완료판정은종료후회귀검증으로한다.

남은범위: 연구source/rawsnapshot/FTS/PDFcache/수집·외부모델·automation전체권리, 갱신큐, 조건캐시, 다문서·실제영향그래프, dossier/사전/인용, 표/OCR·범위정의지표, 운영·평가/통합. 임상검증/실제SSO·TLS·KMS/전문가정답/라이선스판단은코드만으로완료하지않는다. 전체79±10%p계획추정은유지하며PARTA나테스트수로전체완료율을임의올리지않는다.

## 20:01 프로젝트 모델 정책 PART B 통과

실행18도429로중단됐지만부분코드를보존했고추가독립검사로새모델요청의LiteralTrue 숫자coercion과합성testdir0755문제를발견했다. 실행19는두건만보정해19:57:53정상완료했다. 현재exactPDF/span·프로젝트/policyrevision결속, 매모델호출직전세션/role/epoch/정책/동일digestprivate프로젝트재확인, 명시actualTrue동의, 실제PdfAgentRunner/DesignProposal연결과정책갱신·stale결과취소범위가통과했다. 이미전송된호출의회수나범용DLP/운영보안인증은아니다.

감독최종Python797pass/기존경고2, 웹1060pass+1skip/제품Ruff/build/diffcheckpass. 실제임시TEAM/API/components1440·390에서sourceversion·contextimport와외부AI UNKNOWN→ALLOW→DENY갱신, HTTP/pageerror/overflow0. 잘못된PDF허가binding은403/providerfactory0, 정확한것은200/fakecall1. 전체검사중변경없는codex subprocess종료test의killpgPermissionError1회는이력보존; 단독1/module35/full797재실행모두통과했으며코드/검사완화없이운영후속으로기록했다.

다음 실행20은 연구SOURCE_TEXT의정확run/source/digest권리와metadata관리/fullrun·FTS·저장파생산출물반환gate. PDFbytes/raw수집/외부연구모델/자동화는별도후속이므로전체phase3완료아님.

## 20:02 실제 할당량 차단 — 현재 최종 상태

실행20 output/dacon-worker/20260930-200102-f46a04c3가20:02:15 HTTP403 Forbidden과quota exceeded로종료했다. 이전ordinary429와구분되는실제할당차단이며, 최신정책에따라새대회호출을멈추고부모에게상태확인을보고했다. 개인fallback없음. 확정잔여헤더는없으므로잔여0의정확한수치나소진내역은추정하지않는다. 초기119999986추정헤더/캐시포함CLI누적입력은현재실잔여/실차감근거가아니다.

실행20파일변경0, 두프로세스종료, 연구rightsC1는아직미구현이다. 검증된PARTA/B와기존모든dirty자료는보존했다. 확대배치20회(초기A/B/C4회별도),24회제한으로종료한것은아니다. 상태복구후재개지시는output/dacon-remaining-20260930/21-resume-after-quota.txt이며미실행이다. 실행기는새키탐색/모델변경/개인계정전환을하지않는다. 남은연구권리→큐→조건캐시→다문서·영향→입력/사전/인용→표/OCR/지표→운영/통합은완료로표시하지않는다.
