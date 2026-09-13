"""Explicit scripted transport doubles. Never substitute these for a failed live call."""

from trialboard.agent.models import AgentInput, Span
from trialboard.agent.provider import Reply
from trialboard.serialization import sha256_json


def demo_input(mode="normal") -> AgentInput:
    texts = []
    for dose, metric, events in [
        ("dose-A", "response", 6),
        ("dose-B", "response", 7),
        ("dose-A", "adverse_event", 2),
        ("dose-B", "adverse_event", 5),
    ]:
        if mode == "missing" and dose == "dose-B" and metric == "adverse_event":
            continue
        texts.append(
            f"asset DEMO-01; indication demo-tumor; study DEMO-STUDY; "
            f"cohort expansion; dose {dose}; metric {metric}; events {events}; "
            "denominator 20; population evaluable; window week-12; "
            f"definition {metric}-definition."
        )
    digest = sha256_json(texts)
    return AgentInput(
        question="두 용량의 반응과 이상반응을 비교하기 전에 무엇을 확인해야 하는가?",
        asset="DEMO-01",
        indication="demo-tumor",
        study="DEMO-STUDY",
        spans=[
            Span(id=f"span-{i}", source_digest=digest, page=1, text=text)
            for i, text in enumerate(texts)
        ],
        provenance="synthetic_fixture",
    )


class ScriptedProvider:
    mode = "SCRIPTED_TEST_DOUBLE"
    model = "scripted-fixture-not-a-model"

    def __init__(self, scenario="normal"):
        self.scenario = scenario
        self.extractions = 0
        self.requests = []

    async def complete(self, *, instructions, payload, schema, max_output_tokens):
        self.requests.append(payload)
        if schema["title"] == "Critique":
            value = {
                "concerns": [],
                "next_questions": ["실제 원문과 집단 정의를 전문가가 확인했는가?"],
            }
        else:
            self.extractions += 1
            observations = []
            for i, span in enumerate(payload["source"]["spans"]):
                fields = {}
                fields["reported_rate"] = {"value": None, "span_id": None, "quote": None}
                for part in span["text"].removesuffix(".").split("; "):
                    key, field_value = part.split(" ", 1)
                    fields[key] = {
                        "value": field_value,
                        "span_id": span["id"],
                        "quote": part,
                    }
                if i == 1 and (
                    self.scenario == "persistent"
                    or self.scenario == "repair"
                    and self.extractions == 1
                ):
                    fields["denominator"]["value"] = "200"
                observations.append(
                    {"id": f"obs-{i}", "value_kind": "event_count", "fields": fields}
                )
            value = {"observations": observations}
        return Reply(value, f"scripted-{len(self.requests)}", 0, 0)
