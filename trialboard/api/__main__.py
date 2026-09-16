"""Start the development API on loopback only; no public-host switch."""

import argparse
import getpass
import os
import sys

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="TrialBoard local synthetic review API")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--prompt-dacon-key",
        action="store_true",
        help="Read the competition key without echo; memory only",
    )
    parser.add_argument(
        "--agent-provider",
        choices=["dacon", "codex"],
        default="dacon",
        help="Product AI runtime (default: competition API; no fallback)",
    )
    parser.add_argument(
        "--enable-evidence-scout",
        action="store_true",
        help="Opt in to public ClinicalTrials.gov search and local SQLite snapshot storage",
    )
    parser.add_argument(
        "--enable-designs",
        action="store_true",
        help="Opt in to in-memory PDF design calculations on loopback",
    )
    parser.add_argument(
        "--enable-agent-demo",
        action="store_true",
        help="Opt in to fixed-case live agent execution; consumes selected provider quota",
    )
    parser.add_argument(
        "--enable-pdf-agent",
        action="store_true",
        help="Opt in to user-selected PDF excerpts sent to the selected model with consent",
    )
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    if args.prompt_dacon_key:
        if args.agent_provider != "dacon" or not sys.stdin.isatty():
            parser.error("Hidden key input requires an interactive terminal and dacon provider")
        key = getpass.getpass("Competition API key (hidden, memory only): ").strip()
        if not key:
            parser.error("Competition API key is required")
        os.environ["TRIALBOARD_DACON_API_KEY"] = key
        del key
    from trialboard.api.app import create_app

    uvicorn.run(
        create_app(
            enable_designs=args.enable_designs,
            enable_agent_demo=args.enable_agent_demo,
            enable_pdf_agent=args.enable_pdf_agent,
            enable_evidence_scout=args.enable_evidence_scout,
            agent_provider=args.agent_provider,
        ),
        host="127.0.0.1",
        port=args.port,
        access_log=False,
    )


if __name__ == "__main__":
    main()
