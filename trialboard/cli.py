"""Trial Board CLI."""

from __future__ import annotations

import json
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from trialboard.corpus.ctgov import CTGovClient
from trialboard.corpus.epmc import EuropePMCClient, publication_source
from trialboard.corpus.fda import FDAClient
from trialboard.corpus.pdf import PDFDocument
from trialboard.corpus.pubchem import PubChemClient, rdkit_check
from trialboard.corpus.snapshot import SnapshotStore

app = typer.Typer(no_args_is_help=True, help="Trial Board — evidence-linked trial design agents")
console = Console()


@app.command()
def fetch(
    drug: str = typer.Argument(..., help="generic name, e.g. sotorasib"),
    nct: str = typer.Option(..., "--nct", help="ClinicalTrials.gov ID"),
    mode: str = typer.Option("auto", help="snapshot|live|auto"),
    pdfs: bool = typer.Option(True, help="download FDA review/letter/label PDFs"),
    out: Path = typer.Option(Path("data/manifests"), help="where to write the source list"),
):
    """COLLECT stage, corpus only: pull registry, history, Drugs@FDA docs, label, PubChem, papers."""
    store = SnapshotStore(mode=mode)  # type: ignore[arg-type]
    sources = []

    ct = CTGovClient(store)
    study, s = ct.study(nct)
    sources.append(s)
    hist, s = ct.history(nct)
    sources.append(s)
    console.print(f"[bold]{nct}[/] {s.title}: {len(hist)} registry versions")

    fda = FDAClient(store)
    appn, s = fda.drugsfda(drug)
    sources.append(s)
    docs = fda.application_docs(appn)
    t = Table(title=f"Drugs@FDA {appn['application_number']} documents")
    for col in ("date", "sub", "type", "url"):
        t.add_column(col)
    for d in docs:
        t.add_row(d["submission_status_date"], f"{d['submission_type']}-{d['submission_number']}",
                  d["doc_type"], d["url"][-60:])
    console.print(t)
    if pdfs:
        for d in docs:
            if not d["url"].lower().endswith(".pdf"):
                continue
            src = fda.fetch_pdf(
                d["url"],
                title=f"{appn['application_number']} {d['submission_type']}-{d['submission_number']} {d['doc_type']}",
                doc_type=d["doc_type"],
                date_yyyymmdd=d["submission_status_date"],
                version=f"{d['submission_type']}-{d['submission_number']}",
            )
            sources.append(src)
            console.print(f"  pdf {src.type.value:11} {src.doc_date} {src.content_hash[:10]} {Path(src.local_path).stat().st_size // 1024} KB")

    _, s = fda.label(drug)
    sources.append(s)

    pc = PubChemClient(store)
    props, s = pc.compound(drug)
    sources.append(s)
    chk = rdkit_check(props.get("IsomericSMILES") or props["ConnectivitySMILES"], props["InChIKey"])
    console.print(f"PubChem CID {props['CID']} MW {props['MolecularWeight']} RDKit InChIKey match: {chk['ok']} (full={chk['full_match']})")

    ep = EuropePMCClient(store)
    hits, s = ep.search(f'"{drug}" AND ({nct} OR "CodeBreaK 100" OR "dose")', page_size=25)
    sources.append(s)
    for h in hits:
        sources.append(publication_source(h, s))
    console.print(f"Europe PMC: {len(hits)} hits")

    out.mkdir(parents=True, exist_ok=True)
    path = out / f"sources_{drug}_{nct}.json"
    path.write_text(json.dumps([x.model_dump(mode="json") for x in sources], ensure_ascii=False, indent=1))
    console.print(f"[green]{len(sources)} sources → {path}[/]  (external calls this run: {store.api_calls})")


@app.command()
def pdfinfo(path: Path, quote: str = typer.Option(None, help="quote to locate")):
    """Inspect a snapshot PDF: page count, first-page preview, optional quote search."""
    doc = PDFDocument(path)
    console.print(f"{path.name}: {doc.n_pages} pages")
    console.print(doc.page_text(1)[:600])
    if quote:
        for h in doc.find_quote(quote):
            console.print(f"  p.{h.page} exact={h.exact} bboxes={h.bboxes[:2]}")


if __name__ == "__main__":
    app()
