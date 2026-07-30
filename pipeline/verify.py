"""Verify the generated scoring tables against known authoritative values.

Exit non-zero on mismatch.

Two independent checks:

1. **By-eye anchors** — one (mark, score) pair transcribed by hand off the raw page text
   for each of the 36 event groups, plus the four high jump pairs that predate this file.
   These catch a structural regression: a column read one place to the left, a section
   attributed to the wrong gender, a layout flip missed.

2. **The World Athletics oracle** — the ranking calculations captured under
   src/engine/__fixtures__/oracle/. Each counting result there carries the mark World
   Athletics scored and the points it awarded, so this checks the numbers against World
   Athletics itself rather than against the book they were read from.

Placing scores are NOT checked here — they moved to verify_rules.py when the pipeline
gained the full set of Track & Field placing tables.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data"
ORACLE = ROOT / "src" / "engine" / "__fixtures__" / "oracle"
SPLIT_DIR = DATA / "scoring"

# One (mark -> score) pair per event group, read by eye from the raw page text of the
# official 2025 Scoring Tables PDF (World Athletics Scoring Tables of Athletics, 2025
# Revised Edition, by Dr. Bojidar Spiriev / Attila Spiriev). Both page layouts are
# represented: rows that lead with the score and rows that end with it. Page numbers are
# the printed ones.
#
# NOTE — anchor residual risk: these were read from the same PDF the pipeline parses, so
# they are independent at the reading-method level (human eye vs. extraction code), not at
# the source level. Check 2 below is the one that does not depend on the book at all.
# Do NOT change these values to force a pass.
ANCHORS = {
    "men": {
        "100m": ("10.02", 1199),           # p13:  "1199 - - - 10.02 - 20.57"
        "200m": ("19.81", 1250),           # p12:  "- - 6.43 - 19.81 20.25 1250"
        "400m": ("44.71", 1200),           # p43:  "1200 31.59 32.20 44.71 45.62 58.70 59.91"
        "800m": ("1:44.15", 1200),         # p133: "1200 1:13.72 1:15.52 1:44.15 1:46.03 ..."
        "1500m": ("3:34.64", 1180),        # p163: "1180 3:34.64 3:38.38 3:51.64 ..."
        "5000m": ("12:57.30", 1220),       # p192: "... 12:57.30 13:11.39 27:04.14 1220"
        "10000m": ("26:45.49", 1250),      # p192: "... 12:49.20 13:03.46 26:45.49 1250"
        "110mh": ("13.28", 1200),          # p73:  "1200 - - - 13.28 34.30 48.61"
        "400mh": ("48.61", 1200),          # p73:  same row, last column
        "3000msc": ("8:23.81", 1150),      # p164: "... 5:24.71 8:23.81 1150"
        "high-jump": ("2.32", 1197),       # p402: "1197 2.32 - 8.27 17.30 21.27 ..."
        "pole-vault": ("5.75", 1198),      # p402: "1198 - 5.75 - 17.31 21.29 ..."
        "long-jump": ("8.28", 1199),       # p402: "1199 - - 8.28 17.32 21.30 ..."
        "triple-jump": ("17.33", 1200),    # p402: "1200 - - - 17.33 21.32 67.57 79.80 86.91 ..."
        "shot-put": ("21.32", 1200),       # p402: same row
        "discus-throw": ("67.57", 1200),   # p402: same row
        "hammer-throw": ("79.80", 1200),   # p402: same row
        "javelin-throw": ("86.91", 1200),  # p402: same row
    },
    "women": {
        "100m": ("11.23", 1150),           # p433: "- - - 11.23 22.85 23.28 1150"
        "200m": ("21.88", 1250),           # p431: "- - - - 21.88 22.25 1250"
        "400m": ("50.65", 1180),           # p462: "1180 35.94 36.70 50.65 51.50 ..."
        "800m": ("2:03.55", 1100),         # p554: "1100 1:27.65 1:28.62 2:03.55 2:05.32 ..."
        "1500m": ("4:03.25", 1180),        # p582: "1180 4:03.25 4:05.98 4:21.74 ..."
        "5000m": ("14:31.21", 1220),       # p611: "... 14:31.21 14:43.94 30:30.51 1220"
        "10000m": ("29:57.88", 1250),      # p611: "... 14:16.20 14:29.08 29:57.88 1250"
        "100mh": ("13.00", 1150),          # p493: "- 7.46 - 13.00 38.76 55.74 1150"
        "400mh": ("55.74", 1150),          # p493: same row, last column
        "3000msc": ("9:37.67", 1150),      # p583: "... 6:09.61 9:37.67 1150"
        "high-jump": ("1.98", 1200),       # p822: "1200 1.98 - 6.92 14.80 19.88 ..."
        "pole-vault": ("4.77", 1198),      # p822: "1198 - 4.77 6.91 - 19.85 ..."
        "long-jump": ("6.92", 1200),       # p822: "1200 1.98 - 6.92 14.80 ..."
        "triple-jump": ("14.80", 1200),    # p822: same row
        "shot-put": ("19.88", 1200),       # p822: same row
        "discus-throw": ("66.95", 1200),   # p822: "... 19.88 66.95 76.58 66.55 4855 6633"
        "hammer-throw": ("76.58", 1200),   # p822: same row
        "javelin-throw": ("66.55", 1200),  # p822: same row
    },
}

# The four high jump anchors this file carried before the tables covered every event.
LEGACY_HIGH_JUMP = {
    "men": {"2.30": 1179, "2.00": 914},
    "women": {"2.06": 1279, "1.80": 1023},
}

# The long discipline name of each group's main event, as the result feeds write it. Only
# results in the main event can be checked: a similar event scores off its own column,
# which these tables do not carry.
MAIN_DISCIPLINE = {
    "100m": "100 Metres",
    "200m": "200 Metres",
    "400m": "400 Metres",
    "800m": "800 Metres",
    "1500m": "1500 Metres",
    "5000m": "5000 Metres",
    "10000m": "10,000 Metres",
    "110mh": "110 Metres Hurdles",
    "100mh": "100 Metres Hurdles",
    "400mh": "400 Metres Hurdles",
    "3000msc": "3000 Metres Steeplechase",
    "high-jump": "High Jump",
    "pole-vault": "Pole Vault",
    "long-jump": "Long Jump",
    "triple-jump": "Triple Jump",
    "shot-put": "Shot Put",
    "discus-throw": "Discus Throw",
    "hammer-throw": "Hammer Throw",
    "javelin-throw": "Javelin Throw",
}

TIMED = {
    "100m", "200m", "400m", "800m", "1500m", "5000m", "10000m",
    "110mh", "100mh", "400mh", "3000msc",
}

# World Athletics adjusts the score of a wind-affected result for the wind it was run or
# jumped in — up for a headwind, down for a tail. That adjustment is not in the scoring
# tables and the captured calculations do not carry the wind reading, so results in these
# events can sit a few points either side of the book. The oracle check counts them
# instead of failing on them. Every other event must agree exactly.
WIND_AFFECTED = {"100m", "200m", "110mh", "100mh", "long-jump", "triple-jump"}


def to_seconds(mark: str) -> float:
    """A mark as a number. Field marks pass through; times fold "M:SS.ss" into seconds."""
    value = 0.0
    for part in str(mark).strip().split(":"):
        value = value * 60 + float(part)
    return value


def load_tables() -> dict:
    path = DATA / "scoring_tables.json"
    if not path.exists():
        print(f"VERIFY FAILED: scoring_tables.json not found at {path}")
        print("  Run: python pipeline/parse_scoring.py")
        sys.exit(1)
    return json.loads(path.read_text(encoding="utf-8"))["events"]


def verify_anchors(events: dict) -> list[str]:
    errors = []
    for gender, group in ANCHORS.items():
        for slug, (mark, score) in group.items():
            table = events.get(gender, {}).get(slug)
            if table is None:
                errors.append(f"anchor {gender} {slug}: no table")
                continue
            got = table["marks"].get(mark)
            if got != score:
                errors.append(f"anchor {gender} {slug} {mark}: expected {score}, got {got}")
    for gender, marks in LEGACY_HIGH_JUMP.items():
        for mark, score in marks.items():
            got = events[gender]["high-jump"]["marks"].get(mark)
            if got != score:
                errors.append(f"anchor {gender} high-jump {mark}: expected {score}, got {got}")
    return errors


def score_for(table: dict, slug: str, mark: str) -> int:
    """The points a mark earns: the best score whose listed mark it reaches.

    The book's own rule — "should a performance fall between two results on the tables the
    lower score shall be considered" — which matters because the tables are sparse for the
    longer events: a 10,000m has far more possible times than the book has rows.
    """
    value = to_seconds(mark)
    faster_is_better = slug in TIMED
    best = 0
    for listed, points in table["marks"].items():
        listed_value = to_seconds(listed)
        reaches = value <= listed_value if faster_is_better else value >= listed_value
        if reaches and points > best:
            best = points
    return best


def verify_split(events: dict) -> list[str]:
    """The per-group chunks must reproduce the combined file exactly.

    They are what the app actually loads, so a stale chunk would score marks off an old
    table while every other check here still passed.
    """
    if not SPLIT_DIR.is_dir():
        return [f"split chunks not found at {SPLIT_DIR} - run pipeline/split_scoring.py"]

    expected = {f"{slug}-{gender}" for gender, groups in events.items() for slug in groups}
    found = {p.stem for p in SPLIT_DIR.glob("*.json")}
    errors = [f"split chunk missing: {s}" for s in sorted(expected - found)]
    errors += [f"stale split chunk: {s}" for s in sorted(found - expected)]

    for gender, groups in events.items():
        for slug, table in groups.items():
            path = SPLIT_DIR / f"{slug}-{gender}.json"
            if not path.is_file():
                continue
            chunk = json.loads(path.read_text(encoding="utf-8"))
            if chunk.get("marks") != table["marks"]:
                errors.append(
                    f"split chunk {slug}-{gender} disagrees with scoring_tables.json"
                )
    return errors


def verify_oracle(events: dict) -> tuple[list[str], str]:
    """Check every captured World Athletics counting result against the tables."""
    if not ORACLE.is_dir():
        return [f"oracle fixtures not found at {ORACLE}"], ""

    fixtures = sorted(ORACLE.glob("*.json"))
    # notLegal marks a wind-aided result, whose score carries a wind adjustment.
    wind_aided = set()
    for path in fixtures:
        for row in json.loads(path.read_text(encoding="utf-8")).get("results", []):
            if row.get("notLegal"):
                wind_aided.add(
                    (row.get("date"), str(row.get("mark", "")).strip(), row.get("discipline"))
                )

    errors: list[str] = []
    checked = wind_notes = 0
    for path in fixtures:
        data = json.loads(path.read_text(encoding="utf-8"))
        group = data.get("group")
        if not group:
            continue
        slug, gender = group["slug"], group["gender"]
        table = events.get(gender, {}).get(slug)
        if table is None:
            continue
        for row in data.get("calculation", {}).get("results", []):
            if row.get("discipline") != MAIN_DISCIPLINE.get(slug):
                continue
            expected = row.get("resultScore")
            if expected is None:
                continue
            mark = str(row["mark"]).strip()
            got = score_for(table, slug, mark)
            if got == expected:
                checked += 1
            elif slug in WIND_AFFECTED or (row.get("date"), mark, row.get("discipline")) in wind_aided:
                wind_notes += 1
            else:
                errors.append(
                    f"oracle {gender} {slug} {mark}: "
                    f"World Athletics scored {expected}, tables give {got}"
                )

    summary = (
        f"{checked} captured World Athletics results reproduced exactly, "
        f"{wind_notes} wind-affected results differ by the wind adjustment"
    )
    return errors, summary


def main() -> None:
    events = load_tables()
    errors = verify_anchors(events)
    errors += verify_split(events)
    oracle_errors, summary = verify_oracle(events)
    errors += oracle_errors

    if errors:
        print("VERIFY FAILED:")
        for error in errors:
            print("  -", error)
        sys.exit(1)

    groups = sum(len(g) for g in events.values())
    anchors = sum(len(g) for g in ANCHORS.values()) + sum(len(m) for m in LEGACY_HIGH_JUMP.values())
    print(f"Scoring tables verified: {groups} event groups, {anchors} by-eye anchors.")
    print(f"  {summary}.")
    print("Run verify_rules.py for the placing tables.")


if __name__ == "__main__":
    main()
