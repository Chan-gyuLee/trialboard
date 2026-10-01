# trialboard.ai.kr 첫 배포 사전 확인

사용자 요청: Cloudflare 계정에서 trialboard.ai.kr 구매·연결, 현재 작업분부터 실제 제품 배포 희망. 현재 단계는 도메인/구성/공개범위 확인이며 결제·DNS 변경·공개 배포·실계정 생성은 실행하지 않았다. 기존 Dacon 제품개발은 별도로 계속한다.

## 도메인

- Cloudflare 공식 구매 지원 목록에 .kr/.ai.kr이 없음: https://www.cloudflare.com/tld-policies/
- 가비아 .ai.kr 등록 지원. 공식 행사 페이지의 첫해 16,500원(VAT 포함), 일반 표시가격23,100원. 실제 이름의 등록 가능 여부·갱신비·최종 결제액은 구매 화면에서 재확인 필요: https://domain.gabia.com/regist/newkr
- 가비아에서 등록 후 Cloudflare에 zone을 추가하고 할당된 nameserver를 가비아에서 지정하는 방식. 임의 nameserver 값을 만들어 안내하지 않음: https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/
- trialboard.ai.kr이 현재 등록 가능한지는 아직 확인되지 않음. 계정 대시보드 링크는 인증된 세션 접근을 제공하지 않았고, 플러그인 관리 검색에도 Cloudflare 연결 플러그인이 없었음. 계정 비밀번호/전역 API 키 요청하지 않음.

## 코드에서 확인한 배포 전 보완

- React/Vite 프런트 + Python3.12/FastAPI/NumPy/PDF/SQLite 서버. web/dist만 올리는 것은 실제 AI·저장 서버 배포가 아님.
- trialboard/api/__main__.py: uvicorn 127.0.0.1 고정. app.py의 TrustedHost는 localhost/127.0.0.1만 허용.
- team_auth.py 쿠키 secure=False; docs/TEAM_MODE_2026-09-30.md는 HTTP루프백/원격proxy·TLS종단 미지원 범위를 명시.
- 도메인 allowlist, HTTPS Secure cookie, 신뢰하는 프록시/Origin/CSRF 구성, 외부 직접접근 차단, 초대 계정, 모델사용한도/속도제한, 영구저장·백업·복원·시크릿관리·실원격 로그인 QA가 필요. 로컬 경계를 제거하거나 Host를 위조하는 우회로 공개하지 않음.
- VITE_PUBLIC_PREVIEW=true는 API 차단 정적데모이며 실제제품으로 바꿔 말하지 않음.
- 개발 worker가 수정 중인 worktree를 바로 게시하지 않음. 검증된 배포 스냅샷에서 제품/공개허가 샘플만 묶고 영상·개인자료·로컬DB·키·worker로그 제외. 데이터는 새 베타용 저장소로 분리.

## 권장 첫 공개 범위와 남은 결정

후속 사용자 확인: 심사위원이 링크에서 실제 기능을 실행해야 하며, 기존 서버는 없음. 정적 데모만으로 대체 불가. 초대/심사 계정 방식은 제안 상태이며 구체 접근 방식은 아직 확정되지 않음.

호스팅 제안(아직 결제/선택 승인 전): Render 유료 웹서비스 1CPU/2GB 월$25 + persistent disk5GB 월$1.25 = 기본 월$26.25, 세금/초과트래픽 등 별도. https://render.com/pricing 의 공식 검색 결과 기준이며 서비스 생성 화면에서 다시 확인. 현재 Python+SQLite 구조를 단일 인스턴스에 유지하는 작은 심사용 배포의 출발 구성이고 실제 부하측정 전 성능 보장은 아님. 무료서비스는15분유휴sleep/영구디스크불가라 본 심사용 제안에서 제외(https://render.com/docs/free). 디스크부착서비스는 복수인스턴스 확장/무중단재배포불가이며 심사중자동배포끄기·SQLite일관백업별도필요(https://render.com/docs/disks). 프런트와API를동일origin으로 제공하는배포보완필요. 유료구독은사용자예산승인후만.

현재 권장: 초대한 사람만 실제 기능을 사용하는 베타. 구매등록대행자와 DNS는 분리, 서버는 Python+영구디스크를 지원하는 호스팅에 두되 제공자/비용은 미확정.

사용자에게 질문함: (1) 초대형 실제제품/누구나 실제제품/정적데모 중 공개범위, (2) 기존 서버·호스팅 계정 유무. 답변 전 실제 결제·서버 구독·Cloudflare/DNS 쓰기를 수행하지 않음. 별도 유료플랜/비용은 제안 후 승인. 대회 API 키는 서버에만, 비공개·민감자료 전송 금지 유지.

제품 기능 추정79±10%p 유지. 도메인 구입이나 배포는 임상 검증·제품 기능 완성도를 뜻하지 않음.
