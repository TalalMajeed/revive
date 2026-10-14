"""Make the DEMO award-risk model from SYNTHETIC data.

!! SYNTHETIC DATA. NOT REAL PROJECTS. !!
Every row this script makes is random numbers with a relationship to delay
that was made up to look plausible for Pakistani public works. It exists
only to demonstrate the pipeline (setup answers -> EBM -> chance of finishing
late with reasons) end to end. The model it writes must be replaced by one
trained on real finished projects before anyone relies on its numbers; the
app labels it as a demo model (`isDemoModel: true` in lib/forecast/award.ts).

One row per finished project, with what was known at contract award, and a
label `late` = 1 when it finished more than about a month after the original
completion date (base rate around 0.6). Made-up effects: low funding secured,
design incomplete at award, very low bids against the engineer's estimate,
few bidders, large and long projects, and a contractor PEC category at the
edge of its limit for the contract size all add risk.

    python -W ignore make_award_demo_data.py
    python -W ignore make_award_demo_data.py --csv data/award_demo.csv  # also keep the rows

Writes lib/forecast/models/award-demo.json (to_json detail="minimal").
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from interpret.glassbox import ExplainableBoostingClassifier
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import train_test_split

SEED = 2026
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "lib" / "forecast" / "models" / "award-demo.json"

PROJECT_TYPES = {
    "building": 0.33,
    "road": 0.25,
    "bridge": 0.08,
    "water_sanitation": 0.12,
    "irrigation": 0.09,
    "power": 0.06,
    "other": 0.07,
}
CLIENT_TYPES = {
    "federal_government": 0.15,
    "provincial_government": 0.40,
    "local_government": 0.14,
    "autonomous_body": 0.12,
    "donor": 0.09,
    "private": 0.10,
}
# Funding source given the client.
FUNDING_BY_CLIENT = {
    "federal_government": {"psdp": 0.75, "foreign_aid": 0.1, "mixed": 0.15},
    "provincial_government": {"adp": 0.7, "psdp": 0.1, "foreign_aid": 0.08, "mixed": 0.12},
    "local_government": {"adp": 0.55, "own_funds": 0.3, "mixed": 0.15},
    "autonomous_body": {"own_funds": 0.5, "psdp": 0.25, "mixed": 0.25},
    "donor": {"foreign_aid": 0.85, "mixed": 0.15},
    "private": {"private": 0.7, "own_funds": 0.2, "mixed": 0.1},
}
PROVINCES = {"punjab": 0.40, "sindh": 0.20, "kp": 0.15, "balochistan": 0.10, "ict": 0.07, "gb": 0.04, "ajk": 0.04}
DESIGN = {"complete": 0.45, "partial": 0.35, "concept": 0.20}
# PEC categories with rough upper contract limits in PKR (approximate, for
# the made-up "category at the edge of its limit" effect only).
PEC_LIMITS = [
    ("C6", 1.0e8),
    ("C5", 2.5e8),
    ("C4", 5.0e8),
    ("C3", 1.0e9),
    ("C2", 2.5e9),
    ("C1", 4.0e9),
    ("CA", np.inf),
]
# log10 median contract value by project type.
SIZE_BY_TYPE = {
    "building": 8.3,
    "road": 8.8,
    "bridge": 8.9,
    "water_sanitation": 8.4,
    "irrigation": 8.6,
    "power": 9.2,
    "other": 8.0,
}

# Made-up effects on the log-odds of finishing late.
EFFECT_TYPE = {"building": 0.0, "road": 0.1, "bridge": 0.2, "water_sanitation": 0.2, "irrigation": 0.15, "power": 0.3, "other": 0.0}
EFFECT_CLIENT = {
    "federal_government": 0.1,
    "provincial_government": 0.0,
    "local_government": 0.25,
    "autonomous_body": 0.0,
    "donor": -0.45,
    "private": -0.6,
}
EFFECT_FUNDING = {"psdp": 0.2, "adp": 0.1, "foreign_aid": -0.2, "own_funds": -0.1, "private": -0.3, "mixed": 0.05}
EFFECT_DESIGN = {"complete": 0.0, "partial": 0.4, "concept": 1.0}
EFFECT_PROVINCE = {"punjab": 0.0, "sindh": 0.1, "kp": 0.15, "balochistan": 0.4, "ict": -0.2, "gb": 0.3, "ajk": 0.2}

FEATURES = [
    "project_type",
    "client_type",
    "funding_source",
    "funding_secured_pct",
    "contract_value_pkr",
    "bid_to_estimate",
    "bidders_count",
    "planned_duration_days",
    "pec_category",
    "design_status_at_award",
    "province",
]
MONOTONE = {
    "funding_secured_pct": False,
    "contract_value_pkr": True,
    "bid_to_estimate": False,
    "bidders_count": False,
    "planned_duration_days": True,
}
CATEGORICAL = {"project_type", "client_type", "funding_source", "pec_category", "design_status_at_award", "province"}


def pick(rng: np.random.Generator, dist: dict[str, float], n: int | None = None):
    keys = list(dist)
    p = np.array([dist[k] for k in keys])
    return rng.choice(keys, size=n, p=p / p.sum())


def make_rows(n: int, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for i in range(n):
        project_type = str(pick(rng, PROJECT_TYPES))
        client_type = str(pick(rng, CLIENT_TYPES))
        funding_source = str(pick(rng, FUNDING_BY_CLIENT[client_type]))
        if client_type in ("donor", "private"):
            secured = 100 * rng.beta(8, 1.5)
        else:
            secured = 100 * rng.beta(2.5, 1.6)
        log_value = np.clip(rng.normal(SIZE_BY_TYPE[project_type], 0.5), 7.7, 10.7)
        value = 10**log_value
        bid_ratio = float(np.clip(rng.normal(0.95, 0.09), 0.7, 1.2))
        bidders = int(np.clip(rng.poisson(5) + (1 if rng.random() < 0.5 else 0), 1, 15))
        duration = int(np.clip(120 + 380 * (log_value - 7.7) + rng.normal(0, 120), 120, 1500))
        design = str(pick(rng, DESIGN))
        province = str(pick(rng, PROVINCES))

        # Lowest category allowed for this size, then sometimes one or two above.
        need = next(k for k, (_, limit) in enumerate(PEC_LIMITS) if value <= limit)
        step = int(rng.choice([0, 1, 2], p=[0.55, 0.3, 0.15]))
        pec_idx = min(need + step, len(PEC_LIMITS) - 1)
        pec = PEC_LIMITS[pec_idx][0]
        at_limit = pec_idx == need and pec != "CA"

        logit = (
            -0.03 * (secured - 60)
            + EFFECT_DESIGN[design]
            + 9.0 * max(0.0, 0.88 - bid_ratio)
            + 2.0 * max(0.0, bid_ratio - 1.1)
            + (0.6 if bidders <= 2 else 0.0)
            - 0.05 * (bidders - 5)
            + 0.5 * (log_value - 8.5)
            + 0.0006 * (duration - 500)
            + (0.45 if at_limit else 0.0)
            + EFFECT_TYPE[project_type]
            + EFFECT_CLIENT[client_type]
            + EFFECT_FUNDING[funding_source]
            + EFFECT_PROVINCE[province]
        )
        rows.append(
            {
                "project_id": f"SYNTHETIC-{i:04d}",
                "project_type": project_type,
                "client_type": client_type,
                "funding_source": funding_source,
                "funding_secured_pct": round(float(secured), 1),
                "contract_value_pkr": round(float(value), -3),
                "bid_to_estimate": round(bid_ratio, 3),
                "bidders_count": bidders,
                "planned_duration_days": duration,
                "pec_category": pec,
                "design_status_at_award": design,
                "province": province,
                "_logit": logit,
            }
        )
    df = pd.DataFrame(rows)

    # Shift so the base rate is about 0.6, then draw the label.
    target = 0.6
    shift = 0.0
    for _ in range(60):
        mean = (1 / (1 + np.exp(-(df["_logit"] + shift)))).mean()
        shift += (target - mean) * 4
    p_late = 1 / (1 + np.exp(-(df["_logit"] + shift)))
    df["late"] = (rng.random(n) < p_late).astype(int)
    df = df.drop(columns="_logit")

    # Some answers are often unknown at setup; keep a few gaps so the model
    # learns something for a missing value.
    for col, rate in (("funding_secured_pct", 0.05), ("bid_to_estimate", 0.05), ("bidders_count", 0.04)):
        df.loc[rng.random(n) < rate, col] = np.nan
    return df


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--rows", type=int, default=600)
    p.add_argument("--seed", type=int, default=SEED)
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--csv", type=Path, default=None, help="also write the synthetic rows here")
    args = p.parse_args()

    df = make_rows(args.rows, args.seed)
    if args.csv:
        args.csv.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(args.csv, index=False)

    X = df[FEATURES]
    y = df["late"]
    feature_types = ["nominal" if f in CATEGORICAL else "continuous" for f in FEATURES]

    def make_model():
        return ExplainableBoostingClassifier(
            feature_types=feature_types,
            interactions=0,
            outer_bags=8,
            max_bins=24,
            random_state=args.seed,
        )

    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, random_state=args.seed, stratify=y)
    held_out = make_model().fit(X_tr, y_tr)
    for term, increasing in MONOTONE.items():
        held_out.monotonize(term, increasing=increasing)
    proba = held_out.predict_proba(X_te)[:, 1]
    print(f"rows {len(df)}, base rate {y.mean():.2f}")
    print(f"held-out AUC {roc_auc_score(y_te, proba):.3f}, Brier {brier_score_loss(y_te, proba):.3f} (synthetic data)")

    model = make_model().fit(X, y)
    # 600 rows leave the curves noisy at the thin ends (e.g. 12+ bidders);
    # force the directions the made-up effects have so the demo reads sensibly.
    for term, increasing in MONOTONE.items():
        model.monotonize(term, increasing=increasing)
    exported = model.to_jsonable(detail="minimal")
    exported = {
        "_note": "DEMO MODEL trained on synthetic data by training/make_award_demo_data.py. "
        "Not real projects: replace with a model trained on real finished projects.",
        **exported,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(exported, separators=(",", ":")) + "\n"
    args.out.write_text(text)
    print(f"wrote {args.out} ({len(text.encode()) / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
