"""Run all three synthetic review paths without API credentials or network access."""

import argparse
from pathlib import Path

from trialboard.review.engine import run_review
from trialboard.review.example import example_designs, example_scenarios, make_example
from trialboard.review.report import to_markdown


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode", choices=["normal", "denominator-error", "missing-evidence"], default="normal"
    )
    parser.add_argument("--out", type=Path, default=Path("output/review"))
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--repetitions", type=int, default=10000)
    args = parser.parse_args()
    request = make_example(args.mode)
    report = run_review(
        request,
        example_scenarios(),
        example_designs(),
        seed=args.seed,
        repetitions=args.repetitions,
    )
    args.out.mkdir(parents=True, exist_ok=True)
    base = args.out / args.mode
    base.with_suffix(".json").write_text(report.model_dump_json(indent=2), encoding="utf-8")
    base.with_suffix(".md").write_text(to_markdown(report), encoding="utf-8")
    base.with_suffix(".input.json").write_text(request.model_dump_json(indent=2), encoding="utf-8")
    print(
        f"SYNTHETIC ONLY | {report.status} | "
        f"{len(report.checked_claims)} matched claims | {len(report.issues)} issues"
    )
    print(base.with_suffix(".md"))


if __name__ == "__main__":
    main()
