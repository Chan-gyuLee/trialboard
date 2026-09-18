"""Offline revalidation of human field reviews. Never calls a model or grants approval."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
from uuid import uuid4

from trialboard.agent.field_review_contract import (
    Citation,
    PdfSource,
    ReviewPacket,
    Value,
)
from trialboard.agent.models import AgentInput, AgentReport, Extraction, Span
from trialboard.agent.normalization import normalized_rate, reviewed_rates
from trialboard.agent.report import escaped
from trialboard.agent.verify import finding, verify
from trialboard.serialization import sha256_json

JSON_LIMIT = 8 * 1024 * 1024
PDF_LIMIT = 5 * 1024 * 1024


def read_json(raw: bytes, *, limit: int = JSON_LIMIT):
    if len(raw) > limit:
        raise ValueError("JSON_FILE_TOO_LARGE")

    def pairs(items):
        result = {}
        for key, value in items:
            if key in result or key in ("__proto__", "constructor", "prototype"):
                raise ValueError("UNSAFE_JSON_KEY")
            result[key] = value
        return result

    try:
        result = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs)
    except (UnicodeError, RecursionError) as exc:
        raise ValueError("INVALID_JSON") from exc
    pending, nodes = [(result, 0)], 0
    while pending:
        value, depth = pending.pop()
        nodes += 1
        if depth > 30 or nodes > 500000:
            raise ValueError("JSON_STRUCTURE_LIMIT")
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("NONFINITE_JSON")
        if isinstance(value, str):
            value.encode("utf-8")  # Reject lone surrogates before any output files are created.
        if isinstance(value, dict):
            pending.extend((v, depth + 1) for v in value.values())
        elif isinstance(value, list):
            pending.extend((v, depth + 1) for v in value)
    return result


def file_bytes(path: Path, limit: int):
    with path.open("rb") as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("FILE_TOO_LARGE")
    return raw


def _model_value(value):
    citation = value.citation
    return {
        "value": value.value,
        "span_id": citation.spanId if citation else None,
        "quote": citation.quote if citation else None,
    }


def _extraction(review, *, reviewed):
    rows, excluded = [], []
    for row in review.rows:
        fields = {}
        for name, field in row.fields.items():
            value = field.current if reviewed else field.original
            if reviewed and field.decision not in ("confirmed", "corrected"):
                if value.value is not None or field.decision == "held":
                    excluded.append(
                        finding(
                            "FIELD_HELD" if field.decision == "held" else "FIELD_UNREVIEWED",
                            row.id,
                            name,
                        )
                    )
                value = Value(value=None, citation=None)
            fields[name] = _model_value(value)
        rows.append({"id": row.id, "value_kind": row.valueKind, "fields": fields})
    return Extraction.model_validate({"observations": rows}), excluded


def _delta(before, after):
    # Sets are keyed by complete findings, not just codes that recur across observations.
    def key(f):
        return (f.code, f.observation_id or "", f.field or "", f.detail)

    old, new = {key(f): f for f in before}, {key(f): f for f in after}
    return {
        "added": [new[k].model_dump() for k in sorted(new.keys() - old.keys())],
        "no_longer_emitted": [old[k].model_dump() for k in sorted(old.keys() - new.keys())],
        "unchanged": [new[k].model_dump() for k in sorted(old.keys() & new.keys())],
    }


def revalidate(
    review_raw: bytes,
    source_raw: bytes,
    pdf_raw: bytes,
    *,
    agent_raw: bytes | None = None,
    context: dict | None = None,
):
    review = ReviewPacket.model_validate(read_json(review_raw))
    envelope = read_json(source_raw)
    if not isinstance(envelope, dict) or envelope.get("schemaVersion") != "pdf-evidence-review/1":
        raise ValueError("SOURCE_EXPORT_REQUIRED")
    source = PdfSource.model_validate(envelope.get("source"))
    if (
        len(pdf_raw) > PDF_LIMIT
        or not pdf_raw.startswith(b"%PDF-")
        or len(pdf_raw) != source.byteLength
        or hashlib.sha256(pdf_raw).hexdigest() != source.sha256
        or source.sha256 != review.sourceDigest
        or source.name != review.sourceName
    ):
        raise ValueError("SOURCE_IDENTITY_MISMATCH")
    index = {s.id: s for page in source.pages for s in page.spans}

    def check(value, *, checked=False):
        if value.citation is None:
            return
        c = value.citation
        span = index.get(c.spanId)
        if not span or span.page != c.page or not c.quote.strip() or c.quote not in span.text:
            raise ValueError("CITATION_SOURCE_MISMATCH")
        if checked and not span.box:
            raise ValueError("UNSUPPORTED_REVIEW_LOCATION")
        for support in value.supporting:
            s = index.get(support.spanId)
            if (
                not s
                or s.page != support.page
                or not support.quote.strip()
                or support.quote not in s.text
            ):
                raise ValueError("SUPPORT_SOURCE_MISMATCH")
            if not s.box:
                raise ValueError("UNSUPPORTED_SUPPORT_LOCATION")

    baseline_report = None
    if review.origin.kind == "imported_agent_report":
        if agent_raw is None or context is not None:
            raise ValueError("ORIGINAL_AGENT_REPORT_REQUIRED_WITHOUT_CONTEXT_OVERRIDE")
        if hashlib.sha256(agent_raw).hexdigest() != review.origin.reportDigest:
            raise ValueError("AGENT_FILE_DIGEST_MISMATCH")
        baseline_report = AgentReport.model_validate(read_json(agent_raw))
        r = baseline_report
        if (
            r.engine_version != "bounded-evidence-agent/3.2"
            or r.status not in ("DRAFT_FOR_EXPERT_REVIEW", "PARTIAL_ABSTENTION")
            or r.input.provenance != "user_pdf_export_unverified"
            or r.run_id != review.origin.runId
            or r.execution_mode != review.origin.mode
            or r.input_digest != sha256_json(r.input.model_dump())
            or not r.attempts
            or not r.attempts[-1].extraction
        ):
            raise ValueError("AGENT_REPORT_IDENTITY_MISMATCH")
        originals = {o.id: o for o in r.attempts[-1].extraction.observations}
        imported = {row.id: row for row in review.rows if row.origin == "imported_agent_report"}
        if (
            len(originals) != len(r.attempts[-1].extraction.observations)
            or imported.keys() != originals.keys()
        ):
            raise ValueError("IMPORTED_ROW_SET_CHANGED")
        agent_spans = {s.id: s for s in r.input.spans}
        for s in r.input.spans:
            span = index.get(s.id)
            if (
                not span
                or s.source_digest != source.sha256
                or s.page != span.page
                or s.text != span.text
            ):
                raise ValueError("AGENT_SOURCE_MISMATCH")
        for rid, row in imported.items():
            original = originals[rid]
            if row.valueKind != original.value_kind:
                raise ValueError("IMPORTED_VALUE_KIND_CHANGED")
            for name, field in row.fields.items():
                value = getattr(original.fields, name)
                s = agent_spans.get(value.span_id)
                citation = (
                    Citation(spanId=s.id, page=s.page, quote=value.quote)
                    if (s and value.quote and value.quote in s.text and value.value is not None)
                    else None
                )
                if field.original != Value(value=value.value, citation=citation):
                    raise ValueError("MODEL_ORIGINAL_CHANGED")
        context = {k: getattr(r.input, k) for k in ("asset", "indication", "study", "question")}
    elif agent_raw is not None or context is None:
        raise ValueError("MANUAL_CONTEXT_REQUIRED_WITHOUT_AGENT_REPORT")

    used = set()
    changes = []
    for row in review.rows:
        for name, field in row.fields.items():
            for value in [
                field.original,
                field.current,
                *(v for h in field.history for v in (h.before, h.after)),
            ]:
                normalized_rate(value, source, field=name, kind=row.valueKind)
            check(field.original)
            check(field.current, checked=field.decision in ("confirmed", "corrected"))
            for value in (field.original, field.current):
                if value.citation:
                    used.add(value.citation.spanId)
                used.update(c.spanId for c in value.supporting)
            for revision in field.history:
                check(revision.before)
                check(revision.after, checked=revision.decision != "held")
            if field.history:
                changes.append(
                    {
                        "observation_id": row.id,
                        "field": name,
                        "decision": field.decision,
                        "value_changed": field.original != field.current,
                        "revisions": len(field.history),
                    }
                )
    # Original source context stays available; no newly invented or external spans are fetched.
    if baseline_report:
        used.update(s.id for s in baseline_report.input.spans)
    if not used:
        # AgentInput requires source spans even for a completely withheld review.
        used.update(list(index)[:1])
    spans = [
        Span(id=s.id, page=s.page, source_digest=source.sha256, text=s.text)
        for s in index.values()
        if s.id in used
    ]
    data = AgentInput(**context, spans=spans, provenance="user_pdf_export_unverified")
    original, _ = _extraction(review, reviewed=False)
    effective, exclusions = _extraction(review, reviewed=True)
    before_accepted, before_issues = verify(data, original)
    # Even optional held fields gate the whole observation. Explicit hold must not become absence.
    held_rows = {f.observation_id for f in exclusions if f.code == "FIELD_HELD"}
    effective = Extraction(
        observations=[o for o in effective.observations if o.id not in held_rows]
    )
    rates = reviewed_rates(review, source)
    accepted, issues = verify(data, effective, normalized_rates=rates)
    issues += exclusions
    return {
        **({"normalized_rates": rates} if rates else {}),
        "schema_version": "field-revalidation/1",
        "rules_digest": sha256_json(
            {
                name: Path(__file__).with_name(name).read_text(encoding="utf-8")
                for name in (
                    "verify.py",
                    "clinical.py",
                    "field_review_contract.py",
                    "revalidate.py",
                    "normalization.py",
                )
            }
        ),
        "run_id": str(uuid4()),
        "execution_mode": "LOCAL_DETERMINISTIC_REVALIDATION",
        "model_calls": 0,
        "clinical_approval": False,
        "reviewer_identity": "UNAUTHENTICATED_USER",
        "status": "DRAFT_FOR_EXPERT_REVIEW" if accepted else "NO_REVIEWABLE_OBSERVATIONS",
        "comparison_status": "NOT_APPROVED",
        "critique_status": "NOT_RERUN",
        "source_integrity": "PDF_BYTES_HASH_MATCH_TEXT_AND_GEOMETRY_NOT_REEXTRACTED",
        "source_digest": source.sha256,
        "review_digest": hashlib.sha256(review_raw).hexdigest(),
        "source_export_digest": hashlib.sha256(source_raw).hexdigest(),
        "agent_report_digest": review.origin.reportDigest,
        "input": data.model_dump(),
        "review": review.model_dump(),
        "effective_extraction": effective.model_dump(),
        "excluded_observation_ids": sorted(held_rows),
        "accepted": [o.model_dump() for o in accepted],
        "findings": [f.model_dump() for f in issues],
        "baseline": {
            "kind": "ORIGINAL_VALUES_SAME_DETERMINISTIC_RULES_NOT_PRIOR_AI_APPROVAL",
            "accepted_ids": [o.id for o in before_accepted],
            "findings": [f.model_dump() for f in before_issues],
        },
        "finding_delta": _delta(before_issues, issues),
        "changed_fields": changes,
        "previous_model_review": baseline_report.attempts[-1].model_dump()
        if baseline_report
        else None,
        "limitations": [
            "사용자 확인과 수정 이력은 인증·서명된 전문가 승인 기록이 아닙니다.",
            "PDF 파일 hash만 재확인했습니다. "
            "추출 문구·좌표를 PDF에서 독립적으로 다시 읽지 않았습니다.",
            "이전 AI 반론은 재실행하지 않았으며 새 판단으로 재사용하지 않습니다.",
            "미확인·보류 필드는 제외합니다. 보류 필드가 있는 관측값은 전체를 제외합니다.",
            "사라진 쟁점은 해결 인증이 아닙니다. 값 제외로 검사 대상이 줄어든 경우도 포함합니다.",
            "인용·수치·문맥의 제한된 규칙 검사이며 "
            "임상 의미·비교 가능성·설계 권고를 확정하지 않습니다.",
        ],
    }


def markdown(result):
    lines = [
        "# 사용자 수정 후 규칙 재검증",
        "",
        "임상 승인 아님 · AI 반론 미재실행 · 비교 미승인",
        "",
        f"상태: {result['status']}",
        f"PDF SHA-256: {result['source_digest']}",
        f"검토 JSON SHA-256: {result['review_digest']}",
        "",
        "## 규칙 검사 후 남은 관측값",
        "",
    ]
    lines += [f"- {escaped(o['id'])}" for o in result["accepted"]] or ["- 없음"]
    lines += ["", "## 필드 검토 기록", ""]
    for row in result["review"]["rows"]:
        for name, field in row["fields"].items():
            if not field["history"]:
                continue
            c = field["current"]["citation"]
            lines += [
                f"- {escaped(row['id'])} / {name}: {escaped(field['original']['value'])} → "
                f"{escaped(field['current']['value'])} · {field['decision']}",
                f"  근거: {escaped(c)} · 사유: {escaped(field['history'][-1]['reason'])}",
            ]
            if n := field["current"].get("normalization"):
                lines += [
                    f"  사용자 해석: {escaped(n['display'])} · {escaped(n['method'])} · "
                    f"별도 단위 근거: {escaped(n['unitSpanId'])} · "
                    "원문 숫자/단위 별도 보존 · 임상 의미 미인증"
                ]
    for title, key in [
        ("현재 쟁점", None),
        ("추가된 쟁점", "added"),
        ("더 이상 발생하지 않은 쟁점 — 해결 인증 아님", "no_longer_emitted"),
    ]:
        lines += ["", f"## {title}", ""]
        items = result["findings"] if key is None else result["finding_delta"][key]
        lines += [
            f"- {escaped(f['code'])} · {escaped(f['observation_id'])} · "
            f"{escaped(f['field'])} · {escaped(f['detail'])}"
            for f in items
        ] or ["- 없음"]
    lines += ["", "## 한계", "", *[f"- {s}" for s in result["limitations"]], ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Offline PDF field-review revalidation; no AI calls"
    )
    parser.add_argument("--review", type=Path, required=True)
    parser.add_argument("--source-export", type=Path, required=True)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--agent-report", type=Path)
    for key in ("asset", "indication", "study", "question"):
        parser.add_argument(f"--{key}")
    args = parser.parse_args()
    values = {k: getattr(args, k) for k in ("asset", "indication", "study", "question")}
    if any(v is not None for v in values.values()) and not all(values.values()):
        parser.error("수동 검토에는 --asset --indication --study --question을 모두 입력하세요.")
    try:
        result = revalidate(
            file_bytes(args.review, JSON_LIMIT),
            file_bytes(args.source_export, JSON_LIMIT),
            file_bytes(args.pdf, PDF_LIMIT),
            agent_raw=file_bytes(args.agent_report, JSON_LIMIT) if args.agent_report else None,
            context=values if any(values.values()) else None,
        )
        # Fresh private directory per run; never overwrite source or previous results.
        root = Path("output/revalidation") / result["run_id"]
        root.mkdir(parents=True, mode=0o700)
        for name, content in [
            ("report.json", json.dumps(result, ensure_ascii=False, indent=2)),
            ("report.md", markdown(result)),
        ]:
            fd = os.open(root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(content)
    except (ValueError, OSError, TypeError):
        parser.exit(
            2, "재검증 입력/출력을 처리하지 못했습니다. 파일·출처·이력·필수 문맥을 확인하세요.\n"
        )
    print(f"{result['status']} | model_calls=0 | critique=NOT_RERUN")
    print(root / "report.json")


if __name__ == "__main__":
    main()
