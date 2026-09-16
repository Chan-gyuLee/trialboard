"""Evidence-linked hypothetical fixed-size design comparisons, not clinical recommendations."""

import argparse
import json
import math
import os
import platform
from importlib.metadata import version
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import Field, model_validator

from trialboard.agent.clinical import metric_identity
from trialboard.agent.models import AgentInput, Contract, Critique, Digest, Extraction, Id, Text
from trialboard.agent.report import escaped
from trialboard.agent.revalidate import JSON_LIMIT, PDF_LIMIT, file_bytes, read_json, revalidate
from trialboard.agent.verify import critique_findings, verify
from trialboard.review.engine import simulate
from trialboard.review.models import Design, Scenario
from trialboard.serialization import sha256_json

Probability = Annotated[float, Field(ge=0, le=1)]


class Arm(Contract):
    id: Id
    source_dose: Text
    observation_ids: list[Id] = Field(min_length=1, max_length=12)


class Plan(Contract):
    id: Id
    label: Text
    per_arm: int = Field(ge=2, le=500)
    rationale: Text


class Assumption(Contract):
    id: Id
    label: Text
    response: list[Probability] = Field(min_length=2, max_length=4)
    adverse_event: list[Probability] = Field(min_length=2, max_length=4)
    adverse_event_penalty: float = Field(ge=0, le=10)
    maximum_adverse_event_rate: Probability
    rationale: Text
    provenance: Literal["user_declared_hypothetical"]


class DesignBrief(Contract):
    schema_version: Literal["design-brief/1"]
    source_digest: Digest
    review_content_digest: Digest
    question: Text
    arms: list[Arm] = Field(min_length=2, max_length=4)
    plans: list[Plan] = Field(min_length=2, max_length=4)
    scenarios: list[Assumption] = Field(min_length=1, max_length=6)
    seed: int = Field(ge=0, le=2**32 - 1)
    repetitions: int = Field(ge=100, le=20000)

    @model_validator(mode="after")
    def unique(self):
        for values in (self.arms, self.plans, self.scenarios):
            if len({v.id for v in values}) != len(values):
                raise ValueError("DUPLICATE_DESIGN_ID")
        if len({p.per_arm for p in self.plans}) != len(self.plans):
            raise ValueError("PLANS_MUST_DIFFER_IN_SAMPLE_SIZE")
        if len({a.source_dose for a in self.arms}) != len(self.arms):
            raise ValueError("DUPLICATE_SOURCE_DOSE")
        if any(
            a.id
            in {
                "no_selection",
                "true_utility_best",
                "true_unsafe",
                "__proto__",
                "constructor",
                "prototype",
            }
            for a in self.arms
        ):
            raise ValueError("RESERVED_ARM_ID")
        refs = [i for a in self.arms for i in a.observation_ids]
        if len(set(refs)) != len(refs):
            raise ValueError("OBSERVATION_CANNOT_BELONG_TO_MULTIPLE_ARMS")
        if any(
            len(s.response) != len(self.arms) or len(s.adverse_event) != len(self.arms)
            for s in self.scenarios
        ):
            raise ValueError("SCENARIO_ARM_COUNT_MISMATCH")
        if len(self.arms) * len(self.plans) * len(self.scenarios) * self.repetitions > 1000000:
            raise ValueError("SIMULATION_WORK_BUDGET_EXCEEDED")
        return self


def _ai_review(raw, checked):
    """Validate current completed AI opinion without trusting its adoption claims."""
    if raw is None:
        return None, [], set()
    r = read_json(raw)
    if not isinstance(r, dict) or (
        r.get("schema_version") != "field-recritique/1"
        or r.get("status") != "COMPLETED"
        or r.get("clinical_approval") is not False
        or r.get("user_values_modified") is not False
        or r.get("comparison_status") != "NOT_APPROVED"
        or r.get("reviewer_identity") != "UNAUTHENTICATED_USER"
        or r.get("execution_mode") not in ("CODEX_CHATGPT", "SCRIPTED_TEST_DOUBLE")
        or r.get("source_digest") != checked["source_digest"]
        or r.get("review_content_digest") != sha256_json(checked["review"])
    ):
        raise ValueError("CURRENT_COMPLETED_AI_REVIEW_REQUIRED")
    nested = r.get("revalidation", {})
    for key in (
        "review",
        "input",
        "accepted",
        "effective_extraction",
        "findings",
        "excluded_observation_ids",
        "rules_digest",
    ):
        if nested.get(key) != checked[key]:
            raise ValueError("AI_REVIEW_INPUT_MISMATCH")
    payload = {
        "source": checked["input"],
        "extraction": {"observations": checked["accepted"]},
        "deterministic_findings": checked["findings"],
    }
    if r.get("request_digest") != sha256_json(payload):
        raise ValueError("AI_REQUEST_DIGEST_MISMATCH")
    critique = Critique.model_validate(r.get("critique"))
    findings = critique_findings(
        AgentInput.model_validate(checked["input"]),
        Extraction.model_validate(payload["extraction"]),
        critique,
    )
    if any(f.code == "INVALID_CRITIQUE_REFERENCE" for f in findings):
        raise ValueError("INVALID_AI_REFERENCE")
    # Recompute from concerns; never use a report's remaining_draft_ids as authority.
    withheld = {f.observation_id for f in findings if f.code == "MODEL_CONCERN"}
    return r, critique.concerns, withheld


def compare_designs(
    brief_raw, review_raw, source_raw, pdf_raw, *, agent_raw=None, context=None, ai_raw=None
):
    brief = DesignBrief.model_validate(read_json(brief_raw))
    checked = revalidate(review_raw, source_raw, pdf_raw, agent_raw=agent_raw, context=context)
    if (
        brief.source_digest != checked["source_digest"]
        or brief.review_content_digest != sha256_json(checked["review"])
        or brief.question != checked["input"]["question"]
    ):
        raise ValueError("DESIGN_REVIEW_VERSION_MISMATCH")
    ai, concerns, ai_held = _ai_review(ai_raw, checked)
    accepted = {o["id"]: o for o in checked["accepted"]}
    all_ids = {r["id"] for r in checked["review"]["rows"]}
    blockers, questions, selected = [], [], []

    def block(code, arm=None, observation=None, detail=""):
        blockers.append(
            {"code": code, "arm_id": arm, "observation_id": observation, "detail": detail}
        )

    for arm in brief.arms:
        rows = []
        for oid in arm.observation_ids:
            if oid not in all_ids:
                raise ValueError("UNKNOWN_OBSERVATION_REFERENCE")
            if oid not in accepted or oid in ai_held:
                block("OBSERVATION_WITHHELD", arm.id, oid)
                continue
            row = accepted[oid]
            if row["fields"]["dose"]["value"] != arm.source_dose:
                block("SOURCE_DOSE_MISMATCH", arm.id, oid)
                continue
            rows.append(row)
        for family in ("response", "adverse_event"):
            matches = [
                r
                for r in rows
                if metric_identity(
                    r["fields"]["metric"]["value"],
                    r["fields"]["definition"]["value"],
                    r["fields"]["definition"]["quote"],
                )[0]
                == family
            ]
            if len(matches) != 1:
                block("ONE_ENDPOINT_ROW_REQUIRED", arm.id, detail=family)
        selected.extend(rows)
    extraction = Extraction.model_validate({"observations": selected})
    _, selected_issues = verify(AgentInput.model_validate(checked["input"]), extraction)
    for f in selected_issues:
        # Rates remain evidence only, never reconstructed counts or simulation truth.
        if f.code not in ("REPORTED_RATE_ONLY", "RATE_BINDING_UNVERIFIED"):
            block(f.code, observation=f.observation_id, detail=f.field or f.detail)
    for row in selected:
        for field in ("cohort", "population", "window", "definition"):
            if not row["fields"][field]["value"]:
                block("COMPARISON_CONTEXT_MISSING", observation=row["id"], detail=field)
    selected_ids = {r["id"] for r in selected}
    previous = checked.get("previous_model_review")
    if ai is None and previous and previous.get("critique"):
        for concern in previous["critique"]["concerns"]:
            if concern["scope"] == "comparison_limitation" and selected_ids.intersection(
                concern["observation_ids"]
            ):
                block("PREVIOUS_AI_LIMITATION_UNRESOLVED", detail=concern["reason"])
    for c in concerns:
        if c.scope == "comparison_limitation" and selected_ids.intersection(c.observation_ids):
            block("AI_COMPARISON_LIMITATION", detail=c.reason)

    blocker_labels = {
        "OBSERVATION_WITHHELD": "미확인·사용자 보류·규칙 제외 또는 AI 오류 의심",
        "SOURCE_DOSE_MISMATCH": "설계 용량과 원문 용량 불일치",
        "ONE_ENDPOINT_ROW_REQUIRED": "용량별 반응·이상반응 근거 누락 또는 중복",
        "COMPARISON_CONTEXT_MISSING": "환자군·분석집단·평가기간·정의 미보고",
        "COMPARISON_CONTEXT_MISMATCH": "용량군 간 환자군·평가기간·정의 불일치",
        "ENDPOINT_SUBTYPE_MISMATCH": "서로 다른 세부 평가변수",
        "ENDPOINT_MISSING": "용량별 필수 평가변수 근거 부족",
        "SECOND_DOSE_MISSING": "두 번째 용량 근거 부족",
        "AI_COMPARISON_LIMITATION": "AI가 제기한 비교 근거의 한계",
        "PREVIOUS_AI_LIMITATION_UNRESOLVED": "최초 AI 비교 한계 미해결 · 재검토 필요",
    }
    for index, b in enumerate(blockers):
        questions.append(
            {
                "id": f"gap-{index + 1}",
                "category": "evidence_gap",
                "priority": "BEFORE_COMPARISON",
                "trigger": b,
                "question": f"{b['arm_id'] or b['observation_id'] or '비교 자료'}의 "
                f"{blocker_labels.get(b['code'], '근거 검증 미완료')} 쟁점을 해결하려면 "
                "어떤 원문·집단·기간·정의 확인이 필요한가?",
                "answer_status": "UNANSWERED",
            }
        )
    for category, question in (
        ("dose_schedule", "각 후보 용량의 실제 투여량·빈도·감량/중단 규칙을 어떻게 정의할 것인가?"),
        ("endpoint", "반응·이상반응의 정의와 분석집단·평가 시점이 용량군 간 비교 목적에 적합한가?"),
        (
            "assumptions",
            "명시한 반응/이상반응 확률과 독립성 가정의 근거는 무엇이며 "
            "어떤 민감도 범위가 필요한가?",
        ),
        (
            "decision_rule",
            "효용 가중치와 이상반응 한계를 누가 어떤 근거로 정하고, "
            "어떤 결과에서 선택을 보류할 것인가?",
        ),
        ("feasibility", "설계안별 모집 가능성·관찰기간·탈락·결측·운영 비용은 어느 정도인가?"),
        (
            "statistics",
            "확증적 검정/검정력이 필요한가? 그렇다면 별도 통계 설계와 "
            "제1종 오류·중간분석 검토가 필요한가?",
        ),
    ):
        questions.append(
            {
                "id": category,
                "category": category,
                "priority": "BEFORE_PROTOCOL",
                "trigger": {
                    "plan_ids": [p.id for p in brief.plans],
                    "scenario_ids": [s.id for s in brief.scenarios],
                },
                "question": question,
                "answer_status": "UNANSWERED",
            }
        )
    simulations = []
    if not blockers:
        for s in brief.scenarios:
            scenario = Scenario(
                **s.model_dump(exclude={"provenance", "response", "adverse_event"}),
                arms=tuple(a.id for a in brief.arms),
                response=tuple(s.response),
                adverse_event=tuple(s.adverse_event),
                provenance="synthetic_assumption",
            )
            for p in brief.plans:
                simulations.append(
                    simulate(
                        scenario,
                        Design(id=p.id, label=p.label, per_arm=p.per_arm),
                        seed=brief.seed,
                        repetitions=brief.repetitions,
                    ).model_dump(mode="json")
                )
    tradeoffs = []
    for scenario in brief.scenarios:
        results = [s for s in simulations if s["scenario"]["id"] == scenario.id]
        if not results:
            continue
        reference = results[0]
        for alternative in results[1:]:
            comparison = {
                "scenario_id": scenario.id,
                "reference_plan_id": reference["design"]["id"],
                "alternative_plan_id": alternative["design"]["id"],
                "additional_participants": alternative["total_sample_size"]
                - reference["total_sample_size"],
                "correct_selection_or_abstention_delta": alternative[
                    "selects_true_utility_best_probability"
                ]
                - reference["selects_true_utility_best_probability"],
                "unsafe_selection_delta": alternative["selects_true_unsafe_probability"]
                - reference["selects_true_unsafe_probability"],
                "no_selection_delta": alternative["no_selection_probability"]
                - reference["no_selection_probability"],
                "delta_monte_carlo_se": {
                    key: math.hypot(
                        alternative["monte_carlo_se"][key], reference["monte_carlo_se"][key]
                    )
                    for key in ("true_utility_best", "true_unsafe", "no_selection")
                },
            }
            tradeoffs.append(comparison)
            questions.append(
                {
                    "id": f"tradeoff-{len(tradeoffs)}",
                    "category": "sample_size_tradeoff",
                    "priority": "BEFORE_PROTOCOL",
                    "trigger": comparison,
                    "question": f"{scenario.label} 가정에서 "
                    f"{comparison['alternative_plan_id']}안은 "
                    f"{comparison['reference_plan_id']}안보다 참여자 수가 "
                    f"{comparison['additional_participants']:+d}명, 가정 규칙상 올바른 선택/보류 "
                    f"빈도가 {comparison['correct_selection_or_abstention_delta'] * 100:+.1f}%p "
                    "달라진다. Monte Carlo 오차와 모집 부담을 고려할 때 "
                    "이 차이가 의사결정에 충분한가?",
                    "answer_status": "UNANSWERED",
                }
            )
    return {
        "schema_version": "design-comparison/1",
        "run_id": str(uuid4()),
        "status": "BLOCKED_EVIDENCE_LINK" if blockers else "HYPOTHETICAL_COMPARISON_ONLY",
        "clinical_approval": False,
        "recommended_plan_id": None,
        "model_calls": 0,
        "runtime": {"python": platform.python_version(), "numpy": version("numpy")},
        "engine_digest": sha256_json(
            {
                "design_compare": Path(__file__).read_text(encoding="utf-8"),
                "simulation": Path(__file__)
                .parents[1]
                .joinpath("review/engine.py")
                .read_text(encoding="utf-8"),
            }
        ),
        "review_content_digest": brief.review_content_digest,
        "brief_digest": sha256_json(brief.model_dump()),
        # Keep the exact hash material: Python and JavaScript serialize 0.0 and
        # small exponents differently. Readers parse and compare this as well.
        "brief_canonical": json.dumps(
            brief.model_dump(), ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ),
        "brief": brief.model_dump(),
        "revalidation": checked,
        "ai_review": ai,
        "ai_status": "CURRENT_REPORT_SUPPLIED_UNAUTHENTICATED" if ai else "NOT_SUPPLIED",
        "evidence_rows": selected,
        "blockers": blockers,
        "kol_questions": questions,
        "plans": [
            {
                **p.model_dump(),
                "allocation": "FIXED_EQUAL",
                "total_sample_size": p.per_arm * len(brief.arms),
            }
            for p in brief.plans
        ],
        "simulations": simulations,
        "tradeoffs": tradeoffs,
        "limitations": [
            "사용자가 지정한 고정 표본수·균등배정 대안의 가정 실험이며 "
            "완성된 임상 프로토콜이 아닙니다.",
            "관측 수치에서 참확률·효용 가중치·안전 한계·권장 표본수를 추정하지 않습니다.",
            "응답과 이상반응은 독립 Bernoulli 가정입니다. "
            "결측·탈락·중간중단·시간 결과는 미구현입니다.",
            "선택 빈도와 Monte Carlo 오차는 검정력·허가 확률·실제 최적 용량일 확률이 아닙니다.",
            "모든 군이 가정상 한계를 초과하면 올바른 선택/보류 지표는 선택하지 않는 빈도입니다.",
            "설계 차이의 Monte Carlo SE는 독립 난수 스트림 기준입니다. "
            "모수 불확실성을 포함하지 않습니다.",
            "KOL 질문은 규칙 기반의 미답변 검토 의제이며 전문가 의견이나 AI 실행 결과가 아닙니다.",
            "근거 링크와 내부 일관성이 임상적 비교 가능성을 증명하지 않습니다. "
            "최종안은 선택하지 않습니다.",
        ],
    }


def markdown(r):
    lines = [
        "# 근거 연결 설계 비교 초안",
        "",
        f"상태: {r['status']}",
        "임상 승인·권장 설계안 없음 · 명시적 가정 실험",
        "",
        f"질문: {escaped(r['brief']['question'])}",
        "",
        "## 설계 대안",
        "",
    ]
    for p in r["plans"]:
        lines.append(
            f"- {escaped(p['label'])}: 군당 {p['per_arm']}명 / 총 {p['total_sample_size']}명 · "
            f"{escaped(p['rationale'])}"
        )
    lines += ["", "## 용량군·명시적 가정", ""]
    for arm in r["brief"]["arms"]:
        lines.append(
            f"- {escaped(arm['id'])}: 원문 용량 {escaped(arm['source_dose'])} · "
            f"관측값 {escaped(arm['observation_ids'])}"
        )
    lines.append("확률 배열의 순서는 위 용량군 순서입니다. 실제 자료에서 추정한 값이 아닙니다.")
    for s in r["brief"]["scenarios"]:
        lines.append(
            f"- {escaped(s['label'])}: 반응 {s['response']}, 이상반응 {s['adverse_event']}, "
            f"효용 가중치 {s['adverse_event_penalty']}, 가정한 이상반응 한계 "
            f"{s['maximum_adverse_event_rate']} · {escaped(s['rationale'])}"
        )
    lines += ["", "## 가정별 비교 — 검정력 아님", ""]
    for s in r["simulations"]:
        lines.append(
            f"- {escaped(s['scenario']['label'])} / {escaped(s['design']['label'])}: "
            f"가정 규칙상 올바른 선택/보류 빈도 {s['selects_true_utility_best_probability']:.3f}, "
            f"가정상 한계 초과 군 선택 {s['selects_true_unsafe_probability']:.3f}, "
            f"선택 보류 {s['no_selection_probability']:.3f}"
        )
        lines.append(f"  Monte Carlo SE: {escaped(s['monte_carlo_se'])}")
    if not r["simulations"]:
        lines.append("근거 연결 쟁점으로 계산하지 않았습니다. 아래 선결 질문을 확인하세요.")
    lines += ["", "## KOL 검토 질문 — 답변 미확보", ""]
    lines += [f"- [{q['priority']}] {escaped(q['question'])}" for q in r["kol_questions"]]
    lines += ["", "## 한계", "", *[f"- {s}" for s in r["limitations"]], ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Evidence-linked hypothetical design comparison")
    for name in ("brief", "review", "source-export", "pdf"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    for name in ("agent-report", "ai-review"):
        parser.add_argument(f"--{name}", type=Path)
    for name in ("asset", "indication", "study", "question"):
        parser.add_argument(f"--{name}")
    args = parser.parse_args()
    context = {k: getattr(args, k) for k in ("asset", "indication", "study", "question")}
    try:
        result = compare_designs(
            file_bytes(args.brief, JSON_LIMIT),
            file_bytes(args.review, JSON_LIMIT),
            file_bytes(args.source_export, JSON_LIMIT),
            file_bytes(args.pdf, PDF_LIMIT),
            agent_raw=file_bytes(args.agent_report, JSON_LIMIT) if args.agent_report else None,
            ai_raw=file_bytes(args.ai_review, JSON_LIMIT) if args.ai_review else None,
            context=context if any(v is not None for v in context.values()) else None,
        )
        root = Path("output/design-comparison") / result["run_id"]
        root.mkdir(parents=True, mode=0o700)
        for name, content in [
            ("report.json", json.dumps(result, ensure_ascii=False, indent=2)),
            ("report.md", markdown(result)),
        ]:
            fd = os.open(root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(content)
    except (ValueError, TypeError, OSError, AttributeError):
        parser.exit(
            2, "설계 가정·근거·검토 버전·파일을 확인하세요. 입력/출력을 처리하지 못했습니다.\n"
        )
    print(f"{result['status']} | simulations={len(result['simulations'])} | model_calls=0")
    print(root / "report.json")


if __name__ == "__main__":
    main()
