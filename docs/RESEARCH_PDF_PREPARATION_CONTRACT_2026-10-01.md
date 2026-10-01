# C3B1 서버 PDF 준비 계약 v1

모델 호출0, 브라우저 임의본문0. 원래Collection/automation을덮어쓰지않는별도서버추출artifact. C3B2모델연결/UI는범위밖이며TEAMautomation/run403유지.

- POST `/api/research/runs/{run_id}/documents/{source_id}/prepare-server`
- GET `/api/research/runs/{run_id}/pdf-preparations/{preparation_id}`
- TEAM인증/CSRF; POST는run owner/admin, GET은현재PDF저장권리가있으면viewer도가능.
- POST정확필드 `{consent:true,source_digest,pdf_sha256,policy_revision}`. strict실제true,64lowerhex두digest,정수revision1..100(bool금지). raw正文/prompt/모델옵션/경로없음. 현재exactbinding/original_storage ALLOW/revision을확인한다. external_ai권리는이번로컬준비에필요하지않으며준비성공으로자동허용하지않는다.
- HTTP422계약,403권리/role,409source/revision/준비busy,404없음/다른팀. 지원안되는격리환경은422 `UNSUPPORTED_SANDBOX`이며파서실행0·artifact생성0. CPU/wall/output제한또는파서오류는고정422 code. 직접파서예외/본문로그를응답하지않는다.
- 성공응답과GET은정확필드 `{schema:'research-pdf-preparation/1',mode:'SERVER_PDF_TEXT_ONLY',preparation_id,preparation_digest,run_id,source_id,source_digest,pdf_sha256,policy_revision,asserted_by,created_at,extractor,pages,limits,model_calls:0,verification:'SERVER_EXTRACTED_NOT_CLINICALLY_VERIFIED',notices}`.
- preparation_id/asserted_by UUID,UTC시간. preparation_digest는자기자신필드만제외한전체artifact canonicalSHA256. extractor=`pdfplumber/<설치버전>`. pages1..10개정확 `{page:number,text:string}`이며1부터순서연속,각페이지실제추출텍스트(빈페이지면빈문자열),전체30,000 codepoints이하. 전체가무텍스트인PDF는`PDF_TEXT_UNAVAILABLE`;가짜span/OCR없음. 인용span/box는이번에추정하지않는다.
- limits정확 `{max_pdf_bytes:5000000,max_pages:10,max_text_chars:30000,cpu_seconds:2,wall_seconds:5,memory_bytes:536870912,max_output_bytes:200000}`. 입력5MB/PDFheader/hash검증. 암호화PDF/10pages초과/무텍스트/파서실패/상한초과는지원안됨으로실패. 범위를자르거나정상성공으로오인하지않는다.
- 별도Pythonprocess에서PDF파서import/입력파싱전hard RLIMIT_AS와CPU/출력파일·FD한도설정. 현재macOS는안전하게UNSUPPORTED_SANDBOX로닫으며우회환경변수/무제한fallback없음. Linux에서는limit설정·getrlimit동일성및주소공간초과할당실패probe를통과해야파서를import한다. walltimeout은부모가kill/wait,stdout최대200k+1boundedread,stderr는폐기. 이resource경계는완전한OS파일/네트워크sandbox가아님을명시한다.
- 추출후실세션/role/owner/source/PDFhash/revision/original_storage를다시검사하고통과해야append-only SQLite행에저장한다. source/policy철회중추출결과는저장/게시하지않음. GET은현재original_storage와정확source/PDFbytes를재확인하며변경시차단. 외부AI전송권리자동생성/개인fallback/모델호출없음.
- 현재환경실측RLIMIT_AS설정실패를실제PDF성공으로보고하지않는다. 정상추출로직은합성PDF와격리parserstub검증을분리해서기록한다.
