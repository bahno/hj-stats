"""Verify the extracted rules data against by-eye anchors. Exit non-zero on mismatch.

Run after scrape_rules.py. The anchors live in rules_anchors.py and were read from
the rendered page by eye, not produced by the extractor, so this catches parser bugs
rather than blessing them.
"""
import json
import sys
from pathlib import Path

from rules_anchors import (
    EXPECTED_CATEGORY_CODES,
    EXPECTED_DISCIPLINES,
    EXPECTED_EVENT_GROUP_COUNT,
    EVENT_GROUP_ANCHORS,
    PLACING_ANCHORS,
    WIND_ANCHORS,
)

DATA = Path(__file__).resolve().parent.parent / "src" / "data"


def check_placing(placing: dict, errors: list[str]) -> None:
    tables = placing["tables"]
    for number, expected in PLACING_ANCHORS.items():
        if number not in tables:
            errors.append(f"table {number}: missing from extracted data")
            continue
        scores = tables[number]["scores"]
        for place, by_category in expected.items():
            for category, points in by_category.items():
                got = scores.get(category, {}).get(place)
                if got != points:
                    errors.append(
                        f"table {number}, {category} place {place}: expected {points}, got {got}"
                    )


def check_no_zero_scores(placing: dict, errors: list[str]) -> None:
    """An empty cell must be omitted, never stored as 0 — the two mean different things."""
    for number, table in placing["tables"].items():
        for category, by_place in table["scores"].items():
            zeros = [p for p, v in by_place.items() if v == 0]
            if zeros:
                errors.append(f"table {number}, {category}: zero-valued places {zeros}")


def check_monotonic(placing: dict, errors: list[str]) -> None:
    """Within a category, a worse place must never score more than a better one.

    A cheap structural check that catches row misalignment — exactly the failure mode
    the missing place label in Table 2.5 could cause.
    """
    for number, table in placing["tables"].items():
        for category, by_place in table["scores"].items():
            places = sorted(int(p) for p in by_place if p.isdigit())
            for better, worse in zip(places, places[1:]):
                if by_place[str(worse)] > by_place[str(better)]:
                    errors.append(
                        f"table {number}, {category}: place {worse} scores "
                        f"{by_place[str(worse)]}, more than place {better} "
                        f"({by_place[str(better)]})"
                    )


def check_categories(placing: dict, errors: list[str]) -> None:
    codes = [c["code"] for c in placing["categories"]]
    if codes != EXPECTED_CATEGORY_CODES:
        errors.append(f"categories: expected {EXPECTED_CATEGORY_CODES}, got {codes}")


def check_wind(placing: dict, errors: list[str]) -> None:
    by_speed = {str(int(e["windMs"])) if float(e["windMs"]).is_integer() else str(e["windMs"]): e["points"]
                for e in placing["wind"]}
    for speed, points in WIND_ANCHORS.items():
        key = str(int(float(speed)))
        got = by_speed.get(key)
        if got != points:
            errors.append(f"wind {speed} m/s: expected {points}, got {got}")


def check_event_groups(groups: dict, errors: list[str]) -> None:
    records = groups["groups"]
    if len(records) != EXPECTED_EVENT_GROUP_COUNT:
        errors.append(
            f"event groups: expected {EXPECTED_EVENT_GROUP_COUNT}, got {len(records)}"
        )
    by_label = {g["label"]: g for g in records}
    for label, expected in EVENT_GROUP_ANCHORS.items():
        got = by_label.get(label)
        if got is None:
            errors.append(f"event group {label!r}: missing")
            continue
        for field, value in expected.items():
            if got.get(field) != value:
                errors.append(f"event group {label!r}, {field}: expected {value}, got {got.get(field)}")

    unslugged = [g["label"] for g in records if not g.get("slug")]
    if unslugged:
        errors.append(f"event groups with no ranking API slug: {unslugged}")


def check_disciplines(groups: dict, errors: list[str]) -> None:
    by_label = {g["label"]: g for g in groups["groups"]}
    for group in groups["groups"]:
        names = group.get("disciplines")
        if not names:
            errors.append(f"event group {group['label']!r}: no disciplines harvested")
    for label, expected in EXPECTED_DISCIPLINES.items():
        got = by_label.get(label, {}).get("disciplines", [])
        for name in expected:
            if name not in got:
                errors.append(f"event group {label!r}: expected discipline {name!r}, got {got}")


def check_table_2_2_matches_engine_file(placing: dict, errors: list[str]) -> None:
    """placing_points.json (what the engine reads today) must equal Table 2.2."""
    path = DATA / "placing_points.json"
    if not path.exists():
        errors.append("placing_points.json: missing")
        return
    engine = json.loads(path.read_text(encoding="utf-8"))["final"]
    if engine != placing["tables"]["2.2"]["scores"]:
        errors.append("placing_points.json does not match Table 2.2")


def main() -> None:
    errors: list[str] = []
    placing = json.loads((DATA / "placing_tables.json").read_text(encoding="utf-8"))
    groups = json.loads((DATA / "event_groups.json").read_text(encoding="utf-8"))

    check_placing(placing, errors)
    check_no_zero_scores(placing, errors)
    check_monotonic(placing, errors)
    check_categories(placing, errors)
    check_wind(placing, errors)
    check_event_groups(groups, errors)
    check_disciplines(groups, errors)
    check_table_2_2_matches_engine_file(placing, errors)

    if errors:
        print(f"FAILED ({len(errors)} problems):")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    print(
        f"OK — {len(placing['tables'])} placing tables, "
        f"{len(groups['groups'])} event groups, "
        f"{len(placing['categories'])} categories, "
        f"{len(placing['wind'])} wind entries verified against by-eye anchors."
    )


if __name__ == "__main__":
    main()
