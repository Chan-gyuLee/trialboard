"""Start the development API on loopback only; no public-host switch."""

import argparse

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="TrialBoard local synthetic review API")
    parser.add_argument("--port", type=int, default=8000)
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
        help="Opt in to fixed-case live Codex demo; consumes the logged-in account quota",
    )
    parser.add_argument(
        "--enable-pdf-agent",
        action="store_true",
        help="Opt in to user-selected PDF excerpts sent to Codex with per-run consent",
    )
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    from trialboard.api.app import create_app

    uvicorn.run(
        create_app(
            enable_designs=args.enable_designs,
            enable_agent_demo=args.enable_agent_demo,
            enable_pdf_agent=args.enable_pdf_agent,
            enable_evidence_scout=args.enable_evidence_scout,
        ),
        host="127.0.0.1",
        port=args.port,
        access_log=False,
    )


if __name__ == "__main__":
    main()
