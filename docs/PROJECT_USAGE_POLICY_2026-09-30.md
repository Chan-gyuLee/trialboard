# 프로젝트 자료 이용조건 (PART A)

## 저장 및 읽기 경계

- TEAM 프로젝트의 새 PDF 저장, 가져오기 commit, 새 원문 버전 생성에는 `original_storage=ALLOW`와 사람이 입력한 근거 참조·이유가 필요하다. `UNKNOWN`, `DENY`, 정책 누락은 PDF, checkpoint, provenance 및 정책 orphan을 만들지 않고 중단한다.
- 기존 TEAM 프로젝트에 정책이 없으면 `UNKNOWN` revision 0으로 해석한다. 메타데이터와 소유자·팀 관리자용 정책 관리 화면은 접근 가능하지만, PDF·bundle의 정확한 bytes, checkpoint 및 provenance 읽기와 일반 저장은 `ALLOW` 전까지 차단한다.
- 일반 checkpoint 저장 body의 정책 필드는 현재 정책을 덮어쓰지 못한다. 정책 변경은 프로젝트 ID와 PDF SHA-256에 묶인 별도 관리 API에서 현재 revision을 지정하는 CAS 방식으로만 append한다.
- 정책 이력은 프로젝트·PDF digest별 불변 revision이다. 현재 head와 전체 이력은 같은 프로젝트·digest에 속하고 revision 1부터 head까지 연속이어야 한다.
- `DENY`로 바꿔도 이미 저장된 데이터나 사용자가 내려받은 사본을 삭제·이동·회수하지 않는다. 저장 데이터는 보존되고 bytes 접근만 차단된다.

## 관리 흐름과 권한

1. 프로젝트 소유자 또는 팀 관리자가 현재 정책과 불변 이력을 조회한다.
2. 화면은 응답의 프로젝트 ID와 PDF digest가 선택한 문서와 정확히 일치하는지 확인한다.
3. 관리자는 근거·이유와 목적별 결정을 입력하고 현재 `policy_revision` 및 PDF digest로 갱신한다.
4. 서버는 권한, digest 및 CAS head를 다시 확인해 새 revision을 append한다. 충돌 시 입력을 유지하고 최신 head를 다시 조회해야 한다.

viewer, write/read grant 사용자와 다른 팀은 정책을 변경할 수 없다. 정책은 기존 ACL, 역할 상한 또는 프로젝트 격리를 넓히지 않는다.

## 의미와 현재 한계

`USER_ATTESTED_UNVERIFIED`는 사용자가 입력한 주장이라는 뜻이며 법적 유효성, 라이선스 적합성, 임상 승인 또는 전문가 확인이 아니다.

현재 PART A에서 `original_storage`만 PDF·checkpoint 저장/읽기 gate로 집행한다. `internal_search`, `external_ai`, `training`은 현재 기록만 하며 해당 런타임 gate는 후속 작업이다. 특히 training capability는 제공되지 않으며 응답에 `CAPABILITY_ABSENT`로 표시한다.

이 문서는 PART A의 현재 계약만 설명하며 Phase 3 전체 완료를 의미하지 않는다.
