"""Opt-in public registry discovery. No LLM, private documents or clinical inference."""

import asyncio
import hashlib
import json
import re
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

API = "https://clinicaltrials.gov/api/v2/studies"
MAX_BYTES = 4_000_000
LIMIT = 20


class SearchInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(min_length=2, max_length=100)
    public_query_confirmed: bool = Field(strict=True)

    @field_validator("query")
    @classmethod
    def plain_query(cls, value: str) -> str:
        value = value.strip()
        # Do not accept CT.gov's advanced search language or arbitrary URLs.
        if not re.fullmatch(r"[\w][\w .+()/-]{1,99}", value, re.UNICODE):
            raise ValueError("Use a public drug name, code or NCT identifier")
        if ":" in value or "/" in value:
            raise ValueError("URLs are not supported")
        if value.upper().startswith("NCT") and not re.fullmatch(r"NCT\d{8}", value.upper()):
            raise ValueError("NCT identifiers contain eight digits")
        return value


async def fetch_registry(query: str) -> dict:
    nct = bool(re.fullmatch(r"NCT\d{8}", query.upper()))
    url = f"{API}/{query.upper()}" if nct else API
    params = {} if nct else {"query.intr": query, "pageSize": LIMIT, "countTotal": "true"}
    async with (
        asyncio.timeout(25),
        httpx.AsyncClient(timeout=20, follow_redirects=False, trust_env=False) as client,
        client.stream("GET", url, params=params) as response,
    ):
        if response.status_code == 404 and nct:
            return {"studies": [], "totalCount": 0}
        response.raise_for_status()
        raw = bytearray()
        async for chunk in response.aiter_bytes():
            raw.extend(chunk)
            if len(raw) > MAX_BYTES:
                raise ValueError("Registry response too large")
    data = json.loads(raw)
    return {"studies": [data], "totalCount": 1} if nct else data


class RegistryField(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")


class Intervention(RegistryField):
    name: str
    type: str


class Arm(RegistryField):
    label: str
    description: str | None = None


class Outcome(RegistryField):
    measure: str
    timeFrame: str | None = None


class Enrollment(RegistryField):
    count: int = Field(ge=0)
    type: str


class RegistryRow(RegistryField):
    nct_id: str
    title: str
    url: str
    conditions: list[str]
    phases: list[str]
    status: str
    updated: str | None
    sponsor: str | None
    enrollment: Enrollment | None
    interventions: list[Intervention]
    arms: list[Arm]
    primary_outcomes: list[Outcome]
    results_available: bool
    documents: list[dict]


def normalize(data: dict) -> list[dict]:
    studies = data["studies"]
    if not isinstance(studies, list) or len(studies) > LIMIT:
        raise ValueError("Invalid study list")
    rows = []
    for study in studies:
        protocol = study["protocolSection"]
        identity = protocol["identificationModule"]
        nct = identity["nctId"]
        if not re.fullmatch(r"NCT\d{8}", nct) or any(r["nct_id"] == nct for r in rows):
            raise ValueError("Invalid or duplicate NCT identifier")
        design = protocol.get("designModule", {})
        status = protocol.get("statusModule", {})
        interventions = protocol.get("armsInterventionsModule", {})
        outcomes = protocol.get("outcomesModule", {})
        rows.append(
            {
                "nct_id": nct,
                "title": identity["briefTitle"],
                "url": f"https://clinicaltrials.gov/study/{nct}",
                "conditions": protocol.get("conditionsModule", {}).get("conditions", []),
                "phases": design.get("phases", []),
                "status": status.get("overallStatus", "UNKNOWN"),
                "updated": status.get("lastUpdatePostDateStruct", {}).get("date"),
                "sponsor": protocol.get("sponsorCollaboratorsModule", {})
                .get("leadSponsor", {})
                .get("name"),
                "enrollment": design.get("enrollmentInfo"),
                "interventions": interventions.get("interventions", []),
                "arms": interventions.get("armGroups", []),
                "primary_outcomes": outcomes.get("primaryOutcomes", []),
                "results_available": study.get("hasResults", "resultsSection" in study),
                "documents": study.get("documentSection", {})
                .get("largeDocumentModule", {})
                .get("largeDocs", []),
            }
        )
    return [RegistryRow.model_validate(row).model_dump(exclude_none=False) for row in rows]


class EvidenceStore:
    """Append-only search receipts and content-addressed public snapshots, local only."""

    def __init__(self, path: Path):
        self.path = path

    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(self.path, timeout=5)
        con.execute("PRAGMA foreign_keys = ON")
        con.execute(
            "CREATE TABLE IF NOT EXISTS snapshots (digest TEXT PRIMARY KEY, raw TEXT NOT NULL)"
        )
        con.execute("""CREATE TABLE IF NOT EXISTS searches (
            id TEXT PRIMARY KEY, created_at TEXT NOT NULL, digest TEXT NOT NULL
            REFERENCES snapshots(digest), receipt TEXT NOT NULL)""")
        con.execute("CREATE INDEX IF NOT EXISTS idx_searches_created ON searches(created_at)")
        return con

    def save(self, query: str, data: dict, rows: list[dict]) -> dict:
        raw = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(raw.encode()).hexdigest()
        total = data.get("totalCount", len(rows))
        if type(total) is not int or total < len(rows):
            raise ValueError("Invalid total count")
        receipt = {
            "id": str(uuid4()),
            "created_at": datetime.now(UTC).isoformat(),
            "query": query,
            "source": "ClinicalTrials.gov API v2",
            "mode": "LIVE_PUBLIC",
            "digest": digest,
            "total_count": total,
            "fetched_count": len(rows),
            "truncated": bool(data.get("nextPageToken")) or total > len(rows),
            "studies": rows,
            "clinical_verified": False,
        }
        con = self.connect()
        try:
            with con:
                con.execute("INSERT OR IGNORE INTO snapshots VALUES (?, ?)", (digest, raw))
                con.execute(
                    "INSERT INTO searches VALUES (?, ?, ?, ?)",
                    (
                        receipt["id"],
                        receipt["created_at"],
                        digest,
                        json.dumps(receipt, ensure_ascii=False),
                    ),
                )
        finally:
            con.close()
        return receipt

    def read(self, run_id: str | None = None):
        if not self.path.exists():
            return None if run_id else []
        con = self.connect()
        try:
            if run_id:
                row = con.execute("SELECT receipt FROM searches WHERE id = ?", (run_id,)).fetchone()
                return json.loads(row[0]) if row else None
            rows = con.execute(
                "SELECT receipt FROM searches ORDER BY created_at DESC LIMIT 20"
            ).fetchall()
            return [{k: v for k, v in json.loads(r[0]).items() if k != "studies"} for r in rows]
        finally:
            con.close()


def scout_router(path: Path) -> APIRouter:
    router = APIRouter(prefix="/api/evidence-scout")
    store = EvidenceStore(path)
    lock = asyncio.Lock()

    @router.get("/searches")
    async def history():
        return await asyncio.to_thread(store.read)

    @router.get("/searches/{run_id}")
    async def saved(run_id: str):
        result = await asyncio.to_thread(store.read, run_id)
        if result is None:
            raise HTTPException(404, "SEARCH_NOT_FOUND")
        return result

    @router.post("/search")
    async def search(body: SearchInput):
        if not body.public_query_confirmed:
            raise HTTPException(422, "PUBLIC_QUERY_CONFIRMATION_REQUIRED")
        if lock.locked():
            raise HTTPException(409, "SCOUT_BUSY")
        await lock.acquire()

        async def stream():
            def event(stage: str, **payload):
                return json.dumps({"stage": stage, **payload}, ensure_ascii=False) + "\n"

            try:
                yield event("SEARCHING", message="공개 등록정보 검색 요청 · 최대 20건")
                data = await fetch_registry(body.query)
                rows = normalize(data)
                yield event(
                    "COLLECTED", message=f"등록정보 {len(rows)}건 수신·구조화", count=len(rows)
                )
                yield event("SAVING", message="원본 스냅샷·출처·수집 시각을 로컬 DB에 저장 중")
                receipt = await asyncio.to_thread(store.save, body.query, data, rows)
                yield event("COMPLETE", receipt=receipt)
            except (
                httpx.HTTPError,
                TimeoutError,
                ValueError,
                KeyError,
                TypeError,
                AttributeError,
                OSError,
                sqlite3.Error,
            ):
                yield event(
                    "ERROR", message="공개 자료 수집·저장 실패. 기존 저장 기록은 유지됩니다."
                )
            finally:
                lock.release()

        return StreamingResponse(stream(), media_type="application/x-ndjson")

    return router
