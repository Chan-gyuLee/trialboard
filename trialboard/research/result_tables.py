"""Read posted registry results without estimating rates or splitting pooled groups."""

import json

from trialboard.serialization import sha256_json


def denominators(entries, group_id):
    return [
        {"unit": d.get("units", ""), "value": str(c.get("value", ""))}
        for d in entries
        for c in d.get("counts", [])
        if c.get("groupId") == group_id
    ]


def registry_results(store, run_id, *, run=None):
    run = run or store.get_run(run_id)
    source = (
        next((s for s in run.sources if s.id == f"registry_{run.request.nct_id}"), None)
        if run
        else None
    )
    if not source:
        return None
    con = store.connect()
    try:
        records = []
        for digest in source.raw_snapshots:
            row = con.execute("SELECT raw FROM snapshots WHERE digest=?", (digest,)).fetchone()
            if row:
                raw = json.loads(row[0])
                if sha256_json(raw) != digest:
                    raise ValueError("REGISTRY_SNAPSHOT_MISMATCH")
                for i, study in enumerate(raw.get("studies", [])):
                    if (
                        study.get("protocolSection", {})
                        .get("identificationModule", {})
                        .get("nctId")
                        == run.request.nct_id
                    ):
                        records.append((digest, i, study))
        if len(records) != 1:
            return None  # Do not pick a conflicting snapshot silently.
    finally:
        con.close()
    digest, study_index, record = records[0]
    results = record.get("resultsSection", {})
    base = f"/studies/{study_index}/resultsSection"
    outcomes = []
    measures = results.get("outcomeMeasuresModule", {}).get("outcomeMeasures", [])
    limited = len(measures) > 50
    for i, outcome in enumerate(measures[:50]):
        groups = {g["id"]: g for g in outcome.get("groups", []) if "id" in g}
        limited |= len(outcome.get("classes", [])) > 20
        for j, cls in enumerate(outcome.get("classes", [])[:20]):
            limited |= len(cls.get("categories", [])) > 20
            for k, category in enumerate(cls.get("categories", [])[:20]):
                limited |= len(category.get("measurements", [])) > 20
                for m, measurement in enumerate(category.get("measurements", [])[:20]):
                    group_id = measurement.get("groupId")
                    group = groups.get(group_id)
                    if group is None or measurement.get("value") is None:
                        continue
                    outcomes.append(
                        {
                            "title": outcome.get("title", ""),
                            "type": outcome.get("type", ""),
                            "groupId": group_id,
                            "groupTitle": group.get("title", ""),
                            "groupDescription": group.get("description", ""),
                            "population": outcome.get("populationDescription", ""),
                            "window": outcome.get("timeFrame", ""),
                            "definition": outcome.get("description", ""),
                            "parameter": outcome.get("paramType", ""),
                            "unit": outcome.get("unitOfMeasure", ""),
                            "classTitle": cls.get("title", ""),
                            "categoryTitle": category.get("title", ""),
                            "value": str(measurement["value"]),
                            "lower": measurement.get("lowerLimit"),
                            "upper": measurement.get("upperLimit"),
                            "dispersion": outcome.get("dispersionType", ""),
                            "spread": measurement.get("spread"),
                            "comment": measurement.get("comment", ""),
                            "denominators": denominators(
                                cls["denoms"] if cls.get("denoms") else outcome.get("denoms", []),
                                group_id,
                            ),
                            "denominatorScope": "CLASS" if cls.get("denoms") else "OUTCOME",
                            "overallDenominators": denominators(
                                outcome.get("denoms", []), group_id
                            ),
                            "locator": (
                                f"{base}/outcomeMeasuresModule/outcomeMeasures/{i}"
                                f"/classes/{j}/categories/{k}/measurements/{m}"
                            ),
                        }
                    )
                    if len(outcomes) >= 100:
                        break
                if len(outcomes) >= 100:
                    break
            if len(outcomes) >= 100:
                break
        if len(outcomes) >= 100:
            break
    adverse = results.get("adverseEventsModule", {})
    safety = []
    for i, group in enumerate(adverse.get("eventGroups", [])[:20]):
        for metric, prefix in [
            ("serious adverse events", "serious"),
            ("other adverse events", "other"),
            ("all-cause mortality", "deaths"),
        ]:
            affected, at_risk = group.get(prefix + "NumAffected"), group.get(prefix + "NumAtRisk")
            if affected is None and at_risk is None:
                continue
            safety.append(
                {
                    "groupId": group.get("id", ""),
                    "groupTitle": group.get("title", ""),
                    "groupDescription": group.get("description", ""),
                    "metric": metric,
                    "affected": affected,
                    "atRisk": at_risk,
                    "window": adverse.get("timeFrame", ""),
                    "description": adverse.get("description", ""),
                    "locator": f"{base}/adverseEventsModule/eventGroups/{i}",
                }
            )
    packet = {
        "schema": "registry-result-tables/1",
        "runId": run_id,
        "nctId": run.request.nct_id,
        "snapshotDigest": digest,
        "sourceUrl": source.url,
        "outcomes": outcomes,
        "safety": safety,
        "clinicalVerified": False,
        "computedRates": False,
        "limited": limited or len(outcomes) >= 100 or len(adverse.get("eventGroups", [])) > 20,
        "notice": (
            "등록 집단·수치의 원문입니다. 통합 결과를 용량별로 나누거나 "
            "비율에서 사건 수를 역산하지 않습니다."
        ),
    }
    from trialboard.research.readiness import assess_results

    packet["readiness"] = assess_results(packet)
    return packet
