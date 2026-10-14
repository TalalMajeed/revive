# Training

Offline model training. Nothing here runs on Vercel: the app only loads the
exported `model.json` and evaluates it in TypeScript.

```bash
cd training
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Try the pipeline on synthetic rows (not real data)
python make_sample_data.py
python train_ebm.py --data data/sample_snapshots.csv --target late \
    --group project_id --drop month --out out/model.json
```

This writes `out/model.json` (the EBM from `to_json()`, about 0.5 MB at the
default `--detail minimal`) and `out/model.metrics.json` (held-out AUC and
Brier score, plus an always-the-base-rate baseline). interpret warns that
its JSON format is in beta; that is expected.

The CSV has one row per project snapshot: a project id column, the label
(`late` as 0/1 for `--task classification`, or months late with
`--task regression`), and one column per signal. Columns that aren't
signals, such as dates, go in `--drop`.

- `data/` is git-ignored apart from `.gitkeep`. Training rows are
  anonymised before they go in, and client data never goes to a paid or
  free LLM service.
- One row per project snapshot. `--group` names the project column so the
  held-out split keeps every snapshot of a project on one side.
- `.github/workflows/train-model.yml` runs this on the 1st of each month and
  skips cleanly while `data/snapshots.csv` doesn't exist. Because `data/` is
  git-ignored, the workflow needs a fetch step for the anonymised export
  before it can train for real.
