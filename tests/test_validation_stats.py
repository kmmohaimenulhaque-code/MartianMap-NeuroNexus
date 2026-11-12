"""NMAD, Frechet, Hausdorff and bootstrap behave as documented (Appendix A9)."""
from __future__ import annotations

import numpy as np
import pytest

from science.validation import stats


def test_nmad_and_rmse():
    assert stats.nmad([1, 2, 3, 4, 100]) == pytest.approx(1.4826)
    assert stats.rmse([3, -4]) == pytest.approx(np.sqrt(12.5))


def test_frechet_and_hausdorff_on_parallel_lines():
    a = np.column_stack([np.linspace(0, 100, 51), np.zeros(51)])
    b = a + [0, 5]
    assert stats.hausdorff(a, b) == pytest.approx(5)
    assert stats.discrete_frechet(a, b) == pytest.approx(5)


def test_frechet_respects_order_but_hausdorff_does_not():
    a = np.array([[0, 0], [10, 0], [20, 0]], float)
    b = a[::-1]
    assert stats.hausdorff(a, b) == pytest.approx(0)
    assert stats.discrete_frechet(a, b) == pytest.approx(20)


def test_bootstrap_is_seeded_and_brackets_the_estimate():
    rng = np.random.default_rng(0)
    x = rng.normal(0, 1, 500)
    y = x + rng.normal(0, 0.5, 500)
    p1, ci1 = stats.bootstrap(stats.spearman, x, y)
    p2, ci2 = stats.bootstrap(stats.spearman, x, y)
    assert (p1, ci1) == (p2, ci2)
    assert ci1[0] < p1 < ci1[1]


def test_resample_and_share_within():
    line = np.array([[0, 0], [100, 0]], float)
    pts = stats.resample(line, 10)
    assert len(pts) == 11 and stats.length(pts) == pytest.approx(100)
    assert stats.share_within(pts, line + [0, 5], 10) == 1.0
    assert stats.share_within(pts, line + [0, 50], 10) == 0.0


def test_slope_summary_reports_p90_ratio():
    tilt = np.linspace(0, 20, 200)
    slope = tilt / 2
    s = stats.summarize_slope(tilt, slope)
    assert s["p90_ratio"] == pytest.approx(2.0)
    assert s["spearman_rho"] == pytest.approx(1.0)
    assert s["n"] == 200
