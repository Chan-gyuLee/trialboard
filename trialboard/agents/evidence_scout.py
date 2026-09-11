"""Evidence Scout — COLLECT stage (corpus part; deterministic, no LLM).

Pulls every reachable primary source for (drug, trial), pins each by hash,
persists Sources into the graph, then builds the trial lineage.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any

from trialboard.core.hashing import short_id
from trialboard.core.schemas import Claim, LineageEdge, LineageNode, Source, SourceType, Span
from trialboard.corpus.ctgov import CTGovClient
from trialboard.corpus.epmc import EuropePMCClient, publication_source
from trialboard.corpus.fda import FDAClient
from trialboard.corpus.pubchem import PubChemClient, rdkit_check
from trialboard.corpus.seeds import GUIDANCE, SEEDS
from trialboard.corpus.snapshot import SnapshotStore
from trialboard.graph.store import GraphStore
from trialboard.lineage.builder import LineageBuilder


@dataclass
class CollectResult:
    drug: str
    trial_id: str
    sources: list[Source] = field(default_factory=list)
    registry_history: list[dict[str, Any]] = field(default_factory=list)
    study: dict[str, Any] = field(default_factory=dict)
    compound: dict[str, Any] = field(default_factory=dict)
    rdkit: dict[str, Any] = field(default_factory=dict)
    lineage_nodes: list[LineageNode] = field(default_factory=list)
    lineage_edges: list[LineageEdge] = field(default_factory=list)
    spans: list[Span] = field(default_factory=list)
    claims: list[Claim] = field(default_factory=list)
    api_calls: int = 0
    log: list[str] = field(default_factory=list)


def collect(
    drug: str,
    nct: str,
    *,
    snapshots: SnapshotStore,
    graph: GraphStore | None = None,
    pdfs: bool = True,
    log=print,
) -> CollectResult:
    r = CollectResult(drug=drug, trial_id=nct)

    def note(msg: str) -> None:
        r.log.append(msg)
        log(msg)

    # 1. registry + version history
    ct = CTGovClient(snapshots)
    r.study, s_study = ct.study(nct)
    r.sources.append(s_study)
    r.registry_history, s_hist = ct.history(nct)
    r.sources.append(s_hist)
    note(f"ctgov: {s_study.title[:70]}… · {len(r.registry_history)} registry versions")

    # 2. FDA: Drugs@FDA index → letters/labels/reviews (PDF)
    fda = FDAClient(snapshots)
    app, s_app = fda.drugsfda(drug)
    r.sources.append(s_app)
    docs = fda.application_docs(app)
    fda_pdfs: list[Source] = []
    if pdfs:
        for d in docs:
            if not d["url"].lower().endswith(".pdf"):
                continue
            src = fda.fetch_pdf(
                d["url"],
                title=(
                    f"{app['application_number']} {d['submission_type']}-"
                    f"{d['submission_number']} {d['doc_type']}"
                ),
                doc_type=d["doc_type"],
                date_yyyymmdd=d["submission_status_date"],
                version=f"{d['submission_type']}-{d['submission_number']}",
            )
            fda_pdfs.append(src)
        r.sources.extend(fda_pdfs)
    note(f"drugsfda: {app['application_number']} · {len(docs)} docs · {len(fda_pdfs)} pdfs pinned")
    _, s_label = fda.label(drug)
    r.sources.append(s_label)

    # 3. curated seeds (ODAC, original review) + guidance corpus
    seeds = SEEDS.get(drug, [])
    for sd in seeds + GUIDANCE:
        f = snapshots.get(sd["url"])
        r.sources.append(
            Source(
                source_id=short_id("src", f.url, f.content_hash),
                type=sd["type"],
                url=f.url,
                title=sd["title"],
                issuer=sd["issuer"],
                doc_date=date.fromisoformat(sd["doc_date"]) if sd.get("doc_date") else None,
                version=sd.get("version"),
                fetched_at=f.fetched_at,
                content_hash=f.content_hash,
                media_type=f.media_type,
                local_path=str(f.local_path),
                attribution_default=sd["attribution"],
                meta={"seed": True, "key": sd.get("key")},
            )
        )
    note(f"seeds: {len(seeds)} drug-specific · {len(GUIDANCE)} guidance documents")

    # 4. compound identity + RDKit gate
    pc = PubChemClient(snapshots)
    r.compound, s_pc = pc.compound(drug)
    r.sources.append(s_pc)
    smiles = r.compound.get("IsomericSMILES") or r.compound.get("ConnectivitySMILES")
    r.rdkit = rdkit_check(smiles, r.compound["InChIKey"])
    note(f"pubchem CID {r.compound['CID']} · RDKit InChIKey skeleton match={r.rdkit['ok']}")

    # 5. literature
    ep = EuropePMCClient(snapshots)
    hits, s_ep = ep.search(f'"{drug}" AND ({nct} OR "dose comparison" OR "dose optimization")', 25)
    r.sources.append(s_ep)
    pubs = [publication_source(h, s_ep) for h in hits]
    r.sources.extend(pubs)
    note(f"europepmc: {len(pubs)} publications (metadata)")

    # 6. lineage (deterministic)
    lb = LineageBuilder(nct, drug)
    lb.add_registry_history(r.registry_history, s_hist)
    for s in r.sources:
        if s.type == SourceType.FDA_LETTER:
            lb.add_letter(s)
        elif s.type == SourceType.FDA_LABEL and s.media_type == "application/pdf":
            lb.add_label(s)
        elif s.type in (SourceType.FDA_REVIEW, SourceType.ODAC_BRIEFING):
            lb.add_review(s)
        elif s.type == SourceType.PUBLICATION and s.meta.get("doi"):
            lb.add_publication(s)
    lb.link_pmr_to_evidence()
    r.lineage_nodes, r.lineage_edges = lb.nodes, lb.edges
    r.spans, r.claims = lb.spans, lb.claims
    note(f"lineage: {len(lb.nodes)} nodes · {len(lb.edges)} edges · {len(lb.claims)} PMR claims")

    r.api_calls = snapshots.api_calls
    if graph is not None:
        graph.upsert_sources(r.sources)
        graph.upsert_spans(r.spans)
        graph.upsert_claims(r.claims)
        graph.upsert_lineage(r.lineage_nodes, r.lineage_edges)
        note(f"graph: {graph.counts()}")
    return r
