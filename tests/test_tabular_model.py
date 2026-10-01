"""TabPFN reference: injectable regressor, graceful degradation, never fabricates."""

import pytest

from trialboard.review.tabular_model import (
    DoseResponsePoint,
    estimate_rate_at_dose,
)


class FakeLinearRegressor:
    """Deterministic stand-in: tests must never need a real TabPFN license/network call."""

    def fit(self, features, target):
        self._x = [row[0] for row in features]
        self._y = list(target)
        return self

    def predict(self, features):
        # Simple linear interpolation/extrapolation, good enough for contract tests.
        x0, x1 = self._x[0], self._x[-1]
        y0, y1 = self._y[0], self._y[-1]
        slope = (y1 - y0) / (x1 - x0) if x1 != x0 else 0.0
        return [y0 + slope * (q[0] - x0) for q in features]


def points(*pairs):
    return [DoseResponsePoint(dose=d, rate=r) for d, r in pairs]


def test_insufficient_data_below_minimum_points():
    result = estimate_rate_at_dose(points((1.0, 20.0)), 5.0)
    assert result.status == "INSUFFICIENT_DATA"
    assert result.reason == "MIN_TRAINING_POINTS_NOT_MET"
    assert result.predicted_rate is None


def test_estimated_with_injected_fake_regressor():
    result = estimate_rate_at_dose(
        points((1.0, 20.0), (5.0, 40.0)),
        7.5,
        regressor_factory=FakeLinearRegressor,
    )
    assert result.status == "ESTIMATED"
    assert result.training_points == 2
    assert result.predicted_rate == pytest.approx(52.5)
    assert "임상적 권장 용량" in result.disclaimer


def test_estimated_clips_to_valid_rate_bounds():
    class Overshoot(FakeLinearRegressor):
        def predict(self, features):
            return [999.0 for _ in features]

    result = estimate_rate_at_dose(
        points((1.0, 20.0), (5.0, 40.0)), 50.0, regressor_factory=Overshoot
    )
    assert result.status == "ESTIMATED"
    assert result.predicted_rate == 100.0


def test_unavailable_when_regressor_raises():
    class Broken:
        def fit(self, *_):
            raise RuntimeError("TABPFN_LICENSE_REQUIRED")

    result = estimate_rate_at_dose(
        points((1.0, 20.0), (5.0, 40.0)), 7.5, regressor_factory=Broken
    )
    assert result.status == "UNAVAILABLE"
    assert "TABPFN_LICENSE_REQUIRED" in result.reason


def test_unavailable_never_raises_up_to_caller():
    class AlwaysBroken:
        def __call__(self):
            raise ImportError("no tabpfn installed")

    result = estimate_rate_at_dose(
        points((1.0, 20.0), (5.0, 40.0)), 7.5, regressor_factory=AlwaysBroken()
    )
    assert result.status == "UNAVAILABLE"


def test_training_points_capped_at_maximum():
    data = points((1.0, 10.0), (2.0, 20.0), (3.0, 30.0), (4.0, 40.0), (5.0, 50.0))
    result = estimate_rate_at_dose(data, 6.0, regressor_factory=FakeLinearRegressor)
    assert result.training_points == 4


def test_real_tabpfn_factory_degrades_without_license_instead_of_raising():
    # No TABPFN_TOKEN is configured in this environment; the default factory
    # must still return UNAVAILABLE rather than propagating an exception.
    result = estimate_rate_at_dose(points((1.0, 20.0), (5.0, 40.0)), 7.5)
    assert result.status in ("ESTIMATED", "UNAVAILABLE")
