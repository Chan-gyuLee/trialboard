"""Trial Board CLI."""

from __future__ import annotations

import json
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from trialboard.agents.evidence_scout import collect as run_collect
from trialboard.corpus.pdf import PDFDocument, render_with_highlights
from trialboard.corpus.snapshot import SnapshotStore
from trialboard.graph.store import GraphStore

app = typer.Typer(no_args_is_help=True, help="Trial Board — evidence-linked trial design agents")
console = Console()


@app.command()
def collect(
    drug: str = typer.Argument(..., help="generic name, e.g. sotorasib"),
    nct: str = typer.Option(..., "--nct", help="ClinicalTrials.gov ID"),
    mode: str = typer.Option("auto", help="snapshot|live|auto"),
    pdfs: bool = typer.Option(True, help="download FDA review/letter/label PDFs"),
    db: Path = typer.Option(Path("data/db/trialboard.sqlite")),
    out: Path = typer.Option(Path("data/manifests")),
):
    """COLLECT: pull registry, history, Drugs@FDA docs, seeds, PubChem, papers → graph + lineage."""
    snapshots = SnapshotStore(mode=mode)  # type: ignore[arg-type]
    graph = GraphStore(db)
    r = run_collect(drug, nct, snapshots=snapshots, graph=graph, pdfs=pdfs, log=console.print)

    t = Table(title=f"Trial lineage {nct} ({len(r.lineage_nodes)} nodes, collapsed registry)")
    for col in ("date", "kind", "title"):
        t.add_column(col)
    for n in sorted(r.lineage_nodes, key=lambda n: (n.date or "9999-99-99").__str__()):
        if n.kind.value == "registry_version":
            continue
        t.add_row(str(n.date), n.kind.value, n.title[:90])
    console.print(t)

    out.mkdir(parents=True, exist_ok=True)
    path = out / f"sources_{drug}_{nct}.json"
    path.write_text(
        json.dumps([x.model_dump(mode="json") for x in r.sources], ensure_ascii=False, indent=1)
    )
    console.print(f"[green]{len(r.sources)} sources → {path}[/] · external calls: {r.api_calls}")


@app.command()
def pdfinfo(
    path: Path,
    quote: str = typer.Option(None, help="quote to locate"),
    png: Path = typer.Option(None, help="render first hit with highlight to this PNG"),
):
    """Inspect a snapshot PDF: page count, first-page preview, optional quote search + render."""
    doc = PDFDocument(path)
    console.print(f"{path.name}: {doc.n_pages} pages")
    console.print(doc.page_text(1)[:600])
    if quote:
        hits = doc.find_quote(quote)
        for h in hits:
            console.print(f"  p.{h.page} exact={h.exact} bboxes={h.bboxes[:2]}")
        if hits and png:
            render_with_highlights(path, hits[0].page, hits[0].bboxes, png)
            console.print(f"  rendered → {png}")


@app.command()
def stats(db: Path = typer.Option(Path("data/db/trialboard.sqlite"))):
    """Row counts in the evidence graph."""
    console.print(GraphStore(db).counts())


if __name__ == "__main__":
    app()
