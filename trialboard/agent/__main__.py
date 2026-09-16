"""Local CLI only. Live model calls require explicit outbound permission and configuration."""

import argparse
import asyncio
import os
from pathlib import Path

from pydantic import SecretStr, ValidationError

from trialboard.agent.engine import Limits, run_agent
from trialboard.agent.example import ScriptedProvider, demo_input
from trialboard.agent.models import AgentInput
from trialboard.agent.pdf_input import from_pdf_export
from trialboard.agent.provider import OpenAIResponses, parse_json
from trialboard.agent.public_case import public_input, score_public_report
from trialboard.agent.report import markdown
from trialboard.agent.runtime import runtime_provider


def read_input(path: Path):
    with path.open("rb") as stream:
        raw = stream.read(2_000_001)
    if len(raw) > 2_000_000:
        raise ValueError("INPUT_FILE_TOO_LARGE")
    return parse_json(raw)


def main():
    parser = argparse.ArgumentParser(description="TrialBoard bounded document review agent")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--demo", choices=["normal", "repair", "missing", "persistent"])
    group.add_argument(
        "--live-example",
        choices=["normal", "missing"],
        help="Send synthetic evidence to a REAL model (consumes usage)",
    )
    group.add_argument("--input", type=Path, help="AgentInput JSON")
    group.add_argument(
        "--public-example",
        choices=["selpercatinib-2024"],
        help="Frozen FDA text; REAL model usage; developer evaluation only",
    )
    group.add_argument("--pdf-export", type=Path, help="Browser PDF evidence JSON export")
    parser.add_argument("--asset")
    parser.add_argument("--indication")
    parser.add_argument("--study")
    parser.add_argument("--question")
    parser.add_argument("--provider", choices=["dacon", "codex", "openai"], default="dacon")
    parser.add_argument(
        "--allow-external",
        action="store_true",
        help="Permit selected text transfer to OpenAI and ChatGPT usage/API billing",
    )
    parser.add_argument("--max-calls", type=int, default=6)
    parser.add_argument("--max-repairs", type=int, default=2)
    args = parser.parse_args()
    try:
        limits = Limits(max_calls=args.max_calls, max_repairs=args.max_repairs)
        if args.demo:
            data, provider = demo_input(args.demo), ScriptedProvider(args.demo)
        else:
            if not args.allow_external:
                parser.error(
                    "--allow-external이 필요합니다. 원문 전송·과금에 동의한 뒤 실행하세요."
                )
            if args.public_example:
                data = public_input()
            elif args.live_example:
                data = demo_input(args.live_example)
            elif args.pdf_export:
                if not all([args.asset, args.indication, args.study, args.question]):
                    parser.error(
                        "PDF 검토에는 --asset --indication --study --question이 필요합니다."
                    )
                data = from_pdf_export(
                    read_input(args.pdf_export),
                    asset=args.asset,
                    indication=args.indication,
                    study=args.study,
                    question=args.question,
                )
            else:
                data = AgentInput.model_validate(read_input(args.input))
            if args.provider in ("dacon", "codex"):
                provider = runtime_provider(args.provider)
            else:
                key = os.environ.get("TRIALBOARD_OPENAI_API_KEY", "")
                model = os.environ.get("TRIALBOARD_OPENAI_MODEL", "")
                if not key or not model:
                    parser.error(
                        "TRIALBOARD_OPENAI_API_KEY / TRIALBOARD_OPENAI_MODEL 설정이 필요합니다."
                    )
                provider = OpenAIResponses(SecretStr(key), model)
        result = asyncio.run(run_agent(data, provider, limits))
    except (ValueError, OSError, ValidationError):
        parser.exit(2, "입력/설정을 검증하지 못했습니다. 파일 형식·크기·필수 항목을 확인하세요.\n")
    root = Path("output/agent")
    root.mkdir(parents=True, exist_ok=True)
    for suffix, content in [("json", result.model_dump_json(indent=2)), ("md", markdown(result))]:
        path = root / f"{result.run_id}.{suffix}"
        with path.open("x", encoding="utf-8") as stream:
            path.chmod(0o600)
            stream.write(content)
    print(f"{result.status} | {result.execution_mode} | calls={len(result.calls)}")
    print(f"{root / result.run_id}.json")
    if args.public_example:
        score = score_public_report(result)
        path = root / f"{result.run_id}.evaluation.json"
        import json

        with path.open("x", encoding="utf-8") as stream:
            path.chmod(0o600)
            stream.write(json.dumps(score, ensure_ascii=False, indent=2))
        print(f"Developer checks: {sum(score['checks'].values())}/{len(score['checks'])}")
        if not score["all_checks_pass"] and result.status not in ("FAILED", "BUDGET_EXCEEDED"):
            parser.exit(3)
    if result.status in ("FAILED", "BUDGET_EXCEEDED"):
        parser.exit(1)


if __name__ == "__main__":
    main()
