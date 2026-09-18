"""Bounded public connectors. Search matches and clinical evidence are not equivalent."""

import asyncio
import json
import re
from datetime import UTC, datetime
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urlsplit, urlunsplit

import httpx

from trialboard.api.scout import fetch_registry
from trialboard.research.models import Collection, Coverage, Source
from trialboard.serialization import sha256_json

EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
FDA = "https://api.fda.gov/drug/drugsfda.json"


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag in ("h4", "p", "br"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("h4", "p"):
            self.parts.append("\n")


def plain(value: str) -> str:
    parser = PlainText()
    parser.feed(unescape(value))
    return "".join(parser.parts).strip()


def safe_pdf(url: str) -> str | None:
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme not in ("http", "https")
        or parsed.username
        or parsed.password
        or port
        or parsed.query
        or parsed.fragment
    ):
        return None
    allowed = (
        parsed.hostname == "cdn.clinicaltrials.gov"
        and re.fullmatch(r"/large-docs/\d{2}/NCT\d{8}/[A-Za-z0-9_-]+\.pdf", parsed.path)
    ) or (
        parsed.hostname == "www.accessdata.fda.gov"
        and re.fullmatch(r"/drugsatfda_docs/[A-Za-z0-9_/-]+\.pdf", parsed.path)
        and ".." not in parsed.path
    )
    return urlunsplit(("https", parsed.hostname, parsed.path, "", "")) if allowed else None


async def get_json(url: str, params: dict) -> dict:
    if url not in (EPMC, FDA):
        raise ValueError("SOURCE_NOT_ALLOWED")
    async with (
        asyncio.timeout(25),
        httpx.AsyncClient(timeout=20, follow_redirects=False, trust_env=False) as client,
        client.stream("GET", url, params=params) as response,
    ):
        if response.status_code == 404 and url == FDA:
            return {"results": [], "meta": {"results": {"total": 0}}}
        response.raise_for_status()
        raw = bytearray()
        async for chunk in response.aiter_bytes():
            raw.extend(chunk)
            if len(raw) > 4_000_000:
                raise ValueError("SOURCE_RESPONSE_TOO_LARGE")
    import json

    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("INVALID_SOURCE_RESPONSE")
    return value


def source(**values) -> Source:
    values.setdefault("identifiers", {})
    # Content hash excludes retrieval time and discovery paths, so refreshes can be compared.
    digest = sha256_json(
        {k: v for k, v in values.items() if k not in ("link_basis", "raw_snapshots")}
    )
    return Source(**values, digest=digest, fetched_at=datetime.now(UTC).isoformat())


def add_source(run: Collection, item: Source):
    previous = next((s for s in run.sources if s.id == item.id), None)
    if previous:
        previous.link_basis = sorted(set(previous.link_basis + item.link_basis))
        previous.raw_snapshots = sorted(set(previous.raw_snapshots + item.raw_snapshots))
        return
    if len(run.sources) < 100:
        run.sources.append(item)
    elif "근거 100개 저장 한도에 도달하여 일부 검색 결과는 저장하지 않았습니다." not in run.notices:
        run.notices.append("근거 100개 저장 한도에 도달하여 일부 검색 결과는 저장하지 않았습니다.")


async def registry(run: Collection, store):
    data = await fetch_registry(run.request.nct_id)
    if not data["studies"]:
        raise ValueError("TRIAL_NO_LONGER_AVAILABLE")
    raw_digest = store.snapshot(data)
    record = data["studies"][0]
    protocol = record["protocolSection"]
    if protocol["identificationModule"]["nctId"] != run.request.nct_id:
        raise ValueError("TRIAL_ID_MISMATCH")
    nct = run.request.nct_id
    text = "\n".join(
        [
            nct,
            protocol["identificationModule"]["briefTitle"],
            "Registered design (not outcome data): "
            + json.dumps(protocol.get("designModule", {}), ensure_ascii=False),
            protocol.get("descriptionModule", {}).get("briefSummary", ""),
            *[
                f"Arm: {a.get('label', '')}. {a.get('description', '')}"
                for a in protocol.get("armsInterventionsModule", {}).get("armGroups", [])
            ],
            *[
                f"Primary outcome: {o.get('measure', '')}. {o.get('timeFrame', '')}"
                for o in protocol.get("outcomesModule", {}).get("primaryOutcomes", [])
            ],
        ]
    )[:18000]
    add_source(
        run,
        source(
            id=f"registry_{nct}",
            kind="REGISTRY",
            title=protocol["identificationModule"]["briefTitle"],
            url=f"https://clinicaltrials.gov/study/{nct}",
            text=text,
            content_level="REGISTRY_TEXT",
            link_basis=["REGISTRY_RECORD"],
            identifiers={
                "nct": nct,
                **(
                    {"allocation": protocol["designModule"]["designInfo"]["allocation"]}
                    if protocol.get("designModule", {}).get("designInfo", {}).get("allocation")
                    in ("RANDOMIZED", "NON_RANDOMIZED", "NA")
                    else {}
                ),
            },
            raw_snapshots=[raw_digest],
        ),
    )
    from trialboard.research.result_tables import registry_results

    tables = registry_results(store, run.id, run=run)
    if tables and (tables["outcomes"] or tables["safety"]):
        from trialboard.research.result_context import result_pages

        pages = result_pages(tables)
        included = sum(len(context["included"]) for _, context in pages)
        run.notices.append(
            f"등록 결과 모델 입력 후보: {included}행 포함 / "
            f"{len(tables['outcomes']) + len(tables['safety']) - included}행 생략. "
            "표 원본과 집단 맥락을 보존합니다."
        )
        for index, (result_text, _) in enumerate(pages):
            add_source(
                run,
                source(
                    id=f"registry_results_{nct}" + (f"_{index + 1}" if index else ""),
                    kind="REGISTRY",
                    title=protocol["identificationModule"]["briefTitle"] + " · Posted results",
                    url=f"https://clinicaltrials.gov/study/{nct}",
                    text=result_text,
                    content_level="REGISTRY_TEXT",
                    link_basis=["REGISTRY_RECORD", "REGISTRY_RESULTS"],
                    identifiers={"nct": nct},
                    raw_snapshots=[raw_digest],
                ),
            )
    docs = record.get("documentSection", {}).get("largeDocumentModule", {}).get("largeDocs", [])
    for doc in docs[:12]:
        filename = doc.get("filename", "")
        url = safe_pdf(f"https://cdn.clinicaltrials.gov/large-docs/{nct[-2:]}/{nct}/{filename}")
        if not url or not (doc.get("hasProtocol") or doc.get("hasSap")):
            continue
        add_source(
            run,
            source(
                id=f"doc_{nct}_{filename[:-4]}",
                kind=("PROTOCOL" if doc.get("hasProtocol") else "SAP"),
                title=doc.get("label", filename),
                url=url,
                pdf_url=url,
                text=f"{nct} · {doc.get('label', filename)} · {doc.get('date', '')}",
                content_level="PDF_AVAILABLE",
                link_basis=["REGISTRY_DOCUMENT"],
                identifiers={"nct": nct, "filename": filename},
                raw_snapshots=[raw_digest],
                published=doc.get("date"),
            ),
        )
    if len(docs) > 12:
        run.notices.append("등록부의 첨부 문서는 앞의 12개 항목에서만 수집했습니다.")
    run.coverage.append(
        Coverage(
            channel="ClinicalTrials.gov", query=nct, status="OK", total=1, fetched=1, limited=False
        )
    )
    refs = protocol.get("referencesModule", {}).get("references", [])
    return {
        r["pmid"]: r.get("type", "UNKNOWN")
        for r in refs
        if re.fullmatch(r"\d{1,12}", r.get("pmid", ""))
    }


def literature_page_limit(basis: str) -> int:
    # Retrieval priority is not an evidence grade. Keep broad discovery bounded.
    return 2 if basis in ("NCT_SEARCH", "AI_FOLLOWUP") else 1


async def literature(run: Collection, query: str, basis: str, store, refs: dict, on_page=None):
    limit = literature_page_limit(basis)
    cursor, pages, fetched, total = "*", 0, 0, None
    seen_cursors, seen_records = set(), set()
    reason, failed, storage_limited = "SOURCE_LIMIT", False, False
    while pages < limit and len(run.sources) < 100:
        seen_cursors.add(cursor)
        try:
            data = await get_json(
                EPMC,
                {
                    "query": query,
                    "format": "json",
                    "resultType": "core",
                    "pageSize": 20,
                    "cursorMark": cursor,
                },
            )
            hits = data["resultList"]["result"]
            page_total = data["hitCount"]
            if (
                not isinstance(hits, list)
                or len(hits) > 20
                or type(page_total) is not int
                or page_total < fetched + len(hits)
                or any(not isinstance(p, dict) for p in hits)
            ):
                raise ValueError("INVALID_LITERATURE_RESPONSE")
            raw_digest = store.snapshot(data)
            keys = {(str(p.get("source", "")), str(p.get("id", p.get("pmid", "")))) for p in hits}
            new_records = keys - seen_records
            seen_records.update(keys)
            # Raw response records, not unique stored sources. Inconsistent totals fail closed.
            fetched += len(hits)
            total = page_total
            pages += 1
            _store_papers(run, hits, basis, refs, raw_digest)
            storage_limited = any(
                p.get("source") == "MED"
                and re.fullmatch(r"\d{1,12}", str(p.get("pmid", p.get("id", ""))))
                and not any(s.id == f"paper_{p.get('pmid', p.get('id', ''))}" for s in run.sources)
                for p in hits
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            failed, reason = True, "REQUEST_FAILED"
            break

        next_cursor = data.get("nextCursorMark")
        if storage_limited:
            reason = "SOURCE_LIMIT"
        elif hits and pages > 1 and not new_records:
            reason = "NO_NEW_RECORDS"
        elif not hits or fetched >= total:
            reason = "RESULTS_EXHAUSTED"
        elif len(run.sources) >= 100:
            reason = "SOURCE_LIMIT"
        elif pages >= limit:
            reason = "PAGE_LIMIT"
        elif (
            not isinstance(next_cursor, str)
            or not next_cursor
            or len(next_cursor) > 2000
            or next_cursor in seen_cursors
        ):
            reason = "CURSOR_UNAVAILABLE"
        else:
            reason = ""
        if on_page:
            await on_page(pages, fetched, total, not reason)
        if reason:
            break
        cursor = next_cursor

    run.coverage.append(
        Coverage(
            channel="Europe PMC / PubMed",
            query=query,
            status="FAILED" if failed else "SKIPPED" if not pages else "OK" if fetched else "EMPTY",
            total=total,
            fetched=fetched,
            limited=failed
            or storage_limited
            or reason != "RESULTS_EXHAUSTED"
            or (total is not None and fetched < total),
            pages=pages,
            stop_reason=reason,
        )
    )


def _store_papers(run, hits, basis, refs, raw_digest):
    for paper in hits:
        # PubMed records have stable numeric IDs. Other content remains outside this slice.
        pmid = paper.get("pmid", paper.get("id", ""))
        if paper.get("source") != "MED" or not re.fullmatch(r"\d{1,12}", pmid):
            continue
        title = plain(paper["title"])
        abstract = plain(paper.get("abstractText", ""))[:18000]
        links = [basis]
        if pmid in refs:
            links.append(f"REGISTRY_REFERENCE_{refs[pmid]}")
        if re.search(rf"\b{run.request.nct_id}\b", title + " " + abstract, re.IGNORECASE):
            links.append("NCT_IN_ABSTRACT")
        identifiers = {"pmid": pmid}
        for key in ("doi", "pmcid"):
            if isinstance(paper.get(key), str):
                identifiers[key] = paper[key]
        add_source(
            run,
            source(
                id=f"paper_{pmid}",
                kind="PAPER",
                title=title,
                url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                text=title + "\n" + abstract,
                content_level="ABSTRACT" if abstract else "METADATA",
                link_basis=links,
                identifiers=identifiers,
                raw_snapshots=[raw_digest],
                published=paper.get("firstPublicationDate"),
            ),
        )


async def regulatory(run: Collection, store):
    query = f'products.active_ingredients.name:"{run.request.asset.strip()}"'
    data = await get_json(FDA, {"search": query, "limit": 3})
    raw_digest = store.snapshot(data)
    applications = data["results"]
    documents_limited = False
    for app in applications[:3]:
        app_id = app.get("application_number", "")
        if not re.fullmatch(r"[A-Z]+\d+", app_id):
            continue
        docs = [(d, s) for s in app.get("submissions", []) for d in s.get("application_docs", [])]
        # Preserve different versions; latest-first is not a judgment of clinical relevance.
        docs.sort(key=lambda x: x[0].get("date", ""), reverse=True)
        documents_limited |= len(docs) > 12
        for doc, submission in docs[:12]:
            url = safe_pdf(doc.get("url", ""))
            if not url:
                continue
            identifier = sha256_json(url)[:16]
            title = f"{app_id} · {doc.get('type', 'Document')} · {doc.get('date', '')}"
            add_source(
                run,
                source(
                    id=f"fda_{identifier}",
                    kind="REGULATORY",
                    title=title,
                    url=url,
                    pdf_url=url,
                    text=title
                    + "\n"
                    + str(submission.get("submission_class_code_description", "")),
                    content_level="PDF_AVAILABLE",
                    link_basis=["DRUG_APPLICATION_NOT_TRIAL_PROOF"],
                    identifiers={"application": app_id, "type": doc.get("type", "Document")},
                    raw_snapshots=[raw_digest],
                    published=doc.get("date"),
                ),
            )
    total = data.get("meta", {}).get("results", {}).get("total", len(applications))
    run.coverage.append(
        Coverage(
            channel="Drugs@FDA",
            query=query,
            status="OK" if applications else "EMPTY",
            total=total,
            fetched=len(applications),
            limited=total > len(applications) or documents_limited,
        )
    )
    if documents_limited:
        run.notices.append(
            "FDA 수집 건수는 신청 단위입니다. 문서는 신청별 최신 12개 항목만 확인했습니다."
        )


async def download_pdf(url: str) -> bytes:
    safe = safe_pdf(url)
    if not safe or safe != url:
        raise ValueError("UNAPPROVED_DOCUMENT")
    async with (
        asyncio.timeout(30),
        httpx.AsyncClient(timeout=25, trust_env=False, follow_redirects=False) as client,
        client.stream("GET", safe) as response,
    ):
        response.raise_for_status()
        raw = bytearray()
        async for chunk in response.aiter_bytes():
            raw.extend(chunk)
            if len(raw) > 5_000_000:
                raise ValueError("PDF_OVER_5MB")
    if not raw.startswith(b"%PDF-"):
        raise ValueError("NOT_PDF")
    return bytes(raw)
