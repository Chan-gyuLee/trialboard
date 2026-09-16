"""One explicitly requested synthetic connectivity call; no files or automatic retries."""

import argparse
import asyncio
import getpass
import os
import sys

from trialboard.agent.provider import ModelError
from trialboard.agent.runtime import runtime_provider


def main():
    parser = argparse.ArgumentParser(description="One competition API connectivity test")
    parser.add_argument("--allow-external", action="store_true")
    parser.add_argument("--prompt-key", action="store_true")
    args = parser.parse_args()
    if not args.allow_external:
        parser.error("--allow-external required: consumes competition team quota")
    if args.prompt_key:
        if not sys.stdin.isatty():
            parser.error("Hidden key input requires an interactive terminal")
        os.environ["TRIALBOARD_DACON_API_KEY"] = getpass.getpass(
            "Competition API key (hidden, memory only): "
        ).strip()
    try:
        provider = runtime_provider("dacon")
        reply = asyncio.run(
            provider.complete(
                instructions='Synthetic connectivity test. Return {"status":"OK"} only.',
                payload={"purpose": "synthetic connectivity test; no clinical data"},
                schema={
                    "type": "object",
                    "properties": {"status": {"type": "string", "enum": ["OK"]}},
                    "required": ["status"],
                    "additionalProperties": False,
                },
                max_output_tokens=512,
            )
        )
        if reply.value != {"status": "OK"}:
            raise ModelError("MODEL_OUTPUT_INVALID")
    except (ModelError, ValueError):
        # Never echo HTTP body, configuration or secret-containing exceptions.
        parser.exit(1, "Competition connection failed; no retry or personal-account fallback.\n")
    print(
        f"OK | {provider.mode} | {provider.model} | "
        f"input={reply.input_tokens} output={reply.output_tokens}"
    )
    for notice in reply.notices:
        print(notice)


if __name__ == "__main__":
    main()
