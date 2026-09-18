"""Persisted source-bound automatic extraction. Browser text is not clinical attestation."""

import hashlib
import json
from typing import Annotated, Literal

from pydantic import Field, model_validator

from trialboard.agent.field_review_contract import Box
from trialboard.agent.models import AgentInput, AgentReport, Contract, Digest, Id, Text
from trialboard.research.store import ResearchStore
from trialboard.serialization import sha256_json

PageNumber = Annotated[int, Field(ge=1, le=200)]


class WindowSpan(Contract):
    id: Id
    page: PageNumber
    item: int = Field(ge=0, le=20000)
    text: Annotated[str, Field(min_length=1, max_length=250000)]
    box: Box | None


class WindowPage(Contract):
    number: PageNumber
    width: float = Field(gt=0, le=14400)
    height: float = Field(gt=0, le=14400)
    rotation: Literal[0, 90, 180, 270]
    spans: list[WindowSpan] = Field(max_length=20000)
    status: Literal["TEXT_EXTRACTED", "NO_TEXT"]


class WindowSource(Contract):
    schemaVersion: Literal["pdf-evidence-window/1"]
    name: Text
    sha256: Digest
    byteLength: int = Field(ge=5, le=5000000)
    extractor: Text
    pages: list[WindowPage] = Field(min_length=1, max_length=40)
    status: Literal["TEXT_EXTRACTED", "PARTIAL_NO_TEXT", "NO_TEXT"]
    coordinateSystem: Literal["normalized_top_left_rotated_viewport"]


class Selection(Contract):
    page: PageNumber
    score: int = Field(ge=0, le=5)
    signals: list[Text] = Field(max_length=5)


class Coverage(Contract):
    policy: Literal["lexical-pages/1"]
    totalPages: PageNumber
    scannedPages: list[PageNumber] = Field(min_length=1, max_length=200)
    retainedPages: list[PageNumber] = Field(min_length=1, max_length=40)
    omittedPages: list[PageNumber] = Field(max_length=200)
    noTextPages: list[PageNumber] = Field(max_length=200)
    clinicalReview: Literal["NOT_PERFORMED"]
    selection: list[Selection] = Field(min_length=1, max_length=40)


class Candidate(Contract):
    spanId: Id
    page: PageNumber
    text: Text
    score: int = Field(ge=1, le=30)
    reasons: list[Text] = Field(min_length=1, max_length=7)


class DocumentAttempt(Contract):
    sourceId: Id
    status: Literal["READY", "UNAVAILABLE", "UNREADABLE", "PAGE_LIMIT", "NO_CANDIDATES"]


class Preparation(Contract):
    status: Literal["READY"]
    attempts: list[DocumentAttempt] = Field(min_length=1, max_length=2)
    sourceId: Id
    source: WindowSource
    coverage: Coverage
    candidates: list[Candidate] = Field(min_length=1, max_length=3)
    input: AgentInput

    @model_validator(mode="after")
    def linked(self):
        source, coverage = self.source, self.coverage
        numbers = [p.number for p in source.pages]
        if numbers != sorted(set(numbers)) or coverage.retainedPages != numbers:
            raise ValueError("WINDOW_PAGE_IDENTITY")
        all_pages = list(range(1, coverage.totalPages + 1))
        if (
            coverage.scannedPages != all_pages
            or max(numbers) > coverage.totalPages
            or coverage.omittedPages != [p for p in all_pages if p not in numbers]
            or coverage.noTextPages != sorted(set(coverage.noTextPages))
            or any(p not in all_pages for p in coverage.noTextPages)
            or [s.page for s in coverage.selection] != numbers
        ):
            raise ValueError("WINDOW_COVERAGE")
        index, count, characters, empty = {}, 0, 0, 0
        selected = set()
        for page in source.pages:
            if (page.status == "NO_TEXT") != (not page.spans):
                raise ValueError("WINDOW_TEXT_STATUS")
            if (page.number in coverage.noTextPages) != (not page.spans):
                raise ValueError("WINDOW_TEXT_COVERAGE")
            empty += not page.spans
            previous = -1
            for span in page.spans:
                if (
                    span.id in index
                    or span.page != page.number
                    or span.item <= previous
                    or span.id != f"p{page.number}-i{span.item}"
                ):
                    raise ValueError("WINDOW_SPAN_IDENTITY")
                previous = span.item
                index[span.id] = span
                count += 1
                characters += len(span.text)
        status = (
            "NO_TEXT" if empty == len(numbers) else "PARTIAL_NO_TEXT" if empty else "TEXT_EXTRACTED"
        )
        if count > 20000 or characters > 250000 or source.status != status:
            raise ValueError("WINDOW_TEXT_LIMIT")
        if len({c.spanId for c in self.candidates}) != len(self.candidates):
            raise ValueError("WINDOW_DUPLICATE_CANDIDATE")
        for candidate in self.candidates:
            span = index.get(candidate.spanId)
            if (
                not span
                or not span.box
                or candidate.text != span.text
                or candidate.page != span.page
            ):
                raise ValueError("WINDOW_CANDIDATE_MISMATCH")
            page = next(p for p in source.pages if p.number == span.page)
            position = next(i for i, s in enumerate(page.spans) if s.id == span.id)
            selected.update(s.id for s in page.spans[max(0, position - 2) : position + 3])
        if [s.id for s in self.input.spans] != [i for i in index if i in selected]:
            raise ValueError("WINDOW_INPUT_SELECTION")
        for span in self.input.spans:
            if (
                span.source_digest != source.sha256
                or span.page != index[span.id].page
                or span.text != index[span.id].text
                or span.locator is not None
            ):
                raise ValueError("WINDOW_INPUT_MISMATCH")
        if self.input.provenance != "user_pdf_export_unverified":
            raise ValueError("WINDOW_PROVENANCE")
        if (
            self.attempts[-1].sourceId != self.sourceId
            or self.attempts[-1].status != "READY"
            or any(a.status == "READY" for a in self.attempts[:-1])
        ):
            raise ValueError("WINDOW_ATTEMPTS")
        return self


def decision_packet(report: AgentReport) -> dict:
    """Do not turn accepted literal drafts into approved design parameters."""
    findings = sorted({f.code for a in report.attempts for f in a.findings})
    questions = list(
        dict.fromkeys(q for a in report.attempts if a.critique for q in a.critique.next_questions)
    )[:8]
    if not report.accepted:
        questions.insert(
            0, "동일 시험·분석집단에서 두 용량의 반응·안전성 결과와 분모를 확보할 수 있나요?"
        )
    questions.append("검토자가 근거의 적용 범위를 확인하고 비교 가정·평가변수를 승인했나요?")
    return {
        "status": "REVIEW_REQUIRED" if report.accepted else "NEEDS_EVIDENCE",
        "clinicalApproved": False,
        "simulationExecuted": False,
        "acceptedDrafts": len(report.accepted),
        "findingCodes": findings,
        "questions": questions[:10],
        "reason": "근거와 비교 가정을 확인하기 전에는 수치를 만들어 설계를 계산하지 않습니다.",
    }


class AutomationStore(ResearchStore):
    def connect(self):
        con = super().connect()
        con.execute("""CREATE TABLE IF NOT EXISTS research_automation
            (run_id TEXT PRIMARY KEY REFERENCES research_runs(id), digest TEXT NOT NULL,
             status TEXT NOT NULL, data TEXT NOT NULL)""")
        return con

    def get(self, run_id):
        con = self.connect()
        try:
            row = con.execute(
                "SELECT data FROM research_automation WHERE run_id=?", (run_id,)
            ).fetchone()
            return json.loads(row[0]) if row else None
        finally:
            con.close()

    def prepare(self, run_id, preparation: Preparation):
        run = self.get_run(run_id)
        source = (
            next((s for s in run.sources if s.id == preparation.sourceId), None) if run else None
        )
        if (
            not source
            or run.status not in ("COMPLETE", "PARTIAL")
            or source.kind not in ("SAP", "PROTOCOL")
            or "REGISTRY_DOCUMENT" not in source.link_basis
            or source.identifiers.get("nct") != run.request.nct_id
            or any(
                getattr(preparation.input, k) != v
                for k, v in {
                    "asset": run.request.asset,
                    "indication": run.request.indication,
                    "study": run.request.nct_id,
                }.items()
            )
        ):
            raise ValueError("AUTOMATION_CONTEXT_MISMATCH")
        document = preparation.model_dump(mode="json")
        # Results-first routing only when that very research run actually reviewed the
        # posted-result sources. A collected source alone is not proof of model input.
        reviewed_ids = {
            (s.get("source_id"), s.get("source_digest"))
            for call in run.calls
            if call.get("stage") == "AI_REVIEW" and call.get("validation") == "PASSED"
            for s in (call.get("context_selection") or {}).get("sources", [])
        }
        result_sources = [s for s in run.sources if "REGISTRY_RESULTS" in s.link_basis]
        route = None
        if result_sources and all((s.id, s.digest) in reviewed_ids for s in result_sources):
            from trialboard.research.result_tables import registry_results

            tables = registry_results(self, run_id)
            if tables and (tables["outcomes"] or tables["safety"]):
                route = {
                    "policy": "posted-results-first/1",
                    "snapshotDigest": tables["snapshotDigest"],
                    "resultSourceIds": [s.id for s in result_sources],
                    "reason": "등록 결과를 이미 AI 검토했습니다. "
                    "계획 문서는 보존하며 결과 수치의 재추출은 생략합니다.",
                }
        # Cross-language fingerprint excludes floating-point geometry formatting.
        digest = sha256_json(
            {
                "input": document["input"],
                "coverage": document["coverage"],
                "sourceId": document["sourceId"],
                "sourceDigest": document["source"]["sha256"],
            }
        )
        con = self.connect()
        try:
            with con:
                con.execute("BEGIN IMMEDIATE")
                old = con.execute(
                    "SELECT digest,data FROM research_automation WHERE run_id=?", (run_id,)
                ).fetchone()
                if old:
                    if old[0] != digest or json.loads(old[1])["document"] != document:
                        raise ValueError("AUTOMATION_VERSION_CONFLICT")
                    return json.loads(old[1])
                if not con.execute(
                    "SELECT 1 FROM sqlite_master WHERE name='public_pdf_receipts'"
                ).fetchone():
                    raise ValueError("AUTOMATION_ORIGINAL_REQUIRED")
                raw = con.execute(
                    """SELECT b.content FROM public_pdf_receipts r
                    JOIN public_pdf_blobs b ON b.digest=r.digest
                    WHERE r.run_id=? AND r.source_id=? AND r.digest=?""",
                    (run_id, source.id, preparation.source.sha256),
                ).fetchone()
                if (
                    not raw
                    or len(raw[0]) != preparation.source.byteLength
                    or hashlib.sha256(raw[0]).hexdigest() != preparation.source.sha256
                ):
                    raise ValueError("AUTOMATION_ORIGINAL_MISMATCH")
                value = {
                    "schema": "research-automation/1",
                    "runId": run_id,
                    "digest": digest,
                    "status": "PLAN_DOCUMENT_SAVED" if route else "PREPARED",
                    "document": document,
                    "report": None,
                    "decision": None,
                    "events": [],
                    "textVerifiedAgainstPdf": False,
                }
                if route:
                    value["route"] = route
                con.execute(
                    "INSERT INTO research_automation VALUES (?,?,?,?)",
                    (run_id, digest, value["status"], json.dumps(value, ensure_ascii=False)),
                )
                return value
        finally:
            con.close()

    def transition(self, run_id, expected, status, **changes):
        con = self.connect()
        try:
            with con:
                con.execute("BEGIN IMMEDIATE")
                row = con.execute(
                    "SELECT status,data FROM research_automation WHERE run_id=?", (run_id,)
                ).fetchone()
                if not row or row[0] != expected:
                    raise ValueError("AUTOMATION_ALREADY_STARTED_OR_MISSING")
                value = {**json.loads(row[1]), **changes, "status": status}
                con.execute(
                    "UPDATE research_automation SET status=?,data=? WHERE run_id=?",
                    (status, json.dumps(value, ensure_ascii=False), run_id),
                )
                return value
        finally:
            con.close()

    def interrupt_stale(self):
        con = self.connect()
        try:
            ids = con.execute(
                "SELECT run_id FROM research_automation WHERE status='RUNNING'"
            ).fetchall()
        finally:
            con.close()
        for (run_id,) in ids:
            self.transition(run_id, "RUNNING", "INTERRUPTED")
