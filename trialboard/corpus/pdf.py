"""PDF text + coordinates via PyMuPDF.

Gives the Citation Auditor two primitives:
* ``page_texts`` — per-page text used for verbatim quote checks.
* ``find_quote`` — page + bounding boxes for a quote so the UI can highlight it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import pymupdf as fitz


@dataclass
class QuoteHit:
    page: int  # 1-based
    bboxes: list[list[float]]
    exact: bool


_WS = re.compile(r"\s+")


def normalize_ws(s: str) -> str:
    return _WS.sub(" ", s).strip()


class PDFDocument:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.doc = fitz.open(str(self.path))
        self._texts: list[str] | None = None

    @property
    def n_pages(self) -> int:
        return self.doc.page_count

    def page_texts(self) -> list[str]:
        if self._texts is None:
            self._texts = [p.get_text("text") for p in self.doc]
        return self._texts

    def page_text(self, page: int) -> str:
        return self.page_texts()[page - 1]

    def find_quote(self, quote: str, *, pages: list[int] | None = None) -> list[QuoteHit]:
        """Locate a verbatim quote. Falls back to whitespace-normalised match."""
        hits: list[QuoteHit] = []
        q_norm = normalize_ws(quote)
        candidates = pages or range(1, self.n_pages + 1)
        for pno in candidates:
            page = self.doc[pno - 1]
            rects = page.search_for(quote)
            if rects:
                hits.append(QuoteHit(pno, [list(r) for r in rects], True))
                continue
            if q_norm and q_norm in normalize_ws(self.page_text(pno)):
                # normalised match: locate by the first ~60 chars to get a bbox
                head = q_norm[:60]
                rects = page.search_for(head)
                hits.append(QuoteHit(pno, [list(r) for r in rects], False))
        return hits

    def render_page_png(self, page: int, zoom: float = 2.0) -> bytes:
        pix = self.doc[page - 1].get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        return pix.tobytes("png")

    def close(self) -> None:
        self.doc.close()


def render_with_highlights(
    path: str | Path, page: int, bboxes: list[list[float]], out: str | Path, zoom: float = 2.0
) -> Path:
    """Render a page to PNG with translucent yellow boxes over the given bboxes."""
    doc = fitz.open(str(path))
    pg = doc[page - 1]
    for b in bboxes:
        annot = pg.add_highlight_annot(fitz.Rect(*b))
        annot.set_colors(stroke=(1, 0.85, 0.2))
        annot.update()
    pix = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    pix.save(str(out))
    doc.close()
    return out
