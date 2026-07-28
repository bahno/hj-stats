"""Parse the World Athletics Scoring Tables PDF into a mark -> points table per event group.

Every data page in the book carries a header naming its own columns, so nothing here
needs to know which pages hold which events: the parser reads the headers and picks out
the columns it was asked for. That is deliberate. The previous version hardcoded page
ranges for the high jump section, which would have silently produced garbage the next
time World Athletics repaginated the book.

Two layouts alternate page to page — "Points" is the first column on one and the last on
the next. Both are handled by looking at where "Points" sits in the header.

Scores run 1400 down to 1, and each cell is the mark that first reaches that score, so a
mark seen twice keeps its first (highest) sighting: that is the score World Athletics
awards it. The book's own rule for anything in between is "the lower score shall be
considered", which the app applies at lookup time.

Writes src/data/scoring_tables.json, keyed by the event-group slugs of
src/data/event_groups.json so the app can look a table up by EventGroup.
"""
import io
import json
import sys
from datetime import date
from pathlib import Path

import pdfplumber
import requests

PDF_URL = (
    "https://worldathletics.org/download/download"
    "?filename=4f77dcb3-2945-4c58-ad8b-955a999b13e8.pdf"
    "&urlslug=World+Athletics+Scoring+Tables+of+Athletics"
)
EDITION = "World Athletics Scoring Tables of Athletics, 2025 Revised Edition"
DATA = Path(__file__).resolve().parent.parent / "src" / "data"
OUT = DATA / "scoring_tables.json"
# The high-jump-only file the app still reads. Written from the same extraction so the two
# cannot drift; delete it, and this half of main(), once the app reads scoring_tables.json.
LEGACY_OUT = DATA / "scoring_table.json"

# The header cell for each event group's main event, as the PDF writes it. Only the 18
# Track & Field groups per gender are extracted; the book's other ~60 events per gender
# (relays, road running, race walking, combined) have no event group in the app.
#
# A group also covers similar events — the 100m group counts a 60m result — but those
# score off their own column, and the app never scores a real result itself: World
# Athletics hands it the mark points. These tables serve the simulator, which asks
# "what would a mark in this event be worth", so the main event is the column it needs.
TRACK_AND_FIELD = {
    "100m": "100m",
    "200m": "200m",
    "400m": "400m",
    "800m": "800m",
    "1500m": "1500m",
    "5000m": "5000m",
    "10000m": "10000m",
    "400mh": "400mH",
    "3000msc": "3000m SC",
    "high-jump": "HJ",
    "pole-vault": "PV",
    "long-jump": "LJ",
    "triple-jump": "TJ",
    "shot-put": "SP",
    "discus-throw": "DT",
    "hammer-throw": "HT",
    "javelin-throw": "JT",
}
# The one group whose distance differs by gender.
COLUMN_BY_SLUG = {
    "men": {**TRACK_AND_FIELD, "110mh": "110mH"},
    "women": {**TRACK_AND_FIELD, "100mh": "100mH"},
}

RUNNING_HEAD = "WORLD ATHLETICS SCORING TABLES"

# Header cells are one token apart from a handful the PDF writes with a space inside:
# "200m sh", "3000m SC", "2 Miles". Text extraction cannot tell a cell boundary from a
# space inside a cell, so these tokens are glued onto the cell to their left. Every data
# row is then checked against the resulting column count, which catches a cell this misses.
GLUE_TOKENS = {"sh", "SC", "Miles"}

# A cell holding no mark for that score.
EMPTY = "-"


def download() -> bytes:
    resp = requests.get(PDF_URL, headers={"User-Agent": "hj-stats-pipeline"}, timeout=120)
    resp.raise_for_status()
    return resp.content


def body_lines(text: str) -> list[str]:
    return [
        line.strip()
        for line in text.split("\n")
        if line.strip() and not line.strip().startswith(RUNNING_HEAD)
    ]


def header_columns(header: str) -> tuple[list[str], bool]:
    """A header line's column names, and whether "Points" is the last column."""
    tokens = header.split()
    points_last = tokens[-1] == "Points"
    tokens = tokens[:-1] if points_last else tokens[1:]
    columns: list[str] = []
    for token in tokens:
        if token in GLUE_TOKENS and columns:
            columns[-1] = f"{columns[-1]} {token}"
        else:
            columns.append(token)
    return columns, points_last


def gender_of(title: str) -> str | None:
    # "Women" contains "men", so it has to be tested first.
    if "Women" in title:
        return "women"
    if "Men" in title:
        return "men"
    return None


def read_page(text: str, wanted: dict[str, str], out: dict[str, dict[str, int]]) -> int:
    """Read one data page into `out`. Returns the number of data rows read."""
    lines = body_lines(text)
    header = next((line for line in lines if "Points" in line), None)
    if header is None:
        return 0
    columns, points_last = header_columns(header)
    targets = {
        index: slug
        for slug, label in wanted.items()
        for index, name in enumerate(columns)
        if name == label
    }
    if not targets:
        return 0

    width = len(columns) + 1
    rows = 0
    for line in lines:
        # A data row starts with the score, or — on a Points-last page — with the first
        # column's mark, which is a dash wherever that event has no mark for the score.
        if not (line[0].isdigit() or line[0] == EMPTY):
            continue
        cells = line.split()
        if len(cells) != width:
            continue
        score_text = cells[-1] if points_last else cells[0]
        marks = cells[:-1] if points_last else cells[1:]
        if not score_text.isdigit():
            continue
        score = int(score_text)
        rows += 1
        for index, slug in targets.items():
            mark = marks[index]
            if mark != EMPTY:
                out.setdefault(slug, {}).setdefault(mark, score)
    return rows


def extract(pdf_bytes: bytes) -> dict[str, dict[str, dict[str, int]]]:
    out: dict[str, dict[str, dict[str, int]]] = {"men": {}, "women": {}}
    gender: str | None = None
    pages_read = 0
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            lines = body_lines(text)
            if not lines:
                continue
            if not any("Points" in line for line in lines):
                # A divider page, e.g. "Men's Jumps, Throws and Combined Events". The
                # length guard keeps the prose of the introduction from matching.
                for line in lines:
                    found = gender_of(line)
                    if found and len(line) < 80:
                        gender = found
                        break
                continue
            if gender is None:
                continue
            if read_page(text, COLUMN_BY_SLUG[gender], out[gender]):
                pages_read += 1
    print(f"Read {pages_read} data pages.")
    return out


def main() -> None:
    cached = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if cached is not None and cached.exists():
        print(f"Using cached PDF at {cached}")
        pdf_bytes = cached.read_bytes()
    else:
        print("Downloading scoring tables PDF…")
        pdf_bytes = download()
        print(f"Downloaded {len(pdf_bytes):,} bytes.")

    tables = extract(pdf_bytes)

    events: dict[str, dict[str, dict]] = {}
    missing: list[str] = []
    for gender, wanted in COLUMN_BY_SLUG.items():
        events[gender] = {}
        for slug, column in wanted.items():
            marks = tables[gender].get(slug)
            if not marks:
                missing.append(f"{gender} {slug} ({column})")
                continue
            events[gender][slug] = {"column": column, "marks": marks}

    if missing:
        print("FAILED — no marks extracted for: " + ", ".join(missing))
        sys.exit(1)

    OUT.write_text(
        json.dumps(
            {
                "source": EDITION,
                "url": PDF_URL,
                "retrieved": date.today().isoformat(),
                "events": events,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    groups = sum(len(g) for g in events.values())
    marks = sum(len(e["marks"]) for g in events.values() for e in g.values())
    print(f"Wrote {OUT}: {groups} event groups, {marks:,} marks, {OUT.stat().st_size:,} bytes")

    LEGACY_OUT.write_text(
        json.dumps(
            {
                "event": "high_jump",
                "unit": "m",
                "source": "World Athletics Scoring Tables 2025",
                "points_by_mark": {
                    gender: events[gender]["high-jump"]["marks"] for gender in ("men", "women")
                },
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {LEGACY_OUT} (high jump only, for the app as it stands today)")


if __name__ == "__main__":
    main()
