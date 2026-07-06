"""Verify generated placing data against known authoritative values. Exit non-zero on mismatch."""
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "src" / "data"

# Known 1st-place T&F final placing points (World Athletics ranking rules 2025, Table 2.2).
# These are the authoritative anchor values from the brief; do NOT change to force a pass.
EXPECTED_PLACING_1ST = {"OW": 375, "DF": 240, "GW": 200, "GL": 170, "A": 140}


def verify_placing() -> list[str]:
    path = DATA / "placing_points.json"
    if not path.exists():
        return [f"placing_points.json not found at {path}"]
    data = json.loads(path.read_text())
    if "final" not in data:
        return ["placing_points.json missing 'final' key"]
    errors = []
    for cat, pts in EXPECTED_PLACING_1ST.items():
        got = data["final"].get(cat, {}).get("1")
        if got != pts:
            errors.append(f"placing {cat} 1st: expected {pts}, got {got}")
    # Also check all 10 categories are present
    expected_cats = {"OW", "DF", "GW", "GL", "A", "B", "C", "D", "E", "F"}
    actual_cats = set(data["final"].keys())
    missing = expected_cats - actual_cats
    if missing:
        errors.append(f"Missing categories in 'final': {sorted(missing)}")
    return errors


def main():
    errors = verify_placing()
    if errors:
        print("VERIFY FAILED:")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    print("Placing data verified.")


if __name__ == "__main__":
    main()
