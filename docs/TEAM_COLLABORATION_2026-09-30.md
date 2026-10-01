# TEAM 문서 협업 사용 범위

이 문서는 로컬 개발용 TEAM 모드 Phase 2의 실제 구현 범위를 설명한다. 운영 SSO, TLS,
임상 승인, 법적 이용권 판정 또는 배포 완료를 뜻하지 않는다. 기본 `legacy_loopback`의
checkpoint 계약과 데이터는 변경하거나 자동 이전하지 않는다.

## 구성원 관리

최초 관리자는 기존 `trialboard.api.team_bootstrap`으로 만든다. 추가 계정은 서버를 내린
상태에서 비밀번호를 표시하지 않는 CLI로 명시 생성한다. 이 명령은 계정을 실제로 만들기
때문에 운영자가 직접 실행해야 하며 기본 계정은 없다.

```bash
python -m trialboard.api.team_members \
  --identity-db /private/tmp/trialboard-team/identity.sqlite3 \
  add --username reviewer-a --role reviewer

python -m trialboard.api.team_members \
  --identity-db /private/tmp/trialboard-team/identity.sqlite3 \
  set-role --username reviewer-a --role viewer

python -m trialboard.api.team_members \
  --identity-db /private/tmp/trialboard-team/identity.sqlite3 \
  revoke --username reviewer-a
```

- 비밀번호와 확인값은 `getpass`로만 입력하며 출력하지 않는다.
- 한 identity DB에는 팀 하나, 로그인 하나당 membership 하나만 지원한다.
- 역할 변경과 철회는 permission epoch를 올리고 해당 사용자의 세션을 즉시 폐기한다.
- 마지막 활성 admin은 강등하거나 철회할 수 없다.
- `admin`과 `reviewer`는 프로젝트 버전 및 공동 검토 기록을 쓸 수 있고 `viewer`는 읽기만
  가능하다. 역할은 서버의 활성 membership에서만 정한다.

## 문서와 프로젝트

TEAM에서 기존 “자료 검토”의 프로젝트 저장이 팀 문서 작업공간으로 동작한다. 별도 장난감
편집기를 만들지 않고 `ProjectShelf`와 `PdfWorkspace`의 저장·열기·복구 흐름을 사용한다.

- 각 checkpoint는 동일 PDF에 대한 불변 **검토 revision**이다. 다른 PDF는 별도 프로젝트의
  원문 버전으로 저장하고 선행 프로젝트·정확한 검토 revision·불투명 series head revision을
  연결한다. 자세한 저장·권한 계약은 `DOCUMENT_SOURCE_VERSIONS_2026-09-30.md`에 있다.
- TEAM 저장은 일반 저장 동의와 별도의 `public_authorized_non_sensitive: true` 증언을 서버가
  요구한다. 서버는 해당 revision의 정확한 PDF/bundle digest, 인증된 사용자와 서버 시각,
  증언 문구를 함께 기록한다. 이는 법적 이용권이나 자료 진위를 서버가 검증했다는 뜻이 아니다.
- PDF는 최대 5 MB이고 요청 전체는 기존 48 MiB 한도를 유지한다. 바이트와 digest를 다시
  검증한다.
- 같은 팀 안에서 PDF blob만 content digest로 중복 저장하지 않는다. 다른 팀 DB와는
  중복 제거나 조회를 공유하지 않는다.
- 새 프로젝트는 **현재 팀 전체 공유** 또는 **제한 공유**를 명시 선택한다. 제한 공유의
  owner/write/read membership이 목록, 버전·원본 읽기, 저장, 공동 검토와 접근 관리에
  적용된다. 명시 ACL이 생긴 뒤에는 생성자라는 이유로 삭제된 membership을 복원하지 않는다.
  admin의 팀 관리자 override는 별도 `access_source`로 표시한다.
- 마지막 활성 쓰기 가능한 owner는 제거할 수 없고 viewer의 역할 상한은 read다. ACL 변경은
  revision 충돌을 검사하고 감사 행을 추가 전용으로 남긴다. 변경자가 자기 접근을 넘기거나
  관리 권한을 낮춘 경우 응답은 이후 ACL 상세를 노출하지 않는 확인 응답이며 화면은 해당
  권한을 즉시 새로 읽거나 프로젝트 작업을 잠근다.
- TEAM DB에 registry 없이 존재하는 과거 checkpoint는 목록·읽기·수정에서 거부한다.
  아래 명시 가져오기로 새 TEAM 프로젝트를 만들어야 한다.

## 공동 검토와 충돌

프로젝트를 연 뒤 “인증된 검토 이력”에서 메모 또는 워크플로 검토 확인을 추가한다. 작성자,
역할과 시간은 요청 본문이 아니라 현재 서버 세션에서 기록한다. 이벤트는 추가 전용이고
각 이벤트는 작성 당시 문서 revision에 묶인다. 조회 응답은 현재 연 프로젝트와 요청한
checkpoint에 결속된 프로젝트 전체 append-only timeline이며, 이벤트마다 실제 기준 revision을
그대로 표시한다. `event_revision`은 문서 revision별이 아니라 프로젝트 전체에서 연속 증가한다.

`expected_revision`이 서버의 최신 event revision과 다르면 `409 REVIEW_VERSION_CONFLICT`를
반환한다. 화면은 작성 중인 내용을 지우지 않고 최신 이력을 불러오는 선택을 보여 준다.
자동 재전송이나 마지막 쓰기 우선 덮어쓰기는 하지 않는다.

워크플로 검토 확인은 항상 `clinical_approval: false`다. 기존 임상 gate를 변경하지 않으며
전문가 승인이나 임상적 정확성 확인이 아니다.

## legacy checkpoint 가져오기

TEAM 화면에서 사용자가 bundle JSON과 그 원본 PDF를 직접 선택한다.

1. 별도 체크박스로 **선택한 PDF와 bundle**이 공개·사용 허가된 비민감 자료임을 확인한다.
   파일이 바뀌면 이 확인과 기존 preview는 해제된다.
2. “저장 전 검사”는 bundle/PDF 계약, 크기와 digest, 현재 팀 내 동일 bundle+PDF 여부를
   확인한다. 팀 제품 DB가 없으면 디렉터리·DB·DDL을 만들지 않고, 있으면 SQLite read-only
   모드로만 조회한다. 로그인 세션의 identity DB bookkeeping은 이 제품 artifact preview와
   별도다.
3. 저장 위치는 사용자가 선택한 현재 팀 전체 또는 제한 공유의 새 프로젝트로 표시된다.
4. “검사 결과대로 가져오기”를 다시 눌러야 commit한다. commit은 payload와 digest, 현재
   권한을 다시 검증하고 동일 PDF+bundle의 중복 확인과 모든 artifact 등록을 하나의
   `BEGIN IMMEDIATE` transaction에서 처리한다. preview는 예약이나 잠금을 만들지 않는다.
5. 서버는 기존 legacy DB를 열지 않는다. bundle의 작성자나 승인 표시는 인증 이벤트로
   변환하지 않는다.

과거 조사 `context`가 포함된 legacy bundle의 provenance-preserving 분리·재연결 흐름은
아직 구현하지 않았다. 이 경우 `LEGACY_CONTEXT_RELINK_REQUIRED`로 명시 거부하며, 과거 receipt나
source ownership을 현재 팀 자료인 것처럼 만들지 않는다.

동일 bundle+PDF가 이미 TEAM registry에 있으면 commit을 `409 IMPORT_DUPLICATE`로 거부한다.

## 보안·기능 한계

- 루프백 개발 기능이며 실제 사용자 DB, 서버, migration, 배포를 구성하지 않았다.
- 새 문서는 공개·사용 허가된 비민감 자료라는 사용자 확인이 필요하다.
- 저장 허가는 외부 AI 전송·학습 허가가 아니다. Phase 3 이용조건·provenance 정책이 없으므로
  제한 프로젝트를 연 동안 에이전트 검토와 필드·설계 파생 동작을 화면에서 차단한다. 현재
  checkpoint 저장 경로도 제한 프로젝트의 조사 context 결합을 거부한다. 모든 일반 모델 API가
  임의 payload의 출처를 판별하는 범용 DLP는 아니며, 사용자가 이미 내려받은 바이트를 수동으로
  새 파일처럼 올리는 경우까지 ACL로 회수·차단한다고 주장하지 않는다.
- 화면의 명시적 “별도 프로젝트로 복사 저장”은 원본 project/revision과 digest를 서버가 다시
  검증한다. 제한 원본의 비소유자는 팀 전체 공유로 넓힐 수 없다. 서버가 이미 아는 동일 제한
  digest의 일반 저장도 차단하지만, 이는 다운로드된 자료 전체에 대한 DLP 보장이 아니다.
- 다중 팀 선택, 운영 계정 복구, 장기 감사/보존 정책은 아직 구현하지 않았다.
- 실제 브라우저의 모바일 키보드까지 포함한 전체 협업 QA는 아직 완료하지 않았다. 새 PDF 원문
  체인은 합성 DB API 회귀와 웹 계약/빌드로 검증했으며 실제 사용자 DB migration은 하지 않았다.
- Phase 3 자료 이용조건과 Phase 4 작업 큐는 이 구현에 포함되지 않는다.
