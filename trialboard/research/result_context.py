"""Bounded whole-table model context. Deduplicate metadata, never split a row from its group."""

import json

VERSION = "registry-context/1"
RESULT_CHARS = 18000
MAX_RESULT_SOURCES = 2


def result_pages(tables):
    remaining = {**tables, "outcomes": list(tables["outcomes"]), "safety": list(tables["safety"])}
    pages = []
    for _ in range(MAX_RESULT_SOURCES):
        text, ledger = compact_results(remaining)
        if not ledger["included"]:
            break
        pages.append((text, ledger))
        included = set(ledger["included"])
        remaining["outcomes"] = [r for r in remaining["outcomes"] if r["locator"] not in included]
        remaining["safety"] = [
            r for r in remaining["safety"] if r["locator"] + "#" + r["metric"] not in included
        ]
        if not remaining["outcomes"] and not remaining["safety"]:
            break
    total = len(tables["outcomes"]) + len(tables["safety"])
    included_count = sum(len(ledger["included"]) for _, ledger in pages)
    updated = []
    for index, (text, ledger) in enumerate(pages):
        # Replace local remainder counts: another bundle is supplied evidence, not missing data.
        text = text.rsplit("\nCoverage:", 1)[0]
        text += (
            f"\nBundle {index + 1}/{len(pages)} contains {len(ledger['included'])} rows. "
            f"GLOBAL COVERAGE across companion REGISTRY_RESULTS sources: "
            f"{included_count}/{total} rows INCLUDED; {total - included_count} rows OMITTED. "
            f"Upstream projection limited: {tables['limited']}. "
            "Read all companion sources before asking for missing results."
        )
        updated.append(
            (
                text,
                {
                    **ledger,
                    "global_included": included_count,
                    "global_omitted": total - included_count,
                },
            )
        )
    return updated


def review_char_limit(source):
    return (
        RESULT_CHARS
        if (source.kind == "REGISTRY" and "REGISTRY_RESULTS" in source.link_basis)
        else 4500
    )


def compact_results(tables, *, limit=RESULT_CHARS):
    """Return source text and auditable inclusion ledger, leaving source tables untouched."""
    blocks = {}
    for row in tables["outcomes"]:
        key = row["locator"].split("/classes/")[0]
        if key not in blocks:
            blocks[key] = {
                "kind": "POSTED_OUTCOME",
                "locator": key,
                "context": {
                    k: row.get(k)
                    for k in (
                        "title",
                        "type",
                        "population",
                        "window",
                        "definition",
                        "parameter",
                        "unit",
                        "dispersion",
                    )
                },
                "groups": {},
                "rows": [],
            }
        block = blocks[key]
        block["groups"][row["groupId"]] = {
            "title": row["groupTitle"],
            "description": row["groupDescription"],
        }
        block["rows"].append(
            {
                k: v
                for k, v in row.items()
                if k
                not in {
                    *block["context"],
                    "groupTitle",
                    "groupDescription",
                }
            }
        )
    if tables["safety"]:
        rows = tables["safety"]
        blocks["safety"] = {
            "kind": "POSTED_SAFETY",
            "context": {
                "window": rows[0]["window"],
                "description": rows[0]["description"],
            },
            "groups": {
                r["groupId"]: {"title": r["groupTitle"], "description": r["groupDescription"]}
                for r in rows
            },
            "rows": [
                {
                    k: v
                    for k, v in r.items()
                    if k
                    not in {
                        "window",
                        "description",
                        "groupTitle",
                        "groupDescription",
                    }
                }
                for r in rows
            ],
        }
    # Include primary outcome first, then safety, then remaining outcomes in source order.
    ordered = list(blocks)
    if "safety" in blocks:
        ordered.remove("safety")
        ordered.insert(min(1, len(ordered)), "safety")
    lines = [
        tables["nctId"],
        VERSION,
        tables["notice"],
        "POSTED RESULTS, not protocol plans. Context/groups apply only within each block.",
    ]
    included, omitted = [], []
    for key in ordered:
        line = json.dumps(blocks[key], ensure_ascii=False, separators=(",", ":"))
        refs = [
            r["locator"] + ("#" + r["metric"] if "metric" in r else "") for r in blocks[key]["rows"]
        ]
        if len("\n".join([*lines, line])) > limit - 300:
            omitted.extend(refs)
            continue
        lines.append(line)
        included.extend(refs)
    lines.append(
        f"Coverage: {len(included)} rows included; {len(omitted)} rows omitted from this excerpt. "
        f"Upstream table projection limited: {tables['limited']}. "
        "No rates computed; clinical comparability not verified."
    )
    return "\n".join(lines), {
        "version": VERSION,
        "snapshot_digest": tables["snapshotDigest"],
        "included": included,
        "omitted": omitted,
        "table_limited": tables["limited"],
    }
