"""Human-readable review record assembled from the same structured result."""

import re

from trialboard.agent.models import AgentReport


def escaped(value) -> str:
    text = str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return re.sub(r"([\\`*_{}\[\]()#+.!|~-])", r"\\\1", text).replace("\n", " ")


def markdown(report: AgentReport) -> str:
    lines = [
        "# 에이전트 근거 검토 기록",
        "",
        f"상태: {report.status}",
        f"실행: {report.execution_mode} / {escaped(report.model)}",
        f"입력 SHA-256: {report.input_digest}",
        f"질문: {escaped(report.input.question)}",
        "",
        "전문가 검토 전 초안입니다. 원문 의미 검증·임상 승인·설계 권고가 아닙니다.",
        "",
    ]
    if report.execution_mode == "SCRIPTED_TEST_DOUBLE":
        lines += ["**스크립트 테스트입니다. 실제 LLM을 호출하지 않았습니다.**", ""]
    if report.execution_mode == "CODEX_CHATGPT":
        lines += [
            "현재 CLI의 ChatGPT 로그인으로 실행한 개발용 검토입니다. "
            "개인 API 키·대회 API를 사용하지 않습니다.",
            "",
        ]
    received = [c for c in report.calls if c.input_tokens is not None]
    lines += [
        f"호출 기록 {len(report.calls)}개 / 사용량 확인 {len(received)}개 · "
        f"입력 {sum(c.input_tokens for c in received):,} / "
        f"출력 {sum(c.output_tokens for c in received):,}토큰",
        "실패한 호출의 사용량은 미확인일 수 있습니다. 계정의 잔여 한도가 아닙니다.",
        "",
    ]
    lines += [
        "## 실행 경로",
        "",
        " → ".join(e.stage for e in report.events),
        "",
        "## 검토 가능한 관측값 초안",
        "",
    ]
    for obs in report.accepted:
        lines += [f"### {escaped(obs.id)}", ""]
        mapped = next((m for m in report.metric_mappings if m.observation_id == obs.id), None)
        identity = (mapped.family, mapped.code) if mapped else "미분류"
        mapping_version = mapped.mapping_version if mapped else ""
        lines += [
            f"자료 유형: {obs.value_kind} · 원문 수치 그대로 보존",
            f"지표 분류: {escaped(identity)} · {escaped(mapping_version)}"
            " · 임상적 동등성 확정 아님",
            "",
        ]
        for name in type(obs.fields).model_fields:
            field = getattr(obs.fields, name)
            value = "미보고" if field.value is None else escaped(field.value)
            citation = "근거 없음" if field.span_id is None else escaped(field.span_id)
            lines.append(f"- {name}: {value} · {citation}")
    if not report.accepted:
        lines += ["채택한 관측값 없음. 실패 또는 미해결 쟁점을 먼저 확인하세요.", ""]
    lines += ["", "## 마지막 시도의 미해결 항목", ""]
    for event in report.events:
        if event.stage in ("FAILED", "BUDGET_EXCEEDED"):
            lines += [f"- 실행 중단: {escaped(code)}" for code in event.codes]
    if report.attempts:
        last = report.attempts[-1]
        lines += [
            f"- {i.code}: {escaped(i.observation_id or '')} "
            f"{escaped(i.field or '')} {escaped(i.detail)}"
            for i in last.findings
        ]
        if last.critique:
            lines += ["", "## 모델이 제안한 전문가 확인 질문 (미검증)", ""]
            lines += [f"- {escaped(q)}" for q in last.critique.next_questions]
    lines += ["", "## 출처 범위", ""]
    for span in report.input.spans:
        location = f"PDF p.{span.page}" if span.page is not None else span.locator or "웹 발췌"
        lines += [f"- {escaped(span.id)} · {escaped(location)} · SHA-256 {span.source_digest}"]
    lines += ["", "## 한계", "", *[f"- {s}" for s in report.limitations], ""]
    return "\n".join(lines)
