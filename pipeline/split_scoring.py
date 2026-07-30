"""Split the combined scoring tables into one file per event group.

scoring_tables.json is 1.1 MB. The app only ever needs one group at a time, so the
frontend loads these chunks on demand (src/engine/scoring.ts) instead of carrying the
whole book on the first-paint path. Run this after parse_scoring.py; verify.py checks the
two agree.
"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src" / "data" / "scoring_tables.json"
OUT_DIR = ROOT / "src" / "data" / "scoring"


def chunks(source: dict) -> dict[str, dict]:
    """Every group's chunk, keyed by output filename stem."""
    out = {}
    for gender, groups in source["events"].items():
        for slug, table in groups.items():
            out[f"{slug}-{gender}"] = {
                "generated_by": "pipeline/split_scoring.py",
                "slug": slug,
                "gender": gender,
                "column": table["column"],
                "marks": table["marks"],
            }
    return out


def main() -> None:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    written = chunks(source)

    # Rewrite from scratch, so a group dropped upstream cannot linger as a stale file
    # that verify.py would then happily check against nothing.
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True)

    for stem, chunk in written.items():
        path = OUT_DIR / f"{stem}.json"
        path.write_text(
            json.dumps(chunk, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
        )

    print(f"Wrote {len(written)} scoring-table chunks to {OUT_DIR.relative_to(ROOT)}.")


if __name__ == "__main__":
    main()
