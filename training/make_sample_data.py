"""Write a synthetic snapshots CSV for trying out train_ebm.py.

The rows are random numbers with a made-up relationship to delay. They are
for checking the pipeline runs, never for training a real model.

    python make_sample_data.py            # writes data/sample_snapshots.csv
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--out", type=Path, default=Path(__file__).parent / "data" / "sample_snapshots.csv")
    p.add_argument("--projects", type=int, default=60)
    p.add_argument("--seed", type=int, default=0)
    args = p.parse_args()

    rng = np.random.default_rng(args.seed)
    rows = []
    for p_id in range(args.projects):
        bidders = int(rng.integers(1, 12))
        bid_ratio = float(rng.normal(0.95, 0.1))
        funding_secured_pct = float(rng.uniform(30, 100))
        payment_delay_days = int(rng.integers(0, 120))
        for month in range(1, 7):
            progress_lag = float(rng.normal(0.04 * month, 0.08))
            score = -1.5 + 0.02 * payment_delay_days + 4 * progress_lag - 0.08 * bidders - 0.01 * (funding_secured_pct - 70)
            late = int(rng.random() < 1 / (1 + np.exp(-score)))
            rows.append(
                {
                    "project_id": f"SYN-{p_id:03d}",
                    "month": month,
                    "bidders": bidders,
                    "bid_ratio": round(bid_ratio, 3),
                    "funding_secured_pct": round(funding_secured_pct, 1),
                    "payment_delay_days": payment_delay_days,
                    "progress_lag": round(progress_lag, 3),
                    "late": late,
                }
            )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(args.out, index=False)
    print(f"Wrote {len(rows)} synthetic rows for {args.projects} projects to {args.out}")


if __name__ == "__main__":
    main()
