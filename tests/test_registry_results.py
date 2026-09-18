"""MOC registry tables: keep posted groups, counts, units and pointers distinct."""

import asyncio
import copy

import pytest
from test_automation import RUN
from test_automation import setup as automation_setup

from trialboard.research.result_tables import registry_results


@pytest.fixture
def setup(tmp_path):
    return automation_setup.__wrapped__(tmp_path)


def tables():
    return {
        "studies": [
            {
                "protocolSection": {"identificationModule": {"nctId": "NCT00000001"}},
                "resultsSection": {
                    "outcomeMeasuresModule": {
                        "outcomeMeasures": [
                            {
                                "title": "MOC ORR",
                                "unitOfMeasure": "percentage of participants",
                                "populationDescription": "MOC results collected as a single cohort",
                                "groups": [
                                    {
                                        "id": "OG0",
                                        "title": "MOC pooled",
                                        "description": "10 mg or 20 mg",
                                    }
                                ],
                                "denoms": [
                                    {
                                        "units": "Participants",
                                        "counts": [
                                            {"groupId": "OG0", "value": "41"},
                                            {"groupId": "other", "value": "999"},
                                        ],
                                    }
                                ],
                                "classes": [
                                    {
                                        "categories": [
                                            {
                                                "measurements": [
                                                    {
                                                        "groupId": "OG0",
                                                        "value": "26.8",
                                                        "lowerLimit": "14.2",
                                                        "upperLimit": "42.9",
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                ],
                            }
                        ]
                    },
                    "adverseEventsModule": {
                        "eventGroups": [
                            {
                                "id": "EG0",
                                "title": "MOC 10 mg",
                                "seriousNumAffected": 9,
                                "seriousNumAtRisk": 21,
                            },
                            {
                                "id": "EG1",
                                "title": "MOC 20 mg",
                                "seriousNumAffected": 9,
                                "seriousNumAtRisk": 22,
                            },
                        ]
                    },
                },
            }
        ]
    }


def bind(store, raw):
    run = store.get_run(RUN)
    source = run.sources[0].model_copy(
        update={
            "id": "registry_NCT00000001",
            "kind": "REGISTRY",
            "url": "https://clinicaltrials.gov/study/NCT00000001",
            "raw_snapshots": [store.snapshot(raw)],
        }
    )
    run.sources.append(source)
    store.save_run(run)


def test_pooled_outcome_is_not_split_and_no_counts_are_reconstructed(setup):
    _, store, _, _, _ = setup
    bind(store, tables())
    out = registry_results(store, RUN)
    assert len(out["outcomes"]) == 1
    row = out["outcomes"][0]
    assert row["groupTitle"] == "MOC pooled"
    assert row["value"] == "26.8"
    assert row["denominators"] == [{"unit": "Participants", "value": "41"}]
    assert "single cohort" in row["population"]
    assert row["locator"].endswith("/classes/0/categories/0/measurements/0")
    assert "events" not in row
    assert out["computedRates"] is False and out["clinicalVerified"] is False
    assert [(x["affected"], x["atRisk"]) for x in out["safety"]] == [(9, 21), (9, 22)]
    assert all(x["metric"] == "serious adverse events" for x in out["safety"])


def test_missing_groups_or_values_do_not_generate_measurements(setup):
    _, store, _, _, _ = setup
    raw = tables()
    raw["studies"][0]["resultsSection"]["outcomeMeasuresModule"]["outcomeMeasures"][0][
        "groups"
    ] = []
    bind(store, raw)
    assert registry_results(store, RUN)["outcomes"] == []


def test_wrong_trial_is_not_joined(setup):
    _, store, _, _, _ = setup
    raw = tables()
    raw["studies"][0]["protocolSection"]["identificationModule"]["nctId"] = "NCT00000002"
    bind(store, raw)
    assert registry_results(store, RUN) is None


def test_changed_snapshot_fails_closed(setup):
    _, store, _, _, _ = setup
    bind(store, tables())
    con = store.connect()
    with con:
        con.execute("UPDATE snapshots SET raw=?", ("{}",))
    con.close()
    with pytest.raises(ValueError, match="SNAPSHOT_MISMATCH"):
        registry_results(store, RUN)


def test_group_denominator_zero_remains_zero_and_unknown_is_not_filled(setup):
    _, store, _, _, _ = setup
    raw = tables()
    groups = raw["studies"][0]["resultsSection"]["adverseEventsModule"]["eventGroups"]
    groups[0]["seriousNumAffected"] = 0
    groups[0]["seriousNumAtRisk"] = 0
    del groups[1]["seriousNumAtRisk"]
    bind(store, raw)
    rows = registry_results(store, RUN)["safety"]
    assert rows[0]["affected"] == rows[0]["atRisk"] == 0
    assert rows[1]["atRisk"] is None


def test_table_limit_disclosed(setup):
    _, store, _, _, _ = setup
    raw = tables()
    outcomes = raw["studies"][0]["resultsSection"]["outcomeMeasuresModule"]["outcomeMeasures"]
    outcomes.extend(copy.deepcopy(outcomes[0]) for _ in range(60))
    bind(store, raw)
    out = registry_results(store, RUN)
    assert out["limited"] is True and len(out["outcomes"]) == 50


def test_collector_includes_posted_results_as_separate_model_source(setup, monkeypatch):
    from trialboard.research import collect

    _, store, _, _, _ = setup
    raw = tables()
    raw["studies"][0]["protocolSection"]["identificationModule"]["briefTitle"] = "MOC trial"
    raw["studies"][0]["protocolSection"]["designModule"] = {
        "designInfo": {"allocation": "RANDOMIZED", "interventionModel": "PARALLEL"}
    }

    async def fetch(query):
        assert query == "NCT00000001"
        return raw

    monkeypatch.setattr(collect, "fetch_registry", fetch)
    run = store.get_run(RUN)
    asyncio.run(collect.registry(run, store))
    source = next(s for s in run.sources if s.id == "registry_results_NCT00000001")
    assert "26.8" in source.text and "single cohort" in source.text
    assert "REGISTRY_RESULTS" in source.link_basis
    assert source.raw_snapshots
    assert '"groupId":"OG0"' in source.text
    assert "999" not in source.text
    registry = next(s for s in run.sources if s.id == "registry_NCT00000001")
    assert '"allocation": "RANDOMIZED"' in registry.text


def test_nested_limit_is_disclosed_and_null_value_is_not_text(setup):
    _, store, _, _, _ = setup
    raw = tables()
    measure = raw["studies"][0]["resultsSection"]["outcomeMeasuresModule"]["outcomeMeasures"][0]
    rows = measure["classes"][0]["categories"][0]["measurements"]
    rows.extend(copy.deepcopy(rows[0]) for _ in range(25))
    rows[0]["value"] = None
    bind(store, raw)
    result = registry_results(store, RUN)
    assert result["limited"] is True
    assert len(result["outcomes"]) == 19
    assert all(row["value"] == "26.8" for row in result["outcomes"])


def test_class_denominator_overrides_overall_without_borrowing_other_group(setup):
    _, store, _, _, _ = setup
    raw = tables()
    outcome = raw["studies"][0]["resultsSection"]["outcomeMeasuresModule"]["outcomeMeasures"][0]
    outcome["classes"][0]["denoms"] = [
        {"units": "Participants", "counts": [{"groupId": "OG0", "value": "17"}]}
    ]
    bind(store, raw)
    row = registry_results(store, RUN)["outcomes"][0]
    assert row["denominatorScope"] == "CLASS"
    assert row["denominators"] == [{"unit": "Participants", "value": "17"}]
    assert row["overallDenominators"] == [{"unit": "Participants", "value": "41"}]


def test_missing_class_group_does_not_fall_back_to_overall(setup):
    _, store, _, _, _ = setup
    raw = tables()
    outcome = raw["studies"][0]["resultsSection"]["outcomeMeasuresModule"]["outcomeMeasures"][0]
    outcome["classes"][0]["denoms"] = [
        {"units": "Participants", "counts": [{"groupId": "different", "value": "17"}]}
    ]
    bind(store, raw)
    row = registry_results(store, RUN)["outcomes"][0]
    assert row["denominators"] == [] and row["denominatorScope"] == "CLASS"


@pytest.mark.parametrize("reviewed", [True, False])
def test_posted_results_route_saves_plan_document_without_repeating_model(setup, reviewed):
    from test_automation import ORIGIN, document

    _, store, model, _, client = setup
    bind(store, tables())
    run = store.get_run(RUN)
    source = run.sources[-1].model_copy(
        update={
            "id": "registry_results_NCT00000001",
            "link_basis": ["REGISTRY_RESULTS"],
        }
    )
    run.sources.append(source)
    run.calls = [
        {
            "stage": "AI_REVIEW",
            "validation": "PASSED",
            "context_selection": {
                "sources": [
                    {
                        "source_id": source.id,
                        "source_digest": source.digest if reviewed else "c" * 64,
                    }
                ],
            },
        }
    ]
    store.save_run(run)
    response = client.post(
        f"/api/research/runs/{RUN}/automation",
        json={"document": document(), "consent": True},
        headers=ORIGIN,
    )
    assert response.status_code == 200
    expected = "PLAN_DOCUMENT_SAVED" if reviewed else "PREPARED"
    assert response.json()["status"] == expected
    assert store.get(RUN)["status"] == expected
    assert model.calls == 0
    if reviewed:
        assert response.json()["report"] is None and response.json()["decision"] is None
        assert response.json()["route"]["snapshotDigest"] == source.raw_snapshots[0]
        rejected = client.post(
            f"/api/research/runs/{RUN}/automation/run", json={"consent": True}, headers=ORIGIN
        )
        assert rejected.status_code == 409 and model.calls == 0
