"""Export a curated, pinned evidence packet and separate precomputed synthetic runs.

Run from the repository root: python -m trialboard.evidence.build
No runtime remote fetch, private clinical data, or LLM call is performed.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pdfplumber

from trialboard.evidence.pdf import locate, render_page
from trialboard.review.engine import run_review
from trialboard.review.example import example_designs, example_scenarios, make_example
from trialboard.review.report import to_markdown

ROOT = Path(__file__).resolve().parents[2]
SOURCES = {
    "fda_letter_2021": {
        "title": "FDA sotorasib 최초 승인서한",
        "issuer": "FDA",
        "published": "2021-05-28",
        "date_precision": "day",
        "kind": "regulatory_action",
        "url": "https://www.accessdata.fda.gov/drugsatfda_docs/appletter/2021/214665Orig1s000ltr.pdf",
        "sha256": "2a8afcae85c9e37576979af49571a1f87a2baa00aff6c4f43270b00ec20da9d9",
        "scope": "KRAS G12C 변이 NSCLC · 선행 전신치료 경험 · 2021년 당시 문서",
    },
    "fda_guidance_2024": {
        "title": "FDA 항암제 용량 최적화 최종 가이드라인",
        "issuer": "FDA",
        "published": "2024-08",
        "date_precision": "month",
        "kind": "nonbinding_guidance",
        "url": "https://www.fda.gov/media/164555/download",
        "sha256": "13b25858865d8b26db65f51cfa05eaaeed69094a7bc33099b75e5d16d248d0e3",
        "scope": "항암제 개발 중 용량 최적화에 관한 비구속적 권고",
    },
}

ANCHORS = (
    {
        "id": "dose_comparison",
        "source_id": "fda_letter_2021",
        "page": 4,
        "topic": "비교 용량",
        "title": "960 mg와 더 낮은 일일 용량의 비교를 요구",
        "quote": "the safety and efficacy of sotorasib 960 mg daily versus a lower daily dose",
        "interpretation": "시판후 요구사항 4071-2는 더 낮은 용량과의 "
        "안전성·효능 비교를 요구합니다.",
        "boundary": "이 문구는 낮은 용량을 240 mg로 특정하지 않습니다. "
        "해당 시험과 240 mg의 연결에는 별도의 protocol·결과 근거가 필요합니다.",
        "decision_question": "추가 비교할 용량을 어떤 근거로 정할 것인가?",
    },
    {
        "id": "randomized_requirement",
        "source_id": "fda_letter_2021",
        "page": 4,
        "topic": "시험 구조",
        "title": "이 사례에서는 다기관 무작위 시험을 요구",
        "quote": "Conduct a multicenter, randomized clinical trial to further characterize",
        "interpretation": "2021년 서한의 4071-2에서 요구한 시험 구조입니다.",
        "boundary": "특정 약물에 대한 이 요구를 모든 약물의 법적 의무로 일반화하지 않습니다.",
        "decision_question": "현재 근거의 환자군 차이를 줄이려면 어떤 비교 구조가 필요한가?",
    },
    {
        "id": "randomization_guidance",
        "source_id": "fda_guidance_2024",
        "page": 9,
        "topic": "시험 구조",
        "title": "용량 비교에는 무작위 평행군 설계를 권고",
        "quote": "A recommended trial design to compare multiple dosages is a randomized, parallel",
        "interpretation": "가이드라인은 용량 비교 방법으로 "
        "무작위 평행군 용량–반응 시험을 제시합니다.",
        "boundary": "권고와 법적 의무는 다릅니다. "
        "실제 약물·개발 단계에 맞는 설계 검토가 필요합니다.",
        "decision_question": "용량별 환자 특성의 차이를 어떻게 줄일 것인가?",
    },
    {
        "id": "sample_size",
        "source_id": "fda_guidance_2024",
        "page": 10,
        "topic": "표본수",
        "title": "용량 선택 목적과 확증적 가설 검정을 구분",
        "quote": "The trial does not need to be powered to demonstrate statistical superiority",
        "interpretation": "이 절의 용량 비교시험은 허가시험 수준의 유의수준으로 "
        "용량 간 우월성·비열등성을 입증할 검정력을 반드시 확보할 필요는 없습니다.",
        "boundary": "표본수 근거가 불필요하다는 뜻은 아닙니다. 각 용량의 안전성과 "
        "항종양 활성을 충분히 평가할 규모가 필요합니다. 원문의 이어지는 문장도 확인하세요.",
        "decision_question": "용량 선택에 충분한 정보를 얻으려면 몇 명을 평가할 것인가?",
    },
    {
        "id": "tolerability",
        "source_id": "fda_guidance_2024",
        "page": 11,
        "topic": "내약성",
        "title": "낮은 등급이라도 지속되는 증상 독성을 검토",
        "quote": "Persistent symptomatic adverse reactions",
        "interpretation": "원문은 지속되는 증상성 이상반응이 장기간 복용에 미치는 영향을 "
        "설명하며, 낮은 등급의 설사도 예로 듭니다.",
        "boundary": "Grade 3 이상 이상반응률만으로 용량의 내약성을 판단하지 않습니다. "
        "휴약·감량·중단과 관찰기간을 함께 확인해야 합니다.",
        "decision_question": "효능 외에 장기 복용 가능성을 판단할 자료가 충분한가?",
    },
)


def build(destination: Path = ROOT / "web" / "public" / "data") -> dict:
    destination.mkdir(parents=True, exist_ok=True)
    facts = []
    rendered = set()
    for anchor in ANCHORS:
        source = SOURCES[anchor["source_id"]]
        path = ROOT / "data" / "snapshots" / f"{source['sha256']}.pdf"
        location = locate(path, source["sha256"], anchor["page"], anchor["quote"])
        filename = f"{anchor['source_id']}-p{anchor['page']}.png"
        if filename not in rendered:
            render_page(path, source["sha256"], anchor["page"], destination / filename)
            rendered.add(filename)
        facts.append(
            {
                **anchor,
                **location,
                "image": f"/data/{filename}",
                "provenance": "public_primary_source",
                "curation": "developer_selected",
            }
        )
    packet = {
        "schema_version": "0.1",
        "case": "sotorasib_retrospective_review",
        "title": "소토라십 용량 비교 근거 검토",
        "question": "이 사례는 비교 용량·시험 구조·표본수·내약성 검토에 어떤 근거를 제공하는가?",
        "mode": "PINNED_PUBLIC_DOCUMENTS",
        "sources": SOURCES,
        "facts": facts,
        "extractor": f"pdfplumber/{pdfplumber.__version__}",
        "limitations": [
            "개발자가 고른 문구의 위치 확인이며 독립 전문가 검증은 아님",
            "후향 사례로서 실제 고객 약물의 용량 선택이나 규제 판단을 대체하지 않음",
            "2021년 사례와 2024년 지침을 구분하며 최신 허가 상태를 요약하는 화면은 아님",
        ],
    }
    packet["packet_hash"] = hashlib.sha256(
        json.dumps(packet, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
    (destination / "evidence.json").write_text(
        json.dumps(packet, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    for mode in ("normal", "denominator-error", "missing-evidence"):
        request = make_example(mode)
        report = run_review(request, example_scenarios(), example_designs())
        (destination / f"{mode}.json").write_text(
            report.model_dump_json(indent=2), encoding="utf-8"
        )
        (destination / f"{mode}.md").write_text(to_markdown(report), encoding="utf-8")
        (destination / f"{mode}.input.json").write_text(
            request.model_dump_json(indent=2),
            encoding="utf-8",
        )
    return packet


if __name__ == "__main__":
    result = build()
    print(f"Located {len(result['facts'])} anchors across {len(result['sources'])} pinned sources")
    print(ROOT / "web" / "public" / "data" / "evidence.json")
