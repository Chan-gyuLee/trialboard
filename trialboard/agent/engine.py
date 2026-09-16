"""Closed-loop extraction/critique with explicit budget, repair and abstention transitions."""

import asyncio
import platform
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from importlib.metadata import version
from uuid import uuid4

from pydantic import ValidationError

from trialboard.agent.clinical import METRIC_VERSION, metric_identity
from trialboard.agent.models import (
    AgentInput,
    AgentReport,
    Attempt,
    CallRecord,
    CanonicalMetric,
    Critique,
    Event,
    Extraction,
)
from trialboard.agent.prompts import COMMON, CRITIQUE, EXTRACT, PROMPT_VERSION
from trialboard.agent.provider import ModelError, Provider
from trialboard.agent.verify import critique_findings, finding, verify
from trialboard.serialization import sha256_json


@dataclass(frozen=True)
class Limits:
    max_calls: int = 6
    max_repairs: int = 2
    max_output_tokens: int = 4000
    max_total_tokens: int = 200000
    seconds: float = 120

    def __post_init__(self):
        values = [
            (self.max_calls, 1, 6),
            (self.max_repairs, 0, 2),
            (self.max_output_tokens, 512, 8000),
            (self.max_total_tokens, 1000, 300000),
        ]
        if any(type(v) is not int or not low <= v <= high for v, low, high in values):
            raise ValueError("INVALID_BUDGET")
        if not 0 < self.seconds <= 120:
            raise ValueError("INVALID_TIMEOUT")


class BudgetError(RuntimeError):
    pass


async def run_agent(
    data: AgentInput,
    provider: Provider,
    limits: Limits | None = None,
    *,
    on_progress: Callable[[dict], None] | None = None,
) -> AgentReport:
    limits = limits or Limits()
    if provider.mode not in (
        "OPENAI_RESPONSES",
        "DACON_RESPONSES",
        "CODEX_CHATGPT",
        "SCRIPTED_TEST_DOUBLE",
    ):
        raise ValueError("UNSUPPORTED_EXECUTION_MODE")
    started = datetime.now(UTC).isoformat()
    attempts, calls, events = [], [], []
    accepted = []
    status = "PARTIAL_ABSTENTION"
    used_tokens = 0
    # Reserve a conservative request ceiling, including JSON schema/protocol overhead.
    # This is a local token safety budget, NOT a dollar spend guarantee.
    reserved_tokens = 102000 + limits.max_output_tokens

    def progress(stage, attempt, state, **counts):
        # Only application stage metadata; never provider reasoning or raw diagnostics.
        if on_progress is not None:
            on_progress({"stage": stage, "attempt": attempt, "state": state, **counts})

    async def call(stage, attempt, instructions, payload, schema):
        nonlocal used_tokens
        if (
            len(calls) >= limits.max_calls
            or used_tokens + reserved_tokens > limits.max_total_tokens
        ):
            raise BudgetError("CALL_OR_TOKEN_BUDGET_EXCEEDED")
        index = len(calls)
        calls.append(
            CallRecord(
                stage=stage,
                attempt=attempt,
                response_id=None,
                input_tokens=None,
                output_tokens=None,
                outcome="STARTED",
            )
        )
        events.append(Event(stage=stage, attempt=attempt, codes=[]))
        progress(
            stage,
            attempt,
            "STARTED",
            items=[
                {"kind": "source", "id": s.id, "text": s.text[:1000], "span_ids": [s.id]}
                for s in data.spans[:6]
            ],
        )
        try:
            reply = await provider.complete(
                instructions=instructions,
                payload=payload,
                schema=schema,
                max_output_tokens=limits.max_output_tokens,
            )
            calls[index] = CallRecord(
                stage=stage,
                attempt=attempt,
                response_id=reply.response_id,
                input_tokens=reply.input_tokens,
                output_tokens=reply.output_tokens,
                outcome="RECEIVED",
                notices=list(reply.notices),
            )
            used_tokens += reply.input_tokens + reply.output_tokens
            if used_tokens > limits.max_total_tokens:
                raise BudgetError("REPORTED_TOKEN_BUDGET_EXCEEDED")
            return reply.value
        except BaseException:
            if calls[index].outcome == "STARTED":
                calls[index] = calls[index].model_copy(update={"outcome": "FAILED_OR_CANCELLED"})
            raise

    feedback = []
    prior = None
    try:
        async with asyncio.timeout(limits.seconds):
            for attempt in range(limits.max_repairs + 1):
                payload = {
                    "source": data.model_dump(mode="json"),
                    "feedback": feedback,
                    "previous_extraction": prior,
                }
                raw = await call(
                    "EXTRACT" if attempt == 0 else "REVISE",
                    attempt,
                    EXTRACT,
                    payload,
                    Extraction.model_json_schema(),
                )
                try:
                    extraction = Extraction.model_validate(raw)
                except ValidationError:
                    accepted = []
                    issues = [finding("INVALID_EXTRACTION_SCHEMA")]
                    attempts.append(
                        Attempt(number=attempt, extraction=None, findings=issues, critique=None)
                    )
                    feedback = [i.model_dump() for i in issues]
                    events.append(
                        Event(stage="VERIFY", attempt=attempt, codes=["INVALID_EXTRACTION_SCHEMA"])
                    )
                    continue
                prior = extraction.model_dump(mode="json")
                progress(
                    "EXTRACT" if attempt == 0 else "REVISE",
                    attempt,
                    "COMPLETED",
                    observations=len(extraction.observations),
                    items=[
                        {
                            "kind": "observation",
                            "id": o.id,
                            "text": (
                                f"{o.fields.dose.value or '용량 미보고'} · "
                                f"{o.fields.metric.value or '지표 미보고'} · "
                                f"사건 {o.fields.events.value or '미보고'} / "
                                f"분모 {o.fields.denominator.value or '미보고'} · "
                                f"보고 비율 {o.fields.reported_rate.value or '미보고'}"
                            )[:1000],
                            "span_ids": sorted(
                                {
                                    f.span_id
                                    for f in o.fields.__dict__.values()
                                    if f.span_id is not None
                                }
                            )[:12],
                        }
                        for o in extraction.observations
                    ],
                )
                candidates, issues = verify(data, extraction)
                # Nothing from this new attempt is adopted before its critique completes.
                accepted = []
                events.append(
                    Event(stage="VERIFY", attempt=attempt, codes=sorted({i.code for i in issues}))
                )
                progress(
                    "VERIFY",
                    attempt,
                    "COMPLETED",
                    findings=len(issues),
                    codes=sorted({i.code for i in issues}),
                    items=[
                        {
                            "kind": "finding",
                            "id": f"finding-{n}",
                            "text": (
                                f"{i.code} · {i.observation_id or '전체'} · "
                                f"{i.field or ''} · {i.detail}"
                            )[:1000],
                            "span_ids": [],
                        }
                        for n, i in enumerate(issues[:24])
                    ],
                )
                critique = None
                attempts.append(
                    Attempt(
                        number=attempt, extraction=extraction, findings=issues.copy(), critique=None
                    )
                )
                if candidates:
                    candidate_extraction = Extraction(observations=candidates)
                    response = await call(
                        "CRITIQUE",
                        attempt,
                        CRITIQUE,
                        {
                            "source": data.model_dump(mode="json"),
                            "extraction": candidate_extraction.model_dump(),
                            "deterministic_findings": [i.model_dump() for i in issues],
                        },
                        Critique.model_json_schema(),
                    )
                    try:
                        critique = Critique.model_validate(response)
                    except ValidationError:
                        raise ModelError("INVALID_CRITIQUE_SCHEMA") from None
                    objections = critique_findings(data, candidate_extraction, critique)
                    progress(
                        "CRITIQUE",
                        attempt,
                        "COMPLETED",
                        concerns=len(critique.concerns),
                        questions=len(critique.next_questions),
                        items=[
                            {
                                "kind": "concern",
                                "id": f"concern-{n}",
                                "text": c.reason[:1000],
                                "span_ids": c.span_ids[:12],
                            }
                            for n, c in enumerate(critique.concerns)
                        ]
                        + [
                            {
                                "kind": "question",
                                "id": f"question-{n}",
                                "text": q[:1000],
                                "span_ids": [],
                            }
                            for n, q in enumerate(critique.next_questions)
                        ],
                    )
                    issues.extend(objections)
                    if not any(i.code == "INVALID_CRITIQUE_REFERENCE" for i in objections):
                        rejected = {i.observation_id for i in objections}
                        accepted = [o for o in candidates if o.id not in rejected]
                attempts[-1] = Attempt(
                    number=attempt, extraction=extraction, findings=issues, critique=critique
                )
                if not issues and accepted:
                    status = "DRAFT_FOR_EXPERT_REVIEW"
                    break
                if (
                    accepted
                    and issues
                    and all(i.code == "MODEL_COMPARISON_LIMITATION" for i in issues)
                ):
                    # New extraction of the same source cannot settle applicability.
                    # Preserve the concerns; do not spend another call pretending to repair them.
                    progress(
                        "HANDOFF",
                        attempt,
                        "COMPLETED",
                        items=[
                            {
                                "kind": "decision",
                                "id": "comparison-needs-context",
                                "text": (
                                    "지원된 관측 초안은 유지합니다. "
                                    "남은 쟁점은 비교 적용 한계이므로 "
                                    "같은 자료의 재추출을 생략하고, "
                                    "확인 질문과 함께 사람에게 인계합니다."
                                ),
                                "span_ids": [],
                            }
                        ],
                    )
                    break
                feedback = [i.model_dump() for i in issues]
            if attempts and attempts[-1].extraction is None:
                status = "FAILED"
            events.append(Event(stage=status, attempt=len(attempts) - 1, codes=[]))
    except BudgetError as exc:
        status = "BUDGET_EXCEEDED"
        events.append(Event(stage=status, attempt=len(attempts), codes=[str(exc)]))
    except TimeoutError:
        status = "FAILED"
        events.append(Event(stage=status, attempt=len(attempts), codes=["RUN_TIMEOUT"]))
    except ModelError as exc:
        status = "FAILED"
        events.append(Event(stage=status, attempt=len(attempts), codes=[str(exc)]))
    # External task cancellation propagates; it never becomes successful abstention.
    if status in ("FAILED", "BUDGET_EXCEEDED"):
        accepted = []
    return AgentReport(
        run_id=str(uuid4()),
        started_at=started,
        input_digest=sha256_json(data.model_dump()),
        input=data,
        prompt_version=PROMPT_VERSION,
        prompt_digest=sha256_json([COMMON, EXTRACT, CRITIQUE]),
        engine_version="bounded-evidence-agent/3.2",
        runtime={
            "python": platform.python_version(),
            "pydantic": version("pydantic"),
            "httpx": version("httpx"),
            "clinical_labels": METRIC_VERSION,
            **getattr(provider, "runtime", {}),
        },
        execution_mode=provider.mode,
        model=provider.model,
        budgets=asdict(limits),
        status=status,
        accepted=accepted,
        metric_mappings=[
            CanonicalMetric(
                observation_id=o.id,
                source_label=o.fields.metric.value,
                family=metric_identity(
                    o.fields.metric.value, o.fields.definition.value, o.fields.definition.quote
                )[0],
                code=metric_identity(
                    o.fields.metric.value, o.fields.definition.value, o.fields.definition.quote
                )[1],
                mapping_version=METRIC_VERSION,
            )
            for o in accepted
        ],
        attempts=attempts,
        calls=calls,
        events=events,
        limitations=[
            "Literal source/count checks and model critique are not clinical validation.",
            "Same-model critique is not independent expert review; omissions may remain.",
            "No autonomous search, trial design recommendation, PK/PD inference or simulation.",
            "Source PDF hash is supplied by the export; PDF bytes are not rehashed here.",
            "Only supplied spans were reviewed; conclusions do not cover the whole document.",
            "Accepted observations remain unverified drafts, not clinical evidence approval.",
            "Canonical label mapping is a small vocabulary, not endpoint equivalence validation.",
            "Reported percentages remain rates, never reconstructed event counts.",
            "Rate/population binding supports one prose pattern; other syntax stays unverified.",
            "Curated public source digests cover excerpts, not original HTML/PDF bytes.",
            "Usage caps do not guarantee monetary cost; failed calls may still be billed.",
            *(
                [
                    "Codex uses saved ChatGPT CLI login for local development, not an API key.",
                    "Codex output token target is a prompt hint, NOT a hard per-call token cap.",
                    "Codex CLI usage is not remaining subscription quota; "
                    "failed usage may be unknown.",
                    "Call budget counts CLI turns, not internal HTTP retries or provider requests.",
                    "Ephemeral CLI mode is not a provider-side zero-retention guarantee.",
                ]
                if provider.mode == "CODEX_CHATGPT"
                else []
            ),
        ],
    )
