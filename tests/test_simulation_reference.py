"""Small exact-binomial reference, separate from NumPy simulation implementation.

This checks the hypothetical algorithm, NOT clinical validity or operating
characteristics of a complete protocol. No model or expert evaluation is implied.
"""

import itertools
import math

import pytest

from trialboard.review.engine import simulate
from trialboard.review.models import Design, Scenario


def exact_selection(response, adverse, n, penalty, limit):
    """Enumerate every count outcome for two independent arms/endpoints."""
    rates = {"a": 0.0, "b": 0.0, "none": 0.0}
    for counts in itertools.product(range(n + 1), repeat=4):
        weight = math.prod(
            math.comb(n, count) * probability**count * (1 - probability) ** (n - count)
            for count, probability in zip(counts, (*response, *adverse), strict=True)
        )
        eligible = [i for i in range(2) if counts[2 + i] / n <= limit]
        if not eligible:
            rates["none"] += weight
            continue
        utility = {i: (counts[i] - penalty * counts[2 + i]) / n for i in eligible}
        best = max(utility.values())
        tied = [i for i in eligible if abs(utility[i] - best) <= 1e-12]
        for i in tied:
            rates[("a", "b")[i]] += weight / len(tied)
    assert sum(rates.values()) == pytest.approx(1, abs=1e-12)
    return rates


@pytest.mark.parametrize(
    "response,adverse,n,penalty,limit",
    [
        ((0.3, 0.4), (0.1, 0.3), 3, 0.7, 0.35),
        ((0.5, 0.5), (0.5, 0.5), 2, 1.0, 0.5),
        ((0.3, 0.4), (0.8, 0.9), 3, 0.7, 0.2),
        ((0.0, 1.0), (0.0, 0.0), 2, 0.0, 0.0),
        ((1.0, 1.0), (1.0, 1.0), 2, 10.0, 0.0),
        ((0.5, 0.5), (0.0, 0.0), 4, 0.0, 1.0),
    ],
)
def test_monte_carlo_selection_matches_independent_exact_enumeration(
    response, adverse, n, penalty, limit
):
    expected = exact_selection(response, adverse, n, penalty, limit)
    s = Scenario(
        id="exact-reference",
        label="Synthetic exact reference",
        arms=("a", "b"),
        response=response,
        adverse_event=adverse,
        adverse_event_penalty=penalty,
        maximum_adverse_event_rate=limit,
        rationale="Invented independent-binomial reference",
        provenance="synthetic_assumption",
    )
    repetitions = 100000
    result = simulate(
        s,
        Design(id="tiny", label="Enumeration only", per_arm=n),
        seed=20260914,
        repetitions=repetitions,
    )
    actual = {**result.selection_probability, "none": result.no_selection_probability}
    for arm, p in expected.items():
        # Fixed-seed, non-asymptotic edge cases and generous 6-SE regression tolerance.
        tolerance = max(1 / repetitions, 6 * math.sqrt(p * (1 - p) / repetitions))
        assert abs(actual[arm] - p) <= tolerance
    expected_unsafe = sum(expected[arm] for i, arm in enumerate(("a", "b")) if adverse[i] > limit)
    tolerance = max(
        1 / repetitions, 6 * math.sqrt(expected_unsafe * (1 - expected_unsafe) / repetitions)
    )
    assert abs(result.selects_true_unsafe_probability - expected_unsafe) <= tolerance


def test_exact_reference_symmetric_ties_and_deterministic_abstention():
    assert exact_selection((0.5, 0.5), (0, 0), 2, 0, 1) == {"a": 0.5, "b": 0.5, "none": 0.0}
    assert exact_selection((1, 1), (1, 1), 2, 1, 0) == {"a": 0.0, "b": 0.0, "none": 1.0}
