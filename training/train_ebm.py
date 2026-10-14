"""Train an Explainable Boosting Machine on a CSV and export it with to_json().

The exported JSON holds each signal's learned curve as a lookup table, which
the app evaluates in TypeScript, so no Python runs on Vercel.

Rules from the build plan this script follows:
- Split by project, never by row: every snapshot of a project stays on one
  side of the split, otherwise the score is inflated.
- Report AUC and Brier score (classification) or error in months
  (regression) on held-out projects before fitting on everything.

Usage:
    python train_ebm.py --data data/snapshots.csv --target late \
        --group project_id --out ../models/model.json

With no data file it prints a message and exits 0, so the scheduled
workflow is harmless until data exists.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from interpret.glassbox import (
    ExplainableBoostingClassifier,
    ExplainableBoostingRegressor,
)
from sklearn.metrics import brier_score_loss, mean_absolute_error, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit

SEED = 42


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--data", type=Path, required=True, help="training CSV, one row per project snapshot")
    p.add_argument("--target", required=True, help="label column, e.g. late (0/1) or months_late")
    p.add_argument("--task", choices=["classification", "regression"], default="classification")
    p.add_argument("--group", default="project_id", help="column identifying the project, for the split")
    p.add_argument(
        "--drop",
        nargs="*",
        default=[],
        help="extra columns that are not signals (ids, dates)",
    )
    p.add_argument("--test-size", type=float, default=0.2, help="share of projects held out")
    p.add_argument("--out", type=Path, default=Path("model.json"))
    p.add_argument(
        "--detail",
        choices=["minimal", "interpretable", "mergeable", "all"],
        default="minimal",
        help="to_json() detail; minimal holds all the app needs to predict and is "
        "about 15x smaller than all",
    )
    p.add_argument("--metrics-out", type=Path, default=None, help="defaults to <out>.metrics.json")
    return p.parse_args(argv)


def make_model(task: str):
    if task == "classification":
        return ExplainableBoostingClassifier(random_state=SEED)
    return ExplainableBoostingRegressor(random_state=SEED)


def evaluate(task: str, model, X: pd.DataFrame, y: pd.Series) -> dict[str, float]:
    if task == "classification":
        proba = model.predict_proba(X)[:, 1]
        metrics = {"brier": float(brier_score_loss(y, proba))}
        if y.nunique() > 1:
            metrics["auc"] = float(roc_auc_score(y, proba))
        return metrics
    pred = model.predict(X)
    return {"mae": float(mean_absolute_error(y, pred))}


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if not args.data.exists():
        print(f"No training data at {args.data}; nothing to train.")
        return 0

    df = pd.read_csv(args.data)
    if df.empty:
        print(f"{args.data} has no rows; nothing to train.")
        return 0

    missing = [c for c in (args.target, args.group) if c not in df.columns]
    if missing:
        print(f"Missing columns in {args.data}: {', '.join(missing)}", file=sys.stderr)
        return 1

    df = df.dropna(subset=[args.target])
    y = df[args.target]
    groups = df[args.group]
    X = df.drop(columns=[args.target, args.group, *args.drop], errors="ignore")
    if X.shape[1] == 0:
        print("No signal columns left after dropping the target, group and --drop columns.", file=sys.stderr)
        return 1

    n_projects = groups.nunique()
    metrics: dict[str, object] = {
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "task": args.task,
        "target": args.target,
        "rows": int(len(df)),
        "projects": int(n_projects),
        "signals": list(X.columns),
    }

    # Held-out score, split by project.
    if n_projects >= 5:
        split = GroupShuffleSplit(n_splits=1, test_size=args.test_size, random_state=SEED)
        train_idx, test_idx = next(split.split(X, y, groups))
        held_out = make_model(args.task).fit(X.iloc[train_idx], y.iloc[train_idx])
        metrics["held_out_projects"] = int(groups.iloc[test_idx].nunique())
        metrics["held_out"] = evaluate(args.task, held_out, X.iloc[test_idx], y.iloc[test_idx])
        if args.task == "classification":
            # Baseline: always predict the training base rate.
            base_rate = float(y.iloc[train_idx].mean())
            metrics["baseline_brier"] = float(
                brier_score_loss(y.iloc[test_idx], np.full(len(test_idx), base_rate))
            )
    else:
        print(f"Only {n_projects} projects: skipping the held-out score.")

    # Final model on every project.
    model = make_model(args.task).fit(X, y)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    model.to_json(args.out, detail=args.detail, indent=None)

    metrics_out = args.metrics_out or args.out.with_suffix(".metrics.json")
    metrics_out.write_text(json.dumps(metrics, indent=2) + "\n")

    print(f"Wrote {args.out} and {metrics_out}")
    print(json.dumps(metrics.get("held_out", {}), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
