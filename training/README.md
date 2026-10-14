# Training

Offline model training. Nothing here runs on Vercel: the app only loads the
exported `model.json` and evaluates it in TypeScript.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python train_ebm.py --data data/snapshots.csv --target late --group project_id --out out/model.json
```

- `data/` is git-ignored apart from `.gitkeep`. Training rows are
  anonymised before they go in, and client data never goes to a paid or
  free LLM service.
- One row per project snapshot. `--group` names the project column so the
  held-out split keeps every snapshot of a project on one side.
- `.github/workflows/train-model.yml` runs this on the 1st of each month and
  skips cleanly while `data/snapshots.csv` doesn't exist. Because `data/` is
  git-ignored, the workflow needs a fetch step for the anonymised export
  before it can train for real.
