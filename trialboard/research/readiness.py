"""Explicit rule-based preparation checks, not statistical or clinical approval."""

import re
from decimal import Decimal, InvalidOperation

from trialboard.serialization import sha256_json

VERSION = "registry-readiness/1"
DOSE = re.compile(r"\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|ug|g)\b", re.I)
RESPONSE = re.compile(r"\b(?:objective|overall) response rate\b|\bORR\b", re.I)
SAFETY = re.compile(r"\badverse (?:events?|reactions?)\b|\bTEAEs?\b", re.I)
POOLED = re.compile(r"\b(?:single cohort|pooled|combined cohorts?|combined arms?)\b", re.I)


def finite_number(value):
    if not re.fullmatch(r"-?\d{1,12}(?:\.\d{1,12})?", str(value)):
        return None
    try:
        n = Decimal(str(value))
        return n if n.is_finite() else None
    except InvalidOperation:
        return None


def dose_key(label):
    value = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(mg|mcg|µg|ug|g)", label, re.I)
    return (Decimal(value[1]), value[2].lower()) if value else None


def assess_results(tables):
    """Keep each measure/class/category separate; group IDs are local to each table."""
    series = {}
    for row in tables["outcomes"]:
        title = row["title"]
        family = (
            "RESPONSE" if RESPONSE.search(title) else "SAFETY" if SAFETY.search(title) else "OTHER"
        )
        key = row["locator"].rsplit("/measurements/", 1)[0]
        series.setdefault(
            key,
            {
                "family": family,
                "title": title,
                "context": " · ".join(filter(None, [row["classTitle"], row["categoryTitle"]])),
                "rows": [],
            },
        )["rows"].append(row)
    # AE groups are local to the adverseEventsModule, never equivalent to OG identifiers.
    for row in tables["safety"]:
        key = "safety/" + row["metric"]
        series.setdefault(
            key,
            {
                "family": "SAFETY" if row["metric"] != "all-cause mortality" else "OTHER",
                "title": row["metric"],
                "context": "",
                "rows": [],
            },
        )["rows"].append(
            {
                **row,
                "value": row["affected"],
                "population": "",
                "definition": row["description"],
                "parameter": "COUNT_OF_PARTICIPANTS",
                "unit": "count of participants",
                "denominators": [{"unit": "Participants", "value": str(row["atRisk"])}]
                if row["atRisk"] is not None
                else [],
            }
        )
    assessed = []
    for key, group in series.items():
        rows = group.pop("rows")
        issues = []
        if len(rows) < 2:
            issues.append("SECOND_GROUP_MISSING")
        labels = [DOSE.findall(row["groupTitle"]) for row in rows]
        dose_keys = {dose_key(label[0]) for label in labels if len(label) == 1}
        if any(len(label) != 1 for label in labels) or len(dose_keys) < 2:
            issues.append("DISTINCT_DOSE_LABELS_MISSING")
        if len({key[1] for key in dose_keys if key is not None}) > 1:
            issues.append("DOSE_UNITS_DIFFER")
        if len({row["groupId"] for row in rows}) != len(rows):
            issues.append("DUPLICATE_GROUP")
        if any(
            POOLED.search(row.get("population", ""))
            or len(set(x.lower() for x in DOSE.findall(row["groupDescription"]))) > 1
            for row in rows
        ):
            issues.append("POOLED_OR_MULTI_DOSE_CONTEXT")
        is_count = all(
            row["unit"].casefold() in ("count of participants", "participants")
            and row["parameter"] in ("NUMBER", "COUNT_OF_PARTICIPANTS", "COUNT")
            for row in rows
        )
        is_percentage = all(
            row["unit"].casefold() in ("percentage of participants", "percent", "percentage", "%")
            and row["parameter"] == "NUMBER"
            for row in rows
        )
        if not is_count and not is_percentage:
            issues.append("UNSUPPORTED_VALUE_ROLE")
        for row in rows:
            denoms = row["denominators"]
            denominator = (
                finite_number(denoms[0]["value"])
                if len(denoms) == 1 and denoms[0]["unit"].casefold() == "participants"
                else None
            )
            value = finite_number(row["value"])
            if denominator is None or denominator <= 0 or denominator != int(denominator):
                issues.append("DENOMINATOR_UNRESOLVED")
            if (
                value is None
                or value < 0
                or (is_percentage and value > 100)
                or (
                    is_count
                    and (value != int(value) or denominator is not None and value > denominator)
                )
            ):
                issues.append("VALUE_UNRESOLVED")
        if any(not row["window"] or not row["definition"] for row in rows):
            issues.append("CONTEXT_INCOMPLETE")
        if any(
            len({row.get(field, "") for row in rows}) != 1
            for field in ["window", "definition", "population", "unit", "parameter"]
        ):
            issues.append("CONTEXT_DIFFERS")
        assessed.append(
            {
                "id": sha256_json({"snapshot": tables["snapshotDigest"], "key": key})[:24],
                **group,
                "groups": [
                    {
                        "label": row["groupTitle"],
                        "groupId": row["groupId"],
                        "locator": row["locator"],
                    }
                    for row in rows
                ],
                "status": "REVIEW_CANDIDATE" if not issues else "NEEDS_EVIDENCE",
                "issues": sorted(set(issues)),
                "valueKind": "REPORTED_PERCENTAGE"
                if is_percentage
                else "REPORTED_COUNT"
                if is_count
                else "OTHER",
            }
        )
    response = [s for s in assessed if s["family"] == "RESPONSE"]
    safety = [s for s in assessed if s["family"] == "SAFETY"]
    has_response = any(s["status"] == "REVIEW_CANDIDATE" for s in response)
    has_safety = any(s["status"] == "REVIEW_CANDIDATE" for s in safety)
    questions = []
    if not has_response:
        questions.append(
            "용량별 반응률의 분석집단·분모·평가시점이 일치하는 결과가 필요합니다. "
            "통합집단 결과를 나눠 쓰지 않습니다."
        )
    if not has_safety:
        questions.append("같은 정의·기간의 용량별 안전성 결과와 분석 분모를 확인해야 합니다.")
    if tables["limited"]:
        questions.append(
            "등록 결과표 일부가 처리 한도로 빠져 있습니다. 누락 범위를 확인해야 합니다."
        )
    questions.append(
        "효능과 안전성 표 사이의 환자군·용량 일정·관측 기간 연결 및 "
        "사용할 평가변수를 전문가가 확인해야 합니다."
    )
    return {
        "schema": VERSION,
        "snapshotDigest": tables["snapshotDigest"],
        "status": "EXPERT_REVIEW_REQUIRED"
        if has_response and has_safety and not tables["limited"]
        else "NEEDS_EVIDENCE",
        "method": "DETERMINISTIC_RULES",
        "clinicalApproved": False,
        "simulationExecuted": False,
        "series": assessed,
        "responseCandidate": has_response,
        "safetyCandidate": has_safety,
        "questions": questions,
        "steps": [
            "원본 스냅샷 지문 대조",
            "결과표별 집단·하위 항목·분모 연결",
            "용량 표기·수치 역할·정의·시점 점검",
            "누락 근거와 전문가 판단 항목 정리",
        ],
    }
