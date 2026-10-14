"""Write the EBM correctness fixtures for lib/forecast/ebm.test.ts.

Trains a small classifier and a small regressor on a deterministic synthetic
dataset (random numbers, nothing real), exports both with
to_json(detail="minimal"), and records what Python predicts for about 30
hand-picked rows: values exactly on cut points, just below them, below the
training minimum, above the maximum, missing values, unparseable strings and
an unseen category. The TypeScript evaluator must reproduce these to ~1e-9.

    python -W ignore make_ebm_fixture.py

Writes, in lib/forecast/__fixtures__/:
    ebm-small.json, ebm-small-expected.json            (classification, logit)
    ebm-small-reg.json, ebm-small-reg-expected.json    (regression, identity)

Special numbers can't be written as JSON, so in the expected files an input
of {"float": "+inf"}, {"float": "-inf"} or {"float": "nan"} stands for that
number.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from interpret.glassbox import (
    ExplainableBoostingClassifier,
    ExplainableBoostingRegressor,
)

SEED = 7
OUT = Path(__file__).resolve().parent.parent / "lib" / "forecast" / "__fixtures__"

FEATURES = ["length_km", "crew_size", "soil", "rain_mm"]
FEATURE_TYPES = ["continuous", "continuous", "nominal", "continuous"]
SOILS = ["clay", "sand", "rock", "silt", "loam"]
# Pairs chosen explicitly so the fixture always covers a nominal x continuous
# pair and a continuous x continuous pair (both use the second bin level).
INTERACTIONS = [("soil", "rain_mm"), ("length_km", "crew_size")]


def make_data(n: int = 1500) -> tuple[pd.DataFrame, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(SEED)
    length = rng.lognormal(mean=1.5, sigma=0.8, size=n)
    crew = rng.integers(1, 31, size=n).astype(float)
    soil = rng.choice(SOILS, size=n, p=[0.3, 0.25, 0.2, 0.15, 0.1]).astype(object)
    rain = rng.uniform(0, 300, size=n)

    length[rng.random(n) < 0.08] = np.nan
    rain[rng.random(n) < 0.05] = np.nan
    soil[rng.random(n) < 0.05] = None

    X = pd.DataFrame({"length_km": length, "crew_size": crew, "soil": soil, "rain_mm": rain})

    len_f = np.nan_to_num(np.log(length), nan=1.0)
    rain_f = np.nan_to_num(rain, nan=150.0) / 100
    soil_f = pd.Series(soil).map({"clay": 0.8, "sand": 0.1, "rock": -0.6, "silt": 0.5, "loam": 0.0}).fillna(0.3).to_numpy()
    wet_clay = (pd.Series(soil) == "clay").to_numpy() * rain_f * 0.7
    signal = 0.9 * len_f - 0.06 * crew + soil_f + 0.4 * rain_f + wet_clay - 1.6
    y_cls = (rng.random(n) < 1 / (1 + np.exp(-signal))).astype(int)
    y_reg = 3.0 * signal + rng.normal(0, 1.0, size=n)
    return X, y_cls, y_reg


def edge_rows(ebm) -> list[dict]:
    """Rows that probe bin edges, missing values and unknown categories."""
    names = list(ebm.feature_names_in_)
    cuts = {
        name: [np.asarray(level, dtype=float) for level in ebm.bins_[i]]
        for i, name in enumerate(names)
        if ebm.feature_types_in_[i] == "continuous"
    }
    base = {"length_km": 4.2, "crew_size": 12.0, "soil": "sand", "rain_mm": 120.0}

    def row(**overrides):
        r = dict(base)
        r.update(overrides)
        return r

    rows = [base]
    lk0, lk1 = cuts["length_km"][0], cuts["length_km"][-1]
    cs0 = cuts["crew_size"][0]
    rn0, rn1 = cuts["rain_mm"][0], cuts["rain_mm"][-1]
    # Exactly on cut points (main-effect level and interaction level).
    rows += [
        row(length_km=float(lk0[0])),
        row(length_km=float(lk0[len(lk0) // 2])),
        row(length_km=float(lk0[-1])),
        row(length_km=float(lk1[len(lk1) // 2])),
        row(crew_size=float(cs0[0])),
        row(crew_size=float(cs0[-1])),
        row(rain_mm=float(rn0[3])),
        row(rain_mm=float(rn1[1])),
        row(rain_mm=float(rn1[-1]), soil="clay"),
    ]
    # Just below a cut point.
    rows += [
        row(length_km=float(np.nextafter(lk0[len(lk0) // 2], -np.inf))),
        row(rain_mm=float(np.nextafter(rn1[1], -np.inf)), soil="clay"),
    ]
    # Outside the training range.
    rows += [
        row(length_km=0.0001, crew_size=0.0, rain_mm=-50.0),
        row(length_km=1e6, crew_size=500.0, rain_mm=1e4),
        row(length_km=-math.inf, rain_mm=math.inf),
    ]
    # Missing values.
    rows += [
        row(length_km=None),
        row(rain_mm=None, soil="clay"),
        row(soil=None),
        row(length_km=None, crew_size=None, soil=None, rain_mm=None),
        row(length_km=math.nan),
    ]
    # Unknown category, empty string, strings in continuous columns.
    rows += [
        row(soil="volcanic"),
        row(soil=""),
        row(soil="volcanic", rain_mm=250.0),
        row(length_km="abc"),
        row(crew_size="12.5"),
        row(rain_mm=""),
        # Text is read like Python's float().
        row(rain_mm=" 1e2 "),
        row(length_km="nan"),
        row(crew_size="1_0"),
        row(rain_mm="-Infinity"),
        row(length_km="0x10"),
        row(soil=math.nan),
    ]
    # Every known category once, plus a few ordinary rows.
    rows += [row(soil=s, rain_mm=80.0 + 40 * k) for k, s in enumerate(SOILS)]
    rows += [
        {"length_km": 2.0, "crew_size": 3.0, "soil": "rock", "rain_mm": 10.0},
        {"length_km": 25.0, "crew_size": 28.0, "soil": "silt", "rain_mm": 290.0},
    ]
    return rows


def to_frame(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame({name: pd.Series([r.get(name) for r in rows], dtype=object) for name in FEATURES})


def encode_value(v):
    if isinstance(v, float):
        if math.isnan(v):
            return {"float": "nan"}
        if math.isinf(v):
            return {"float": "+inf" if v > 0 else "-inf"}
    return v


def expected(ebm, rows: list[dict], classification: bool) -> dict:
    X = to_frame(rows)
    contribs = ebm.eval_terms(X)
    if classification:
        score = ebm.decision_function(X)
        value = ebm.predict_proba(X)[:, 1]
    else:
        score = ebm.predict(X)
        value = score
    term_names = list(ebm.term_names_)
    out_rows = []
    for i, r in enumerate(rows):
        total = float(ebm.intercept_ if np.ndim(ebm.intercept_) == 0 else ebm.intercept_[0]) + float(contribs[i].sum())
        assert abs(total - float(score[i])) < 1e-9, "contributions must add up to the score"
        out_rows.append(
            {
                "input": {k: encode_value(v) for k, v in r.items()},
                "score": float(score[i]),
                "value": float(value[i]),
                "contributions": {t: float(contribs[i, j]) for j, t in enumerate(term_names)},
            }
        )
    return {
        "task": "classification" if classification else "regression",
        "terms": term_names,
        "rows": out_rows,
    }


def write(name: str, obj) -> int:
    path = OUT / name
    text = json.dumps(obj, indent=None, separators=(",", ":")) + "\n"
    path.write_text(text)
    return len(text.encode())


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    X, y_cls, y_reg = make_data()
    common = dict(
        feature_names=FEATURES,
        feature_types=FEATURE_TYPES,
        outer_bags=2,
        max_bins=16,
        max_interaction_bins=8,
        interactions=INTERACTIONS,
        random_state=SEED,
    )

    cls = ExplainableBoostingClassifier(**common).fit(X, y_cls)
    reg = ExplainableBoostingRegressor(**common).fit(X, y_reg)

    for ebm, stem, is_cls in ((cls, "ebm-small", True), (reg, "ebm-small-reg", False)):
        rows = edge_rows(ebm)
        size = write(f"{stem}.json", ebm.to_jsonable(detail="minimal"))
        write(f"{stem}-expected.json", expected(ebm, rows, is_cls))
        print(f"{stem}.json: {size / 1024:.1f} KB, {len(rows)} expected rows")


if __name__ == "__main__":
    main()
