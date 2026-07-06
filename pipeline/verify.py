"""Verify generated placing data against known authoritative values. Exit non-zero on mismatch."""
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "src" / "data"

# Known 1st-place T&F final placing points (World Athletics ranking rules 2025, Table 2.2).
# These are the authoritative anchor values from the brief; do NOT change to force a pass.
EXPECTED_PLACING_1ST = {"OW": 375, "DF": 240, "GW": 200, "GL": 170, "A": 140}

# Known high-jump performance points read directly from the official 2025 Scoring Tables PDF
# (World Athletics Scoring Tables of Athletics, 2025 Revised Edition, by Dr. Bojidar Spiriev /
# Attila Spiriev). Values extracted by pdfplumber text extraction from the official WA PDF
# (URL: worldathletics.org/download/download?filename=4f77dcb3-2945-4c58-ad8b-955a999b13e8.pdf).
# Independent source: read line-by-line from raw page text, NOT from extraction code output.
#   Men's section  (doc pages 398-425): columns "Points HJ PV LJ TJ SP DT HT JT Hept.sh Dec."
#   Women's section (doc pages 818-845): columns "Points HJ PV LJ TJ SP DT HT JT Pent.sh Hept."
# NOTE — anchor residual risk: these anchor values were read by eye from the same PDF that the
# pipeline downloads and parses via pdfplumber, so independence is at the reading-method level
# (human eye vs. extraction code), NOT at the source level.  A future maintainer who wants
# stronger assurance should cross-check these anchors against a third-party calculator (e.g.
# the official WA online scoring tool at worldathletics.org/util/scoring-calculator).
# Do NOT change these values to force a pass.
EXPECTED_PERFORMANCE = {
    "men": {
        "2.30": 1179,   # doc page 402: "1179 2.30 5.68 8.19 17.14 20.97 66.43 78.45 85.44 6213 8338"
        "2.00": 914,    # doc page 407: "2.00 - - 14.63 16.52 52.00 61.33 66.78 4925 6614 914"
    },
    "women": {
        "2.06": 1279,   # doc page 820: "1279 2.06 - - 15.57 21.14 71.22 81.45 70.80 5146 7031"
        "1.80": 1023,   # doc page 825: "1.80 - 6.11 13.07 17.04 57.35 65.63 57.01 4195 5733 1023"
    },
}


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


def verify_performance() -> list[str]:
    path = DATA / "scoring_table.json"
    if not path.exists():
        return [f"scoring_table.json not found at {path}"]
    data = json.loads(path.read_text())
    errors = []
    for gender, marks in EXPECTED_PERFORMANCE.items():
        for mark, pts in marks.items():
            got = data["points_by_mark"].get(gender, {}).get(mark)
            if got != pts:
                errors.append(
                    f"performance {gender} {mark}: expected {pts}, got {got}"
                )
    return errors


def main():
    errors = verify_placing() + verify_performance()
    if errors:
        print("VERIFY FAILED:")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    print("All data verified.")


if __name__ == "__main__":
    main()
