# PDF 원문 버전 체인

이 기능은 TEAM 모드의 기존 `ProjectShelf`/`PdfWorkspace`에 실제 PDF가 바뀐 문서를
연결한다. 같은 PDF 안의 checkpoint는 계속 **검토 revision**이고, 다른 PDF는 별도
프로젝트와 별도 첫 checkpoint를 갖는 **원문 버전**이다. legacy checkpoint 계약과 DB를
자동 이전하지 않는다.

## 저장 절차

1. 새 PDF를 현재 로더로 연다. 이때 이전 메모, 관측, 설계, 회의와 임상 확인은 초기화된다.
2. TEAM 프로젝트에서 `기존 문서의 새 원문 버전`을 고른다.
3. 접근 가능한 현재 series head의 정확한 검토 revision을 선행 버전으로 선택한다.
4. 공개·사용 허가된 비민감 자료 확인과 원문 버전 연결 확인을 각각 선택한다.
5. 저장한다. head 충돌이면 PDF와 브라우저 입력을 유지한 채 목록을 새로 읽고 다시 선택한다.

같은 PDF는 새 원문 버전으로 저장할 수 없다. 기존 프로젝트의 새 검토 revision으로 저장한다.
과거 PDF와 모든 checkpoint·공동 검토 이벤트는 그대로 열 수 있으며 새 버전에 자동 적용되지
않는다. 저장이나 복구는 모델 호출이나 임상 승인을 수행하지 않는다.

## 저장 계약

- `document_source_series`: 불투명 series UUID, 현재 head 프로젝트, 낙관적 head revision,
  갱신 시각을 저장한다. head revision은 개수와 무관한 난수 토큰이다.
- `document_source_versions`: 각 원문 프로젝트의 불투명 version UUID, series UUID, 정확한
  선행 프로젝트와 선택한 검토 revision, PDF SHA-256, 원본 파일명, 인증 사용자와 서버 시각을
  저장한다. 한 series 안에서 같은 PDF digest는 유일하다.
- 새 원문은 새 `team_project_registry`, `project_checkpoints` revision 1, digest 결속
  attestation과 lineage를 하나의 `BEGIN IMMEDIATE` transaction에서 만든다.
- 요청은 `expected_series_head_revision`과 현재 head 프로젝트를 함께 비교한다. stale writer,
  비-head 선행 버전과 fork 시도는 `409 SOURCE_SERIES_HEAD_CONFLICT`이며 orphan 프로젝트나
  PDF blob을 남기지 않는다.
- payload는 새 PDF와 일치해야 하고 notes, review rows/model findings, agent report, meeting,
  research context가 없는 clean bundle이어야 한다. 이전 인용·관측·승인·회의를 복사하지 않는다.

## 권한과 노출

생성은 선행 프로젝트 owner 또는 TEAM admin만 가능하다. write/read grant와 viewer는 생성할 수
없다. 새 프로젝트는 선행 프로젝트의 현재 sharing scope, ACL revision과 구성원 권한을 그대로
복제한다. 공유 변경은 기존 ACL 관리에서 별도로 수행한다. 비활성 구성원이나 유효하지 않은
owner가 남은 제한 ACL은 먼저 명시적으로 정리해야 한다. TEAM admin 동작은 복구 override이며
운영 SSO 주장이 아니다.

목록과 직접 읽기는 기존 프로젝트 ACL을 먼저 적용한다. 접근할 수 없는 프로젝트의 ID, 파일명,
digest, version 수는 반환하지 않는다. 접근 가능한 버전의 선행 프로젝트가 더 이상 접근
가능하지 않으면 그 선행 ID와 revision도 숨긴다. 다운로드가 끝난 파일을 사후 회수할 수 있다는
주장은 하지 않는다.

## 범위와 한계

로컬 개발용 TEAM 저장 기능이다. 실제 사용자 DB migration, 운영 계정/SSO, 배포, 보존 정책,
법적 이용권 판정은 포함하지 않는다. context import, 권리 정책, queue, cache, 자동 재검토와
임상적 변경 영향 판단도 포함하지 않는다. PDF별 검토는 사람이 새로 수행해야 한다.
