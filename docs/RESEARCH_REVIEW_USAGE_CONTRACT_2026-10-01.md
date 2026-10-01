# 저장 재검토 관측 사용량 계약 v1

GET `/api/research/runs/{run_id}/review-usage`, TEAM인증 metadata수준읽기. 원문권리철회중에도run이현재팀에존재하면허용. legacy404. DB read-only한snapshot, 모델/수집/쓰기0. 전체제품·계정·대회사용량이아닌SAVED_REVIEW_ONLY 범위. 비용금액/대회잔량/quota추정없음.

응답정확top-level:
`{schema:'research-saved-review-usage/1',run_id,scope:'SAVED_REVIEW_ONLY',as_of,attempts_total,completed_attempts,failed_attempts,cancelled_attempts,unfinished_attempts,usage_by_mode}`

as_of UTCISO. 모든count는비음수safeinteger, attempts_total=네statuscount합. 최대 **10,000개 record행(start+terminal 합)** 까지만읽고10,001번째행이있으면422 `REVIEW_USAGE_LOOKUP_LIMIT`로닫는다. 부분총계를정상총량처럼보내지않는다.

usage_by_mode정확3keys=`DACON_RESPONSES`,`SCRIPTED_TEST_DOUBLE`,`COLLECTORS_ONLY`. 각그룹정확필드 `{observed_model_calls,observed_input_tokens,observed_output_tokens,input_unknown_attempts,output_unknown_attempts}` 모두비음수safeinteger.

start+terminal중복합산금지: 정상start phase0을가지고terminal phase1이있는attempt는terminal만집계. start만있으면unfinished전역count만올리고어떤공급자그룹에도콜/토큰0을확정하지않는다. terminal의실제model_calls0또는1을해당mode에합산. 관측정수토큰만합산하고null은0으로확정하지않는다. model_calls1인데input/output가null인경우해당방향unknown_attempts를각각+1한다. model_calls0일때관측토큰이존재하면불일치로거부한다. COLLECTORS_ONLY는model_calls0/토큰null만정상이다.

SCRIPTED_TEST_DOUBLE은실제공급자사용량과합산하지않고별도시험그룹으로보인다. DACON_RESPONSES 역시앱에기록된관측치일뿐공급자청구서·계정잔여량보장이아니다. 미종결시도는실행중이거나중단될수있으며토큰/호출수가확정되지않았다. 자동재실행/복구없음.

잘못된mode/status/boolean·음수숫자/phase/SQLrow id·run과artifactid불일치/시작행없는terminal/중복phase/schema불일치/집계safeint초과는422 `REVIEW_USAGE_RECORD_INVALID`. terminal binding은시작source_bindings/context/asserted_by/created_at과같아야한다. 응답에본문·query·제목·quote·responseid·sourcebinding·subjectid를넣지않는다.
