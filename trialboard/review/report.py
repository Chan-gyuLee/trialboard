"""Readable Markdown projection of the same structured review returned to a future UI."""

from trialboard.review.models import ReviewReport


def _cell(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ").replace("\r", " ")


def to_markdown(report: ReviewReport) -> str:
    lines = [
        "# TrialBoard 용량 설계 검토 프로토타입",
        "",
        "**합성 자료 전용 · 실제 임상 근거 또는 투여 권고가 아닙니다.**",
        "",
        "## 검토 질문",
        "",
        report.question,
        "",
        f"상태: `{report.status}` · 입력 hash: `{report.input_digest}`",
        "",
        "## 구조화 원본과 일치한 근거",
        "",
        "아래 상태는 레코드 일치이며, 전문가 검증이나 과학적 타당성 판정이 아닙니다.",
        "",
        "| 용량군 | 항목 | 사건 수 / 분모 | 비율 | 자료 위치 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for item in report.checked_claims:
        r = item.claim.stated
        lines.append(
            f"| {_cell(r.arm)} | {_cell(r.metric)} | {r.events} / {r.denominator} "
            f"| {r.events / r.denominator:.1%} | `{item.locator}` |"
        )
    lines.extend(["", "## 판단을 막는 오류와 결측", ""])
    if not report.issues:
        lines.append(
            "이 fixture의 구조화 검증 오류는 없습니다. 임상적 자료 충분성을 뜻하지 않습니다."
        )
    for issue in report.issues:
        lines.extend(
            [
                f"- `{issue.code}`: {issue.message}",
                f"  - 보류할 판단: {issue.affected_decision}",
                f"  - 담당: {issue.owner}",
                f"  - 재개 조건: {issue.needed}",
            ]
        )
    lines.extend(
        [
            "",
            "## 설계 후보와 합성 시나리오 비교",
            "",
            "모수는 위 관측 비율에서 추정하지 않았습니다. 별도로 지정한 합성 가정입니다. "
            "이 계산은 자료 오류·결측을 해소하지 않습니다.",
            "",
        ]
    )
    arms = report.simulations[0].scenario.arms if report.simulations else ()
    headers = [
        "시나리오",
        "총 표본수",
        *(f"{a} 선택" for a in arms),
        "선택 보류",
        "가정상 최선의 선택",
        "실제 모수상 한계 초과 군 선택",
    ]
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("| " + " | ".join("---" for _ in headers) + " |")
    for r in report.simulations:
        cells = [
            _cell(r.scenario.label),
            str(r.total_sample_size),
            *(f"{r.selection_probability[a]:.1%}" for a in arms),
            f"{r.no_selection_probability:.1%}",
            f"{r.selects_true_utility_best_probability:.1%}",
            f"{r.selects_true_unsafe_probability:.1%}",
        ]
        lines.append("| " + " | ".join(cells) + " |")
    lines.extend(
        [
            "",
            "‘가정상 최선’은 합성 효용함수와 한계값에 따른 기준입니다. "
            "모든 군의 실제 모수가 한계를 넘는 시나리오에서는 선택 보류를 최선으로 셉니다.",
            "",
            "### 사용한 모수와 계산 가정",
            "",
        ]
    )
    seen = set()
    for r in report.simulations:
        s = r.scenario
        if s.id in seen:
            continue
        seen.add(s.id)
        lines.append(
            f"- {s.label}: 반응 확률 {s.response}, 이상반응 확률 {s.adverse_event}, "
            f"이상반응 가중치 {s.adverse_event_penalty}, "
            f"이상반응률 한계 {s.maximum_adverse_event_rate}. {s.rationale}."
        )
    if report.simulations:
        r = report.simulations[0]
        lines.extend(
            [
                "",
                f"반복 {r.repetitions:,}회 · seed {r.seed} · "
                f"NumPy {report.runtime['numpy']} · {report.runtime['rng']}",
                "",
            ]
        )
        lines.extend(f"- {a}" for a in r.assumptions)
        lines.extend(
            [
                "",
                "### Monte Carlo 표준오차",
                "",
                "시뮬레이션 반복에 따른 오차이며 임상 추정의 신뢰구간이 아닙니다. "
                "관측 빈도와 표준오차가 0이어도 실제 사건 확률이 0이라는 뜻은 아닙니다.",
                "",
            ]
        )
        for r in report.simulations:
            lines.append(
                f"- {r.scenario.id} / {r.design.id}: "
                + ", ".join(f"{k}={v:.5f}" for k, v in r.monte_carlo_se.items())
            )
    lines.extend(
        [
            "",
            "## 전문가에게 남길 질문",
            "",
            "- 실제 후보 용량의 PK/PD와 노출–반응 근거는 충분한가?",
            "- 감량·휴약·중단·지속 독성과 장기 내약성 자료는 무엇이 부족한가?",
            "- 어떤 평가 정의·관찰기간·환자군에서 비교해야 하는가?",
            "- 임상적으로 정당한 선택 기준·한계값과 모집 제약은 무엇인가?",
            "",
            "## 구현 범위와 제한",
            "",
        ]
    )
    lines.extend(f"- {item}" for item in report.limitations)
    return "\n".join(lines) + "\n"
