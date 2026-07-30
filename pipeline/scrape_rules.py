"""Extract every table from the World Athletics Track & Field ranking rules page.

This supersedes scrape_placing.py, which pulled only Table 2.2 (the Track & Field
final placing scores) and was pinned to the 2025 edition. Track & Field is not one
placing table: three different *final* tables apply depending on the event group,
each with its own round-before-final companions.

Ground truth: https://worldathletics.org/world-ranking-rules/track-field-events-<year>

DOM notes (confirmed 2026-07-27):
- Header cells are <td> inside <thead>, not <th> — select on both.
- Tables are identified by the "Table 2.N." caption in the nearest preceding
  heading/paragraph. This is far more robust than the old column-shape heuristic,
  which could not tell 2.2 from 2.5 or 2.9 (identical column sets).
- Some captions contain a byte that does not decode cleanly; captions are
  normalised before use and are not load-bearing beyond the table number.

Place-label quirks this parser must handle, all present on the live 2026 page:
- "Q or q to Final" — the athlete advanced; stored under the key "Q".
- Trailing "*" footnote markers ("9th *").
- Ranges: Table 2.6 has a "10-13th" row that expands to places 10, 11, 12, 13.
- A MISSING label: Table 2.5's second row has an empty place cell. It is inferred
  from sequence (previous place + 1) and the inference is asserted against the
  anchors in rules_anchors.py, so a silent mis-alignment cannot pass.

Empty cells mean "no score at this place for this category" and are omitted rather
than stored as zero — placingScore() already treats a missing entry as no points,
and storing 0 would hide the difference between "scores nothing" and "not ranked".
"""
import json
import re
from datetime import date
from pathlib import Path

import requests
from bs4 import BeautifulSoup

RANKING_YEAR = 2026
URL = f"https://worldathletics.org/world-ranking-rules/track-field-events-{RANKING_YEAR}"

# A browser-like UA. The WA and EA hosts sit behind Cloudflare and answer 403 to
# default client agents.
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

DATA = Path(__file__).resolve().parent.parent / "src" / "data"

PLACING_TABLE_NUMBERS = ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10"]

# Which placing table applies to which event group, and to which round.
#
# EXTRACTED from the table captions: 2.5-2.8 name "5000m and 3000mSC", 2.9 names
# "10,000m", 2.10 names "10km Road Race", 2.2-2.4 are the general Track & Field
# tables. 10km Road Race is a *similar event* inside the 10,000m group, so the
# table depends on the discipline of the individual result, not only on the group.
#
# INFERRED, not stated on the page: that the 10,000m group falls back to the
# general 2.3/2.4 for a round before the final. The rules publish no 10,000m-
# specific round table; 10,000m is rarely run in rounds, so this path is close to
# unreachable in practice. Flagged here rather than hidden.
EVENT_GROUP_TABLES = {
    "5000m": {"final": "2.5", "beforeFinal": {"OW": "2.6", "max9": "2.7", "min10": "2.8"}},
    "3000msc": {"final": "2.5", "beforeFinal": {"OW": "2.6", "max9": "2.7", "min10": "2.8"}},
    "10000m": {
        "final": "2.9",
        "beforeFinal": {"max9": "2.3", "min10": "2.4"},
        # Keyed by the long discipline name the result feeds emit, not Table
        # 2.12's short label "10km Road Race", which nothing matches on.
        "byDiscipline": {"10 Kilometres Road": {"final": "2.10"}},
    },
    "default": {"final": "2.2", "beforeFinal": {"max9": "2.3", "min10": "2.4"}},
}

# Event-group slug for the European Athletics ranking API, keyed by the main event
# as Table 2.12 spells it. Verified live against getRanking on 2026-07-27.
SLUG_BY_MAIN_EVENT = {
    "100m": "100m", "200m": "200m", "400m": "400m", "800m": "800m",
    "1500m": "1500m", "5000m": "5000m", "10,000m": "10000m",
    "110mH": "110mh", "100mH": "100mh", "400mH": "400mh", "3000mSC": "3000msc",
    "High Jump": "high-jump", "Pole Vault": "pole-vault",
    "Long Jump": "long-jump", "Triple Jump": "triple-jump",
    "Shot Put": "shot-put", "Discus Throw": "discus-throw",
    "Hammer Throw": "hammer-throw", "Javelin Throw": "javelin-throw",
}


def fetch(url: str = URL) -> BeautifulSoup:
    resp = requests.get(url, headers={"User-Agent": UA}, timeout=60)
    resp.raise_for_status()
    resp.encoding = "utf-8"
    return BeautifulSoup(resp.text, "html.parser")


def _caption(table) -> str:
    prev = table.find_previous(["h1", "h2", "h3", "h4", "p", "strong"])
    text = prev.get_text(" ", strip=True) if prev else ""
    # Collapse whitespace and drop any byte that failed to decode.
    return " ".join(text.replace("�", "-").split())


def _rows(table) -> list[list[str]]:
    return [
        [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
        for tr in table.find_all("tr")
    ]


def collect_tables(soup: BeautifulSoup) -> dict[str, tuple[str, list[list[str]]]]:
    """Every "Table 2.N." on the page, keyed by its number."""
    found: dict[str, tuple[str, list[list[str]]]] = {}
    for table in soup.find_all("table"):
        cap = _caption(table)
        m = re.match(r"Table\s+(\d+\.\d+)\.", cap)
        if not m:
            continue
        number = m.group(1)
        if number in found:
            raise ValueError(f"Table {number} appears more than once on the page")
        found[number] = (cap, _rows(table))
    return found


def parse_place_label(label: str, previous: int | None) -> list[str]:
    """Place keys for one row label. Returns [] for a label carrying no place.

    "Q or q to Final" -> ["Q"];  "9th *" -> ["9"];  "10-13th *" -> ["10","11","12","13"];
    "" -> the next place after `previous` (Table 2.5's missing 2nd-place label).
    """
    cleaned = label.replace("*", "").strip()
    if not cleaned:
        if previous is None:
            raise ValueError("empty place label with no preceding place to infer from")
        return [str(previous + 1)]
    if cleaned.lower().startswith("q"):
        return ["Q"]
    span = re.match(r"^(\d+)\s*[-–]\s*(\d+)(?:st|nd|rd|th)?$", cleaned)
    if span:
        lo, hi = int(span.group(1)), int(span.group(2))
        if hi < lo:
            raise ValueError(f"descending place range {cleaned!r}")
        return [str(p) for p in range(lo, hi + 1)]
    single = re.match(r"^(\d+)(?:st|nd|rd|th)?$", cleaned)
    if single:
        return [single.group(1)]
    raise ValueError(f"unrecognised place label {label!r}")


def parse_placing_table(rows: list[list[str]]) -> dict[str, dict[str, int]]:
    """{category -> {place key -> points}} from a placing table's rows."""
    header = rows[0]
    categories = [c.strip() for c in header[1:] if c.strip()]
    scores: dict[str, dict[str, int]] = {c: {} for c in categories}

    previous: int | None = None
    for row in rows[1:]:
        if not row or all(not c.strip() for c in row):
            continue
        keys = parse_place_label(row[0], previous)
        for key in keys:
            if key.isdigit():
                previous = int(key)
        for category, cell in zip(categories, row[1:]):
            value = cell.replace("*", "").strip()
            if not value:
                continue  # no score at this place for this category
            for key in keys:
                scores[category][key] = int(value)
    return scores


def parse_event_groups(rows: list[list[str]]) -> list[dict]:
    """Table 2.12 -> one record per event group, with the EA ranking API slug."""
    groups = []
    for row in rows[1:]:
        if len(row) < 3 or not row[1].strip():
            continue
        label = row[1].strip()
        main = row[2].strip()
        similar = [s.strip() for s in row[3].split(",")] if len(row) > 3 and row[3].strip() else []
        gender = "men" if label.lower().startswith("men") else "women"
        groups.append({
            "label": label,
            "gender": gender,
            "mainEvent": main,
            "similarEvents": similar,
            # None flags a main event this script does not yet know a slug for,
            # rather than silently emitting a slug that would 400 at the API.
            "slug": SLUG_BY_MAIN_EVENT.get(main),
        })
    return groups


def parse_categories(rows: list[list[str]]) -> list[dict]:
    """Table 2.11 -> the official category code + description."""
    out = []
    for row in rows[1:]:
        if len(row) < 2 or not row[0].strip():
            continue
        out.append({"code": row[0].strip(), "details": row[1].strip()})
    return out


def parse_wind(rows: list[list[str]]) -> list[dict]:
    """Table 2.1 -> [{windMs, points}], tail and head wind merged into one list."""
    out = []
    for row in rows[1:]:
        if len(row) < 4:
            continue
        for speed_cell, points_cell in ((row[0], row[1]), (row[2], row[3])):
            speed = speed_cell.replace("m/s", "").strip()
            points = points_cell.replace("pts", "").strip()
            if not speed or not points:
                continue
            # "-0" and "+0" both mean zero; float() then int() normalises the sign.
            entry = {"windMs": float(speed), "points": int(float(points))}
            if entry not in out:
                out.append(entry)
    out.sort(key=lambda e: e["windMs"])
    return out


def build(soup: BeautifulSoup) -> tuple[dict, dict]:
    tables = collect_tables(soup)
    missing = [n for n in PLACING_TABLE_NUMBERS if n not in tables]
    if missing:
        raise ValueError(f"placing tables missing from the page: {missing}")
    for required in ("2.11", "2.12"):
        if required not in tables:
            raise ValueError(f"Table {required} missing from the page")

    placing = {
        "source": URL,
        "year": RANKING_YEAR,
        "retrieved": date.today().isoformat(),
        "tables": {
            number: {
                "title": tables[number][0],
                "scores": parse_placing_table(tables[number][1]),
            }
            for number in PLACING_TABLE_NUMBERS
        },
        "eventGroupTables": EVENT_GROUP_TABLES,
        "categories": parse_categories(tables["2.11"][1]),
        "wind": parse_wind(tables["2.1"][1]) if "2.1" in tables else [],
    }

    groups = {
        "source": URL,
        "year": RANKING_YEAR,
        "retrieved": date.today().isoformat(),
        "groups": parse_event_groups(tables["2.12"][1]),
    }
    return placing, groups


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    print(f"Fetching {URL} …")
    placing, groups = build(fetch())

    write_json(DATA / "placing_tables.json", placing)
    write_json(DATA / "event_groups.json", groups)

    # Keep the single-table file the app already reads in sync, so nothing breaks
    # while the engine is still being generalised. It is exactly Table 2.2.
    write_json(DATA / "placing_points.json", {
        "source": f"World Athletics World Ranking {RANKING_YEAR} — Table 2.2, "
                  "Placing Scores for Track & Field Events in the Final",
        "final": placing["tables"]["2.2"]["scores"],
    })

    counts = {n: sum(len(v) for v in t["scores"].values()) for n, t in placing["tables"].items()}
    print(f"Wrote placing_tables.json: {len(placing['tables'])} tables, entries {counts}")
    print(f"Wrote event_groups.json: {len(groups['groups'])} groups")
    print("Wrote placing_points.json (Table 2.2, for the existing engine)")


if __name__ == "__main__":
    main()
