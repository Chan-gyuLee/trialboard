"""Exact anchor location, with full-file integrity checks before PDF processing."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import pdfplumber


class EvidenceIntegrityError(ValueError):
    pass


def verify_file(path: Path, expected_hash: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
        raise EvidenceIntegrityError("Invalid SHA-256")
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected_hash:
        raise EvidenceIntegrityError(f"Snapshot hash mismatch: {path.name}")


def anchor_pattern(quote: str) -> str:
    words = quote.split()
    if len(words) < 3:
        raise EvidenceIntegrityError("An anchor must contain at least three words")
    # Only whitespace may vary. No prefix-only or approximate matches.
    return r"(?<!\w)" + r"\s+".join(re.escape(w) for w in words) + r"(?!\w)"


def locate(path: Path, expected_hash: str, page_number: int, quote: str) -> dict:
    verify_file(path, expected_hash)
    with pdfplumber.open(path) as pdf:
        if not 1 <= page_number <= len(pdf.pages):
            raise EvidenceIntegrityError("PDF page out of range")
        page = pdf.pages[page_number - 1]
        hits = page.search(anchor_pattern(quote), regex=True, case=True)
        if len(hits) != 1:
            raise EvidenceIntegrityError(f"Expected one exact anchor, found {len(hits)}")
        hit = hits[0]
        if " ".join(hit["text"].split()) != " ".join(quote.split()):
            raise EvidenceIntegrityError("Matched anchor differs from requested text")
        # Preserve separate line rectangles; one multiline bounding box highlights too much.
        lines: list[list[dict]] = []
        for char in hit["chars"]:
            if not char["text"].strip():
                continue
            line = next((line for line in lines if abs(line[0]["top"] - char["top"]) < 2), None)
            if line is None:
                lines.append([char])
            else:
                line.append(char)
        boxes = [
            {
                "x": min(c["x0"] for c in line) / page.width,
                "y": min(c["top"] for c in line) / page.height,
                "width": (max(c["x1"] for c in line) - min(c["x0"] for c in line)) / page.width,
                "height": (max(c["bottom"] for c in line) - min(c["top"] for c in line))
                / page.height,
            }
            for line in lines
        ]
        if not boxes or any(
            not 0 <= b["x"] <= 1
            or not 0 <= b["y"] <= 1
            or b["x"] + b["width"] > 1.001
            or b["y"] + b["height"] > 1.001
            for b in boxes
        ):
            raise EvidenceIntegrityError("Invalid page coordinates")
        return {
            "page": page_number,
            "quote": hit["text"],
            "boxes": boxes,
            "page_width": page.width,
            "page_height": page.height,
            "coordinate_system": "normalized_top_left_rendered_page",
            "pdf_rotation": page.rotation,
            "location_status": "exact_anchor_located",
            "meaning_status": "developer_curated_not_expert_validated",
        }


def render_page(path: Path, expected_hash: str, page_number: int, output: Path) -> None:
    verify_file(path, expected_hash)
    with pdfplumber.open(path) as pdf:
        if not 1 <= page_number <= len(pdf.pages):
            raise EvidenceIntegrityError("PDF page out of range")
        output.parent.mkdir(parents=True, exist_ok=True)
        pdf.pages[page_number - 1].to_image(resolution=120).save(str(output))
