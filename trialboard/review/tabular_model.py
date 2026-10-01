"""Optional TabPFN tabular reference for dose-response extrapolation.

This augments, never replaces, the deterministic NumPy/SciPy Monte Carlo
simulation in review/engine.py. It is a numeric pattern-matching reference
over already-verified (dose, reported_rate) pairs extracted from accepted
evidence, offered only as an additional heuristic signal alongside an
AI-proposed new dose (see agent/design_proposal.py). Never a clinical
recommendation, optimal-dose estimate or power calculation.

TabPFN requires a one-time license acceptance (TABPFN_TOKEN) to download
model weights, so this degrades to UNAVAILABLE with a reason instead of
raising whenever the model cannot be reached — the caller treats a
reference as optional context, never a precondition for a proposal.
"""

from typing import Literal

from pydantic import Field

from trialboard.agent.models import Contract

MIN_TRAINING_POINTS = 2
MAX_TRAINING_POINTS = 4


class DoseResponsePoint(Contract):
    dose: float
    rate: float = Field(ge=0, le=100)


class TabularReference(Contract):
    status: Literal["ESTIMATED", "UNAVAILABLE", "INSUFFICIENT_DATA"]
    queried_dose: float | None = None
    predicted_rate: float | None = Field(default=None, ge=0, le=100)
    training_points: int = 0
    reason: str | None = None
    disclaimer: str = (
        "TabPFN 기반 수치 패턴 추정 참고값입니다. 임상적 권장 용량·검정력 계산이 아니며, "
        "소수 용량군 외삽은 불확실성이 큽니다."
    )


def _default_regressor_factory():
    from tabpfn import TabPFNRegressor

    return TabPFNRegressor(device="cpu")


def estimate_rate_at_dose(
    points: list[DoseResponsePoint],
    queried_dose: float,
    *,
    regressor_factory=None,
) -> TabularReference:
    """Fit a tabular model on verified (dose, rate) pairs and query one dose.

    `regressor_factory` is injectable so tests never need a real TabPFN
    license/network call; it must return an object with scikit-learn-style
    `.fit(X, y)` / `.predict(X)` methods.
    """
    if len(points) < MIN_TRAINING_POINTS:
        return TabularReference(
            status="INSUFFICIENT_DATA",
            queried_dose=queried_dose,
            training_points=len(points),
            reason="MIN_TRAINING_POINTS_NOT_MET",
        )
    training = points[:MAX_TRAINING_POINTS]
    try:
        import numpy as np
    except ImportError as exc:
        return TabularReference(
            status="UNAVAILABLE",
            queried_dose=queried_dose,
            training_points=len(training),
            reason=f"NUMPY_IMPORT_FAILED:{type(exc).__name__}",
        )
    try:
        factory = regressor_factory or _default_regressor_factory
        model = factory()
        features = np.array([[p.dose] for p in training], dtype=float)
        target = np.array([p.rate for p in training], dtype=float)
        model.fit(features, target)
        prediction = model.predict(np.array([[queried_dose]], dtype=float))
        value = float(prediction[0])
    except Exception as exc:  # noqa: BLE001 - any model/license/network failure degrades, never raises
        return TabularReference(
            status="UNAVAILABLE",
            queried_dose=queried_dose,
            training_points=len(training),
            reason=f"{type(exc).__name__}:{str(exc)[:160]}",
        )
    return TabularReference(
        status="ESTIMATED",
        queried_dose=queried_dose,
        predicted_rate=min(100.0, max(0.0, value)),
        training_points=len(training),
    )
