"""Verify the generated scoring table against known authoritative values.

Exit non-zero on mismatch.

Placing scores are NOT checked here any more — they moved to verify_rules.py when
the pipeline gained the full set of Track & Field placing tables. The anchors that
used to live here were for the 2025 rules (an OW win scored 375); the 2026 edition
scores it 260, so leaving them would have failed every correct run.
"""
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "src" / "data"

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
    errors = verify_performance()
    if errors:
        print("VERIFY FAILED:")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    print("Scoring table verified. Run verify_rules.py for the placing tables.")


if __name__ == "__main__":
    main()
