"""Bootstrap Korean<->English clinical/pharma glossary (~1000 term pairs).

Used only to widen literature/registry *search* recall when a user enters a
Korean asset or indication name (PubMed/ClinicalTrials.gov index English
text). This module never touches extracted field values or citation quotes —
doing so would break the literal source-text matching that verify.py and
citations.py depend on. It only ever feeds an additional OR-term into a
search query string.

Built from curated core terms (CORE_*) plus systematic combination of
qualifier/root pairs (phase x endpoint, severity x adverse-event noun, etc.),
so the term count is inspectable rather than opaque padding. A term can have
more than one valid English gloss (the first is used for query building; the
rest are kept for lookup/display and future disambiguation UI).
"""

import re
from functools import lru_cache

_HANGUL = re.compile(r"[가-힣]")

CORE_DESIGN: dict[str, list[str]] = {
    "임상시험": ["clinical trial"],
    "임상연구": ["clinical study"],
    "무작위배정": ["randomization"],
    "무작위배정시험": ["randomized trial"],
    "이중맹검": ["double-blind"],
    "단일맹검": ["single-blind"],
    "개방표지": ["open-label"],
    "위약": ["placebo"],
    "위약대조": ["placebo-controlled"],
    "활성대조": ["active-controlled"],
    "대조군": ["control group", "comparator arm"],
    "실험군": ["treatment arm", "experimental arm"],
    "용량군": ["dose arm", "dose group"],
    "병행설계": ["parallel-group design"],
    "교차설계": ["crossover design"],
    "적응형설계": ["adaptive design"],
    "비열등성시험": ["non-inferiority trial"],
    "우월성시험": ["superiority trial"],
    "동등성시험": ["equivalence trial"],
    "용량증량시험": ["dose-escalation trial"],
    "용량확장코호트": ["dose-expansion cohort"],
    "최대내약용량": ["maximum tolerated dose"],
    "용량제한독성": ["dose-limiting toxicity"],
    "다기관시험": ["multicenter trial"],
    "단일기관시험": ["single-center trial"],
    "장기연장시험": ["long-term extension study"],
    "관찰연구": ["observational study"],
    "후향적연구": ["retrospective study"],
    "전향적연구": ["prospective study"],
    "코호트연구": ["cohort study"],
    "환자대조군연구": ["case-control study"],
    "사례보고": ["case report"],
    "메타분석": ["meta-analysis"],
    "체계적문헌고찰": ["systematic review"],
    "프로토콜": ["protocol"],
    "프로토콜개정": ["protocol amendment"],
    "임상시험계획서": ["clinical trial protocol"],
    "증례기록서": ["case report form"],
    "사전동의서": ["informed consent form"],
    "독립자료모니터링위원회": ["data monitoring committee"],
    "중간분석": ["interim analysis"],
    "중단규칙": ["stopping rule"],
    "맹검해제": ["unblinding"],
    "배정은폐": ["allocation concealment"],
    "층화무작위배정": ["stratified randomization"],
    "블록무작위배정": ["block randomization"],
    "군집무작위배정": ["cluster randomization"],
    "표본크기": ["sample size"],
    "표본수": ["sample size"],
    "검정력": ["statistical power"],
    "등록기준": ["eligibility criteria"],
    "선정기준": ["inclusion criteria"],
    "제외기준": ["exclusion criteria"],
    "임상시험계획승인": ["investigational new drug application", "IND"],
    "임상시험용의약품": ["investigational product"],
    "시험책임자": ["principal investigator"],
    "임상시험심사위원회": ["institutional review board"],
    "윤리위원회": ["ethics committee"],
    "임상시험등록": ["trial registration"],
    "임상시험번호": ["trial registration number"],
}

CORE_REGULATORY: dict[str, list[str]] = {
    "신약허가신청": ["new drug application"],
    "품목허가": ["marketing authorization"],
    "허가초과사용": ["off-label use"],
    "신속심사": ["priority review"],
    "희귀의약품지정": ["orphan drug designation"],
    "혁신치료제지정": ["breakthrough therapy designation"],
    "조건부허가": ["conditional approval"],
    "시판후조사": ["post-marketing surveillance"],
    "시판후안전성조사": ["post-marketing safety study"],
    "허가사항": ["prescribing information"],
    "제품설명서": ["package insert"],
    "위해성관리계획": ["risk management plan"],
    "규제기관": ["regulatory authority"],
    "식품의약품안전처": ["Ministry of Food and Drug Safety"],
    "미국식품의약국": ["Food and Drug Administration", "FDA"],
    "유럽의약품청": ["European Medicines Agency", "EMA"],
    "임상시험실시기관": ["clinical trial site"],
    "실태조사": ["inspection"],
    "자료완결성": ["data integrity"],
    "품질관리": ["quality control"],
    "품질보증": ["quality assurance"],
    "표준작업지침서": ["standard operating procedure"],
    "임상시험관리기준": ["good clinical practice"],
    "제조및품질관리기준": ["good manufacturing practice"],
    "안전성정보보고": ["safety reporting"],
    "긴급안전성서한": ["urgent safety notice"],
    "허가취소": ["license revocation"],
    "회수": ["recall"],
    "재심사": ["re-examination"],
    "갱신심사": ["renewal review"],
    "임상시험계획서승인": ["clinical trial authorization"],
    "수입품목허가": ["import drug approval"],
    "자료독점권": ["data exclusivity"],
    "특허연계": ["patent linkage"],
    "허가변경": ["label variation"],
    "동등성입증": ["bioequivalence demonstration"],
    "허가전검토": ["pre-approval review"],
    "허가후관리": ["post-approval management"],
    "표시기재사항": ["labeling requirements"],
    "경고문구": ["boxed warning", "black box warning"],
    "사용상주의사항": ["precautions for use"],
}

CORE_PHARMACOLOGY: dict[str, list[str]] = {
    "약동학": ["pharmacokinetics"],
    "약력학": ["pharmacodynamics"],
    "생체이용률": ["bioavailability"],
    "생물학적동등성": ["bioequivalence"],
    "반감기": ["half-life"],
    "최고혈중농도": ["maximum plasma concentration", "Cmax"],
    "최고농도도달시간": ["time to maximum concentration", "Tmax"],
    "약물농도곡선하면적": ["area under the curve", "AUC"],
    "청소율": ["clearance"],
    "분포용적": ["volume of distribution"],
    "정상상태농도": ["steady-state concentration"],
    "최소유효농도": ["minimum effective concentration"],
    "치료적범위": ["therapeutic range"],
    "치료지수": ["therapeutic index"],
    "대사체": ["metabolite"],
    "활성대사체": ["active metabolite"],
    "효소유도": ["enzyme induction"],
    "효소억제": ["enzyme inhibition"],
    "약물상호작용": ["drug-drug interaction"],
    "병용투여": ["concomitant administration"],
    "단독요법": ["monotherapy"],
    "병용요법": ["combination therapy"],
    "투여경로": ["route of administration"],
    "경구투여": ["oral administration"],
    "정맥투여": ["intravenous administration"],
    "피하투여": ["subcutaneous administration"],
    "근육투여": ["intramuscular administration"],
    "용량반응관계": ["dose-response relationship"],
    "용량조절": ["dose adjustment"],
    "용량감량": ["dose reduction"],
    "용량중단": ["dose interruption"],
    "유지용량": ["maintenance dose"],
    "부하용량": ["loading dose"],
    "표적치료제": ["targeted therapy"],
    "표적항암제": ["targeted anticancer agent"],
    "면역항암제": ["immuno-oncology agent"],
    "세포독성항암제": ["cytotoxic chemotherapy"],
    "생물학적제제": ["biologic agent"],
    "바이오시밀러": ["biosimilar"],
    "제네릭의약품": ["generic drug"],
    "오리지널의약품": ["reference listed drug"],
    "작용기전": ["mechanism of action"],
    "수용체결합": ["receptor binding"],
    "효능제": ["agonist"],
    "길항제": ["antagonist"],
    "억제제": ["inhibitor"],
}

CORE_SAFETY: dict[str, list[str]] = {
    "이상반응": ["adverse event"],
    "약물이상반응": ["adverse drug reaction"],
    "중대한이상반응": ["serious adverse event"],
    "치료관련이상반응": ["treatment-related adverse event"],
    "치료중발현이상반응": ["treatment-emergent adverse event"],
    "예상치못한이상반응": ["unexpected adverse event"],
    "이상사례": ["adverse event"],
    "부작용": ["side effect"],
    "독성": ["toxicity"],
    "용량제한독성사례": ["dose-limiting toxicity event"],
    "내약성": ["tolerability"],
    "중단사유": ["reason for discontinuation"],
    "투여중단": ["treatment discontinuation"],
    "사망": ["death", "fatal outcome"],
    "사망률": ["mortality rate"],
    "전체사망률": ["all-cause mortality"],
    "입원": ["hospitalization"],
    "응급실방문": ["emergency room visit"],
    "과민반응": ["hypersensitivity reaction"],
    "아나필락시스": ["anaphylaxis"],
    "간독성": ["hepatotoxicity"],
    "신독성": ["nephrotoxicity"],
    "심장독성": ["cardiotoxicity"],
    "골수억제": ["myelosuppression"],
    "호중구감소증": ["neutropenia"],
    "혈소판감소증": ["thrombocytopenia"],
    "빈혈": ["anemia"],
    "발열성호중구감소증": ["febrile neutropenia"],
    "감염": ["infection"],
    "중증도등급": ["severity grade"],
    "등급분류": ["grading classification"],
    "인과관계평가": ["causality assessment"],
    "약물감시": ["pharmacovigilance"],
    "신호탐지": ["signal detection"],
    "안전성보고서": ["safety report"],
    "정기적정보업데이트보고서": ["periodic safety update report"],
    "위해성": ["risk"],
    "유익성위해성평가": ["benefit-risk assessment"],
    "허용가능한이상반응한계": ["acceptable adverse event limit"],
    "이상반응발생률": ["adverse event incidence rate"],
}

CORE_STATISTICS: dict[str, list[str]] = {
    "신뢰구간": ["confidence interval"],
    "유의수준": ["significance level"],
    "유의확률": ["p-value"],
    "제1종오류": ["type I error"],
    "제2종오류": ["type II error"],
    "귀무가설": ["null hypothesis"],
    "대립가설": ["alternative hypothesis"],
    "효과크기": ["effect size"],
    "상대위험도": ["relative risk"],
    "위험비": ["hazard ratio"],
    "오즈비": ["odds ratio"],
    "평균차이": ["mean difference"],
    "표준편차": ["standard deviation"],
    "표준오차": ["standard error"],
    "중앙값": ["median"],
    "사분위범위": ["interquartile range"],
    "생존분석": ["survival analysis"],
    "생존곡선": ["survival curve"],
    "무진행생존기간": ["progression-free survival"],
    "전체생존기간": ["overall survival"],
    "무병생존기간": ["disease-free survival"],
    "반응지속기간": ["duration of response"],
    "치료의도분석": ["intention-to-treat analysis"],
    "프로토콜순응분석": ["per-protocol analysis"],
    "안전성분석집단": ["safety analysis population"],
    "결측치": ["missing data"],
    "결측치대체": ["missing data imputation"],
    "탈락률": ["dropout rate"],
    "추적관찰소실": ["loss to follow-up"],
    "민감도분석": ["sensitivity analysis"],
    "하위군분석": ["subgroup analysis"],
    "다중검정보정": ["multiplicity adjustment"],
    "베이지안분석": ["Bayesian analysis"],
    "몬테카를로시뮬레이션": ["Monte Carlo simulation"],
    "반복측정": ["repeated measures"],
    "공분산분석": ["analysis of covariance"],
    "회귀분석": ["regression analysis"],
    "로지스틱회귀": ["logistic regression"],
    "콕스비례위험모형": ["Cox proportional hazards model"],
}

CORE_POPULATION: dict[str, list[str]] = {
    "환자군": ["patient population"],
    "전체환자": ["overall patient population", "all patients"],
    "대상환자": ["eligible patients"],
    "등록환자": ["enrolled patients"],
    "무작위배정환자": ["randomized patients"],
    "치료받은환자": ["treated patients"],
    "소아환자": ["pediatric patients"],
    "성인환자": ["adult patients"],
    "고령환자": ["elderly patients"],
    "임산부": ["pregnant women"],
    "간기능장애환자": ["patients with hepatic impairment"],
    "신기능장애환자": ["patients with renal impairment"],
    "기저질환": ["comorbidity"],
    "동반질환": ["comorbid condition"],
    "이전치료력": ["prior treatment history"],
    "치료경험환자": ["previously treated patients"],
    "치료경험없는환자": ["treatment-naive patients"],
    "재발난치성환자": ["relapsed/refractory patients"],
    "전이성질환환자": ["patients with metastatic disease"],
    "국소진행성질환환자": ["patients with locally advanced disease"],
    "조직형": ["histology", "histologic subtype"],
    "병기": ["disease stage"],
    "수행능력점수": ["performance status"],
    "동부종양학협력그룹수행능력": ["ECOG performance status"],
    "체질량지수": ["body mass index"],
    "체표면적": ["body surface area"],
    "유전자변이양성환자": ["patients with the gene mutation"],
    "바이오마커양성환자": ["biomarker-positive patients"],
    "면역관문억제제경험환자": ["patients previously treated with checkpoint inhibitors"],
}

CORE_ENDPOINTS: dict[str, list[str]] = {
    "평가변수": ["endpoint"],
    "주평가변수": ["primary endpoint"],
    "2차평가변수": ["secondary endpoint"],
    "탐색적평가변수": ["exploratory endpoint"],
    "반응률": ["response rate"],
    "전체반응률": ["overall response rate"],
    "객관적반응률": ["objective response rate"],
    "완전관해": ["complete response"],
    "부분관해": ["partial response"],
    "안정병변": ["stable disease"],
    "진행병변": ["progressive disease"],
    "질병통제율": ["disease control rate"],
    "임상적이득률": ["clinical benefit rate"],
    "반응지속률": ["durable response rate"],
    "삶의질": ["quality of life"],
    "환자보고결과": ["patient-reported outcome"],
    "통증점수": ["pain score"],
    "기능평가척도": ["functional assessment scale"],
    "영상학적평가": ["radiographic assessment"],
    "고형암반응평가기준": ["RECIST criteria"],
    "면역관련반응평가기준": ["immune-related response criteria"],
    "바이오마커반응": ["biomarker response"],
    "약리학적반응": ["pharmacologic response"],
    "대리평가변수": ["surrogate endpoint"],
    "복합평가변수": ["composite endpoint"],
    "평가시점": ["assessment timepoint"],
    "기준시점": ["baseline"],
    "추적관찰기간": ["follow-up period"],
    "관찰기간": ["observation period"],
    "분석시점": ["analysis cutoff"],
}

CORE_ADMIN: dict[str, list[str]] = {
    "임상시험결과보고서": ["clinical study report"],
    "통계분석계획서": ["statistical analysis plan"],
    "자료관리계획서": ["data management plan"],
    "원시자료": ["source data"],
    "원본문서": ["source document"],
    "자료입력": ["data entry"],
    "자료검증": ["data verification"],
    "자료정합성점검": ["data consistency check"],
    "쿼리해결": ["query resolution"],
    "데이터베이스잠금": ["database lock"],
    "모니터링방문": ["monitoring visit"],
    "현장점검방문": ["site visit"],
    "이상반응보고서": ["adverse event report"],
    "중대한이상반응보고서": ["serious adverse event report"],
    "신속보고": ["expedited reporting"],
    "연간안전성보고서": ["annual safety report"],
    "개발중안전성업데이트보고서": ["development safety update report"],
    "동의철회": ["consent withdrawal"],
    "피험자번호": ["subject number"],
    "스크리닝실패": ["screening failure"],
    "방문일정": ["visit schedule"],
    "방문순응도": ["visit compliance"],
    "복약순응도": ["medication adherence"],
    "투약일지": ["dosing diary"],
    "임상시험공급계획": ["clinical supply plan"],
    "눈가림코드해제": ["blind-breaking code"],
    "임상시험종료보고": ["trial completion report"],
}

CORE_GENERAL: dict[str, list[str]] = {
    "진단": ["diagnosis"],
    "예후": ["prognosis"],
    "재발": ["relapse", "recurrence"],
    "전이": ["metastasis"],
    "증상": ["symptom"],
    "징후": ["sign"],
    "합병증": ["complication"],
    "유병률": ["prevalence"],
    "발생률": ["incidence"],
    "자연경과": ["natural history"],
    "표준치료": ["standard of care"],
    "1차치료": ["first-line treatment"],
    "2차치료": ["second-line treatment"],
    "3차치료": ["third-line treatment"],
    "구제요법": ["salvage therapy"],
    "유지요법": ["maintenance therapy"],
    "보조요법": ["adjuvant therapy"],
    "선행보조요법": ["neoadjuvant therapy"],
    "고식적치료": ["palliative treatment"],
    "완치": ["cure"],
    "관해": ["remission"],
    "악화": ["worsening", "deterioration"],
    "호전": ["improvement"],
    "안정화": ["stabilization"],
    "질병진행": ["disease progression"],
    "무증상": ["asymptomatic"],
    "유증상": ["symptomatic"],
    "만성질환": ["chronic disease"],
    "급성질환": ["acute illness"],
    "희귀질환": ["rare disease"],
    "난치성질환": ["refractory disease"],
}

CORE_ONCOLOGY: dict[str, list[str]] = {
    "고형암": ["solid tumor"],
    "혈액암": ["hematologic malignancy"],
    "결장직장암": ["colorectal cancer"],
    "위암": ["gastric cancer"],
    "간세포암": ["hepatocellular carcinoma"],
    "췌장암": ["pancreatic cancer"],
    "폐암": ["lung cancer"],
    "비소세포폐암": ["non-small cell lung cancer"],
    "소세포폐암": ["small cell lung cancer"],
    "유방암": ["breast cancer"],
    "난소암": ["ovarian cancer"],
    "자궁경부암": ["cervical cancer"],
    "전립선암": ["prostate cancer"],
    "신세포암": ["renal cell carcinoma"],
    "방광암": ["bladder cancer"],
    "두경부암": ["head and neck cancer"],
    "식도암": ["esophageal cancer"],
    "담도암": ["biliary tract cancer"],
    "흑색종": ["melanoma"],
    "육종": ["sarcoma"],
    "백혈병": ["leukemia"],
    "급성골수성백혈병": ["acute myeloid leukemia"],
    "급성림프구성백혈병": ["acute lymphoblastic leukemia"],
    "만성골수성백혈병": ["chronic myeloid leukemia"],
    "림프종": ["lymphoma"],
    "비호지킨림프종": ["non-Hodgkin lymphoma"],
    "다발골수종": ["multiple myeloma"],
    "뇌종양": ["brain tumor"],
    "교모세포종": ["glioblastoma"],
    "갑상선암": ["thyroid cancer"],
    "원발부위": ["primary tumor site"],
    "종양크기": ["tumor size"],
    "종양반응": ["tumor response"],
    "종양표지자": ["tumor marker"],
    "종양미세환경": ["tumor microenvironment"],
    "전이병소": ["metastatic lesion"],
    "표적병변": ["target lesion"],
    "비표적병변": ["non-target lesion"],
    "새로운병변": ["new lesion"],
    "수술적절제": ["surgical resection"],
    "근치적절제": ["curative resection"],
    "방사선치료": ["radiation therapy"],
    "항암화학요법": ["chemotherapy"],
    "면역관문억제제": ["immune checkpoint inhibitor"],
    "면역관문억제제치료": ["checkpoint inhibitor therapy"],
    "피디엘원발현": ["PD-L1 expression"],
    "종양변이부담": ["tumor mutational burden"],
    "현미부수체불안정성": ["microsatellite instability"],
    "생검": ["biopsy"],
    "조직검사": ["tissue biopsy"],
    "액체생검": ["liquid biopsy"],
    "순환종양DNA": ["circulating tumor DNA"],
    "유전자패널검사": ["gene panel testing"],
    "동반진단": ["companion diagnostic"],
    "병리학적완전관해": ["pathologic complete response"],
    "수술전보조요법": ["neoadjuvant chemotherapy"],
    "수술후보조요법": ["adjuvant chemotherapy"],
    "유지항암요법": ["maintenance chemotherapy"],
    "고식적항암요법": ["palliative chemotherapy"],
    "항암제내성": ["drug resistance"],
    "교차내성": ["cross-resistance"],
    "암악액질": ["cancer cachexia"],
    "암성통증": ["cancer-related pain"],
}

CORE_CARDIOMETABOLIC: dict[str, list[str]] = {
    "고혈압": ["hypertension"],
    "당뇨병": ["diabetes mellitus"],
    "제2형당뇨병": ["type 2 diabetes mellitus"],
    "제1형당뇨병": ["type 1 diabetes mellitus"],
    "이상지질혈증": ["dyslipidemia"],
    "고콜레스테롤혈증": ["hypercholesterolemia"],
    "비만": ["obesity"],
    "대사증후군": ["metabolic syndrome"],
    "심부전": ["heart failure"],
    "박출률보존심부전": ["heart failure with preserved ejection fraction"],
    "박출률감소심부전": ["heart failure with reduced ejection fraction"],
    "급성심근경색": ["acute myocardial infarction"],
    "협심증": ["angina pectoris"],
    "관상동맥질환": ["coronary artery disease"],
    "부정맥": ["arrhythmia"],
    "심방세동": ["atrial fibrillation"],
    "뇌졸중": ["stroke"],
    "허혈성뇌졸중": ["ischemic stroke"],
    "출혈성뇌졸중": ["hemorrhagic stroke"],
    "정맥혈전색전증": ["venous thromboembolism"],
    "폐색전증": ["pulmonary embolism"],
    "만성신장질환": ["chronic kidney disease"],
    "말기신부전": ["end-stage renal disease"],
    "혈액투석": ["hemodialysis"],
    "복막투석": ["peritoneal dialysis"],
    "사구체여과율": ["glomerular filtration rate"],
    "단백뇨": ["proteinuria"],
    "당화혈색소": ["glycated hemoglobin", "HbA1c"],
    "공복혈당": ["fasting plasma glucose"],
    "인슐린저항성": ["insulin resistance"],
    "저혈당": ["hypoglycemia"],
    "고혈당": ["hyperglycemia"],
    "지단백": ["lipoprotein"],
    "저밀도지단백콜레스테롤": ["low-density lipoprotein cholesterol"],
    "고밀도지단백콜레스테롤": ["high-density lipoprotein cholesterol"],
    "중성지방": ["triglyceride"],
    "체중감소": ["weight loss"],
    "체중증가": ["weight gain"],
    "혈압강하": ["blood pressure reduction"],
}

CORE_NEURO_PSYCH: dict[str, list[str]] = {
    "알츠하이머병": ["Alzheimer's disease"],
    "파킨슨병": ["Parkinson's disease"],
    "다발성경화증": ["multiple sclerosis"],
    "근위축성측삭경화증": ["amyotrophic lateral sclerosis"],
    "뇌전증": ["epilepsy"],
    "편두통": ["migraine"],
    "말초신경병증": ["peripheral neuropathy"],
    "치매": ["dementia"],
    "인지기능저하": ["cognitive decline"],
    "우울증": ["depression"],
    "주요우울장애": ["major depressive disorder"],
    "불안장애": ["anxiety disorder"],
    "조현병": ["schizophrenia"],
    "양극성장애": ["bipolar disorder"],
    "자살사고": ["suicidal ideation"],
    "수면장애": ["sleep disorder"],
    "불면증": ["insomnia"],
    "주의력결핍과잉행동장애": ["attention-deficit/hyperactivity disorder"],
    "자폐스펙트럼장애": ["autism spectrum disorder"],
    "운동기능평가": ["motor function assessment"],
    "인지기능평가": ["cognitive function assessment"],
    "정신상태평가": ["mental status examination"],
}

CORE_INFECTIOUS_IMMUNE: dict[str, list[str]] = {
    "감염병": ["infectious disease"],
    "세균감염": ["bacterial infection"],
    "바이러스감염": ["viral infection"],
    "진균감염": ["fungal infection"],
    "패혈증": ["sepsis"],
    "폐렴": ["pneumonia"],
    "결핵": ["tuberculosis"],
    "인체면역결핍바이러스감염": ["HIV infection"],
    "만성바이러스간염": ["chronic viral hepatitis"],
    "비형간염": ["hepatitis B"],
    "씨형간염": ["hepatitis C"],
    "항생제내성": ["antibiotic resistance"],
    "항바이러스제": ["antiviral agent"],
    "백신": ["vaccine"],
    "예방접종": ["vaccination"],
    "자가면역질환": ["autoimmune disease"],
    "류마티스관절염": ["rheumatoid arthritis"],
    "전신홍반루푸스": ["systemic lupus erythematosus"],
    "건선": ["psoriasis"],
    "염증성장질환": ["inflammatory bowel disease"],
    "크론병": ["Crohn's disease"],
    "궤양성대장염": ["ulcerative colitis"],
    "면역억제제": ["immunosuppressant"],
    "생물학적제제치료": ["biologic therapy"],
    "염증표지자": ["inflammatory marker"],
    "씨반응단백": ["C-reactive protein"],
}

CORE_RESPIRATORY: dict[str, list[str]] = {
    "천식": ["asthma"],
    "만성폐쇄성폐질환": ["chronic obstructive pulmonary disease"],
    "특발성폐섬유증": ["idiopathic pulmonary fibrosis"],
    "폐기능검사": ["pulmonary function test"],
    "1초간노력성호기량": ["forced expiratory volume in one second"],
    "노력성폐활량": ["forced vital capacity"],
    "산소포화도": ["oxygen saturation"],
    "호흡곤란": ["dyspnea"],
    "급성악화": ["acute exacerbation"],
    "흡입치료제": ["inhaled therapy"],
}

CORE_TRIAL_OPS: dict[str, list[str]] = {
    "임상시험코디네이터": ["clinical research coordinator"],
    "연구간호사": ["research nurse"],
    "임상시험담당자": ["clinical trial staff"],
    "모니터요원": ["clinical research associate"],
    "임상시험수탁기관": ["contract research organization"],
    "임상시험실시기관선정": ["site selection"],
    "피험자모집": ["subject recruitment"],
    "피험자유지": ["subject retention"],
    "스크리닝방문": ["screening visit"],
    "기저방문": ["baseline visit"],
    "종료방문": ["end-of-study visit"],
    "조기종료": ["early termination"],
    "시험대상자동의": ["subject consent"],
    "건강한자원자": ["healthy volunteer"],
    "임상시험보험": ["clinical trial insurance"],
    "피험자보상": ["subject compensation"],
    "임상시험비용": ["clinical trial cost"],
    "임상시험예산": ["clinical trial budget"],
    "계약서": ["clinical trial agreement"],
    "자료공유계약": ["data sharing agreement"],
    "기밀유지계약": ["confidentiality agreement"],
    "이해상충": ["conflict of interest"],
    "연구자임상시험": ["investigator-initiated trial"],
    "자료전송동의": ["data transfer consent"],
    "전자증례기록서": ["electronic case report form"],
    "원격모니터링": ["remote monitoring"],
    "탈중앙화임상시험": ["decentralized clinical trial"],
    "원격의료방문": ["telehealth visit"],
    "환자유래자료": ["patient-generated data"],
    "실사용증거": ["real-world evidence"],
    "실사용자료": ["real-world data"],
}

CORE_LAB: dict[str, list[str]] = {
    "간기능검사": ["liver function test"],
    "신기능검사": ["renal function test"],
    "혈액검사": ["blood test"],
    "소변검사": ["urinalysis"],
    "전혈구검사": ["complete blood count"],
    "간효소수치": ["liver enzyme level"],
    "아스파르테이트아미노전이효소": ["aspartate aminotransferase", "AST"],
    "알라닌아미노전이효소": ["alanine aminotransferase", "ALT"],
    "빌리루빈": ["bilirubin"],
    "알부민": ["albumin"],
    "크레아티닌": ["creatinine"],
    "혈중요소질소": ["blood urea nitrogen"],
    "혈색소": ["hemoglobin"],
    "백혈구수": ["white blood cell count"],
    "호중구수": ["absolute neutrophil count"],
    "혈소판수": ["platelet count"],
    "국제표준화비율": ["international normalized ratio"],
    "심전도": ["electrocardiogram"],
    "큐티간격": ["QT interval"],
    "좌심실박출률": ["left ventricular ejection fraction"],
    "유전자형검사": ["genotyping"],
    "차세대염기서열분석": ["next-generation sequencing"],
    "면역조직화학염색": ["immunohistochemistry"],
    "형광동소보합법": ["fluorescence in situ hybridization"],
    "검체채취": ["sample collection"],
    "검체보관": ["sample storage"],
    "중앙검사실": ["central laboratory"],
}

CORE_IMAGING: dict[str, list[str]] = {
    "컴퓨터단층촬영": ["computed tomography"],
    "자기공명영상": ["magnetic resonance imaging"],
    "양전자방출단층촬영": ["positron emission tomography"],
    "초음파검사": ["ultrasonography"],
    "흉부엑스선촬영": ["chest X-ray"],
    "골스캔": ["bone scan"],
    "영상판독": ["imaging interpretation"],
    "중앙판독": ["central review"],
    "독립판독위원회": ["independent review committee"],
}

CORE_WOMENS_PEDS: dict[str, list[str]] = {
    "임신": ["pregnancy"],
    "수유부": ["breastfeeding women"],
    "가임기여성": ["women of childbearing potential"],
    "피임": ["contraception"],
    "기형유발성": ["teratogenicity"],
    "신생아": ["neonate"],
    "영아": ["infant"],
    "유아": ["toddler"],
    "청소년": ["adolescent"],
    "소아용량": ["pediatric dose"],
    "체중기반용량": ["weight-based dosing"],
    "성장발달": ["growth and development"],
}

CORE_EXTRA: dict[str, list[str]] = {
    "생체신호": ["vital signs"],
    "체온": ["body temperature"],
    "맥박수": ["pulse rate"],
    "호흡수": ["respiratory rate"],
    "수축기혈압": ["systolic blood pressure"],
    "이완기혈압": ["diastolic blood pressure"],
    "신체검진": ["physical examination"],
    "신경학적검진": ["neurological examination"],
    "통증평가도구": ["pain assessment tool"],
    "환자일지": ["patient diary"],
    "환자선호도": ["patient preference"],
    "환자참여": ["patient engagement"],
    "건강관련삶의질": ["health-related quality of life"],
    "약물경제성평가": ["pharmacoeconomic evaluation"],
    "비용효과분석": ["cost-effectiveness analysis"],
    "건강보험급여": ["health insurance reimbursement"],
    "급여기준": ["reimbursement criteria"],
    "약가": ["drug pricing"],
    "약가협상": ["price negotiation"],
    "허가용량": ["approved dose"],
    "임상적유용성": ["clinical utility"],
    "임상적의미": ["clinical significance"],
    "통계적유의성": ["statistical significance"],
    "임상적으로의미있는차이": ["clinically meaningful difference"],
    "최소임상적중요차이": ["minimal clinically important difference"],
    "치료효과": ["treatment effect"],
    "치료실패": ["treatment failure"],
    "치료반응예측인자": ["predictive biomarker of response"],
    "예후인자": ["prognostic factor"],
    "위험인자": ["risk factor"],
    "보호인자": ["protective factor"],
    "교란변수": ["confounding variable"],
    "공변량": ["covariate"],
    "기저특성": ["baseline characteristic"],
    "인구학적특성": ["demographic characteristic"],
    "동반약물": ["concomitant medication"],
    "금지약물": ["prohibited medication"],
    "세척기간": ["washout period"],
    "유도기간": ["induction period"],
    "유지기간": ["maintenance period"],
    "연장투여기간": ["extension treatment period"],
    "안전성추적관찰기간": ["safety follow-up period"],
    "장기안전성": ["long-term safety"],
    "장기유효성": ["long-term efficacy"],
    "재투여": ["re-treatment"],
    "재도전": ["rechallenge"],
    "용량재조정": ["dose re-titration"],
    "용량적정": ["dose titration"],
    "고정용량": ["fixed dose"],
    "체중조정용량": ["weight-adjusted dose"],
    "체표면적조정용량": ["body-surface-area-adjusted dose"],
    "최초인체투여시험": ["first-in-human trial"],
    "개념증명시험": ["proof-of-concept trial"],
    "가교임상시험": ["bridging study"],
    "국가간비교시험": ["multinational trial"],
    "지역별분석": ["regional subgroup analysis"],
    "인종별분석": ["race subgroup analysis"],
    "성별분석": ["sex subgroup analysis"],
    "연령별분석": ["age subgroup analysis"],
    "반응자분석": ["responder analysis"],
    "비반응자": ["non-responder"],
    "조기반응자": ["early responder"],
    "지연반응자": ["late responder"],
    "실패후전환": ["crossover after failure"],
    "눈가림평가자": ["blinded assessor"],
    "독립판정위원회": ["adjudication committee"],
    "사건판정": ["event adjudication"],
    "데이터안전성모니터링위원회": ["data safety monitoring board"],
    "무용성중단": ["futility stopping"],
    "유효성조기중단": ["early stopping for efficacy"],
    "안전성조기중단": ["early stopping for safety"],
    "표본크기재산정": ["sample size re-estimation"],
    "그룹순차설계": ["group sequential design"],
    "베이지안적응설계": ["Bayesian adaptive design"],
    "바스켓시험": ["basket trial"],
    "엄브렐러시험": ["umbrella trial"],
    "플랫폼시험": ["platform trial"],
    "합성대조군": ["synthetic control arm"],
    "외부대조군": ["external control arm"],
    "과거대조군": ["historical control"],
    "실제임상데이터대조군": ["real-world data control arm"],
}

_BODY_SYSTEM_QUALIFIERS = {
    "심장": "cardiac",
    "신장": "renal",
    "간": "hepatic",
    "폐": "pulmonary",
    "뇌": "cerebral",
    "피부": "skin",
    "위장관": "gastrointestinal",
    "신경계": "neurologic",
    "면역계": "immune system",
    "내분비계": "endocrine",
}
_BODY_SYSTEM_ROOTS = {
    "독성": "toxicity",
    "기능": "function",
    "질환": "disorder",
    "손상": "injury",
    "장애": "impairment",
    "모니터링": "monitoring",
    "검사": "test",
}
_AGE_QUALIFIERS = {
    "소아": "pediatric",
    "청소년": "adolescent",
    "성인": "adult",
    "고령": "elderly",
    "노인": "geriatric",
}
_AGE_ROOTS = {"환자": "patients", "코호트": "cohort", "집단": "population"}
_STAGE_QUALIFIERS = {"1기": "stage I", "2기": "stage II", "3기": "stage III", "4기": "stage IV"}
_STAGE_ROOTS = {"암": "cancer", "병기": "disease stage"}

_CORE_CATEGORIES = (
    CORE_DESIGN,
    CORE_REGULATORY,
    CORE_PHARMACOLOGY,
    CORE_SAFETY,
    CORE_STATISTICS,
    CORE_POPULATION,
    CORE_ENDPOINTS,
    CORE_ADMIN,
    CORE_GENERAL,
    CORE_ONCOLOGY,
    CORE_CARDIOMETABOLIC,
    CORE_NEURO_PSYCH,
    CORE_INFECTIOUS_IMMUNE,
    CORE_RESPIRATORY,
    CORE_TRIAL_OPS,
    CORE_LAB,
    CORE_IMAGING,
    CORE_WOMENS_PEDS,
    CORE_EXTRA,
)

# Systematic qualifier x root combinations. Each pair is a real, commonly used
# Korean clinical-research phrase, not an arbitrary cartesian product: every
# axis below only combines with roots that normal usage actually pairs with.
_PHASE_QUALIFIERS = {"1차": "primary", "2차": "secondary", "3차": "tertiary"}
_ANALYSIS_ROOTS = {
    "평가변수": "endpoint",
    "종료점": "endpoint",
    "분석": "analysis",
    "목표": "objective",
    "결과지표": "outcome measure",
    "결과": "outcome",
}
_SEVERITY_QUALIFIERS = {
    "경증": "mild",
    "중등도": "moderate",
    "중증": "severe",
    "생명을위협하는": "life-threatening",
}
_SAFETY_ROOTS = {
    "이상반응": "adverse event",
    "부작용": "side effect",
    "합병증": "complication",
    "이상사례": "adverse event",
    "독성": "toxicity",
    "증상": "symptom",
}
_RESPONSE_QUALIFIERS = {
    "완전": "complete",
    "부분": "partial",
    "객관적": "objective",
    "주관적": "subjective",
}
_RESPONSE_ROOTS = {
    "반응": "response",
    "관해": "remission",
    "효과": "effect",
    "개선": "improvement",
    "악화": "worsening",
}
_COHORT_QUALIFIERS = {
    "전체": "overall",
    "치료의도": "intention-to-treat",
    "프로토콜순응": "per-protocol",
    "안전성": "safety",
    "약동학": "pharmacokinetic",
    "최대": "full",
}
_COHORT_ROOTS = {"분석집단": "analysis population", "대상군": "population"}
_TIMING_QUALIFIERS = {
    "기준": "baseline",
    "추적관찰": "follow-up",
    "단기": "short-term",
    "장기": "long-term",
    "중간": "interim",
    "최종": "final",
}
_ASSESSMENT_ROOTS = {
    "평가": "assessment",
    "방문": "visit",
    "분석": "analysis",
    "보고": "report",
    "관찰": "observation",
}
_DOSE_QUALIFIERS = {
    "최소유효": "minimum effective",
    "최대내약": "maximum tolerated",
    "권장": "recommended",
    "표준": "standard",
    "누적": "cumulative",
}
_DOSE_ROOTS = {"용량": "dose", "용법": "dosing regimen"}
_LINE_QUALIFIERS = {
    "1차": "first-line",
    "2차": "second-line",
    "3차": "third-line",
    "4차": "fourth-line",
}
_LINE_ROOTS = {"치료": "treatment", "요법": "therapy"}
_GRADE_QUALIFIERS = {
    "1등급": "grade 1",
    "2등급": "grade 2",
    "3등급": "grade 3",
    "4등급": "grade 4",
    "5등급": "grade 5",
}
_GRADE_ROOTS = {
    "이상반응": "adverse event",
    "독성": "toxicity",
    "호중구감소증": "neutropenia",
    "설사": "diarrhea",
    "피로": "fatigue",
    "발진": "rash",
}
_PHASE_NUMBER_QUALIFIERS = {
    "1상": "phase 1",
    "2상": "phase 2",
    "3상": "phase 3",
    "4상": "phase 4",
    "1/2상": "phase 1/2",
    "2/3상": "phase 2/3",
}
_PHASE_NUMBER_ROOTS = {"임상시험": "trial", "연구": "study"}
_ROUTE_QUALIFIERS = {
    "경구": "oral",
    "정맥": "intravenous",
    "피하": "subcutaneous",
    "근육": "intramuscular",
    "국소": "topical",
    "흡입": "inhaled",
}
_ROUTE_ROOTS = {"투여": "administration", "제형": "formulation"}
_WINDOW_QUALIFIERS = {
    "치료전": "pre-treatment",
    "치료중": "on-treatment",
    "치료후": "post-treatment",
    "추적관찰중": "during follow-up",
}
_WINDOW_ROOTS = {"평가": "assessment", "측정": "measurement"}
_COMPARISON_QUALIFIERS = {
    "실험군대비": "versus the treatment arm",
    "대조군대비": "versus the control arm",
    "위약대비": "versus placebo",
    "기준치대비": "versus baseline",
}
_COMPARISON_ROOTS = {"차이": "difference", "변화량": "change"}
_DIRECTION_QUALIFIERS = {"증가": "increase", "감소": "decrease", "유지": "maintenance"}
_MEASURE_ROOTS = {"수치": "value", "비율": "proportion", "빈도": "frequency"}
_ONSET_QUALIFIERS = {
    "조기": "early-onset",
    "후기": "late-onset",
    "지연성": "delayed-onset",
    "즉시": "immediate-onset",
}
_EVENT_ROOTS = {"발현": "onset", "발생": "occurrence", "재발": "recurrence"}


def _combine(qualifiers: dict[str, str], roots: dict[str, str]) -> dict[str, list[str]]:
    combined: dict[str, list[str]] = {}
    for q_ko, q_en in qualifiers.items():
        for r_ko, r_en in roots.items():
            combined[f"{q_ko} {r_ko}"] = [f"{q_en} {r_en}"]
    return combined


def _build_glossary() -> dict[str, list[str]]:
    glossary: dict[str, list[str]] = {}
    for category in _CORE_CATEGORIES:
        glossary.update(category)
    for qualifiers, roots in (
        (_PHASE_QUALIFIERS, _ANALYSIS_ROOTS),
        (_SEVERITY_QUALIFIERS, _SAFETY_ROOTS),
        (_RESPONSE_QUALIFIERS, _RESPONSE_ROOTS),
        (_COHORT_QUALIFIERS, _COHORT_ROOTS),
        (_TIMING_QUALIFIERS, _ASSESSMENT_ROOTS),
        (_DOSE_QUALIFIERS, _DOSE_ROOTS),
        (_LINE_QUALIFIERS, _LINE_ROOTS),
        (_GRADE_QUALIFIERS, _GRADE_ROOTS),
        (_PHASE_NUMBER_QUALIFIERS, _PHASE_NUMBER_ROOTS),
        (_ROUTE_QUALIFIERS, _ROUTE_ROOTS),
        (_WINDOW_QUALIFIERS, _WINDOW_ROOTS),
        (_COMPARISON_QUALIFIERS, _COMPARISON_ROOTS),
        (_DIRECTION_QUALIFIERS, _MEASURE_ROOTS),
        (_ONSET_QUALIFIERS, _EVENT_ROOTS),
        (_BODY_SYSTEM_QUALIFIERS, _BODY_SYSTEM_ROOTS),
        (_AGE_QUALIFIERS, _AGE_ROOTS),
        (_STAGE_QUALIFIERS, _STAGE_ROOTS),
    ):
        for term, glosses in _combine(qualifiers, roots).items():
            glossary.setdefault(term, glosses)
    return glossary


GLOSSARY: dict[str, list[str]] = _build_glossary()


def contains_hangul(text: str) -> bool:
    return bool(_HANGUL.search(text or ""))


@lru_cache(maxsize=512)
def translate_to_english(text: str) -> str | None:
    """Best-effort KO->EN gloss for search-query widening only.

    Returns None when nothing in the fixed bootstrap glossary matches, so
    callers can fall back to the original text rather than inventing a
    translation. Longest phrase match wins; unmatched tokens pass through
    unchanged so partially-known phrases still widen recall.
    """
    normalized = (text or "").strip()
    if not normalized:
        return None
    if normalized in GLOSSARY:
        return GLOSSARY[normalized][0]
    tokens = normalized.split()
    translated: list[str] = []
    matched_any = False
    i = 0
    while i < len(tokens):
        matched = False
        for span in (3, 2, 1):
            if i + span <= len(tokens):
                phrase = " ".join(tokens[i : i + span])
                if phrase in GLOSSARY:
                    translated.append(GLOSSARY[phrase][0])
                    i += span
                    matched = True
                    matched_any = True
                    break
        if not matched:
            translated.append(tokens[i])
            i += 1
    return " ".join(translated) if matched_any else None


def search_term(asset: str) -> str:
    """Build the TITLE_ABS search fragment for a (possibly Korean) asset name.

    Pure function of `asset` alone so independent reconciliation checks
    (e.g. Collection.consistent_followup_provenance) can recompute the exact
    same fragment without re-running the glossary lookup differently.
    """
    cleaned = asset.strip()
    if contains_hangul(cleaned):
        gloss = translate_to_english(cleaned)
        if gloss and gloss != cleaned:
            return f'("{cleaned}" OR "{gloss}")'
    return f'"{cleaned}"'
