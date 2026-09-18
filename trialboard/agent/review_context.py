"""Explicit, untrusted field-to-context links for a frozen human review."""


def critique_payload(checked):
    payload = {
        "source": checked["input"],
        "extraction": {"observations": checked["accepted"]},
        "deterministic_findings": checked["findings"],
    }
    accepted = {row["id"] for row in checked["accepted"]}
    links = [
        {"observation_id": row["id"], "field": name, "citations": field["current"]["supporting"]}
        for row in sorted(checked["review"]["rows"], key=lambda row: row["id"])
        if row["id"] in accepted
        for name, field in sorted(row["fields"].items())
        if field["decision"] in ("confirmed", "corrected") and field["current"].get("supporting")
    ]
    # Preserve the exact legacy request shape when contextual links are absent.
    if links:
        payload["field_context_citations"] = links
    rates = {k: v for k, v in checked.get("normalized_rates", {}).items() if k in accepted}
    if rates:
        payload["user_normalized_rates"] = rates
    return payload
