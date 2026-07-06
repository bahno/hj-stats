"""Scrape World Athletics placing points (T&F final) into src/data/placing_points.json.

DOM notes (confirmed 2025):
- Table uses <thead> with <td> elements (not <th>) for column headers.
- Table 2.2 ("Placing Scores for Track & Field Events in the Final") is identified
  by its preceding heading text and by its thead containing the category codes.
- High jump is a standard T&F field event governed by Table 2.2.
"""
import json
import re
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup

URL = "https://worldathletics.org/world-ranking-rules/track-field-events-2025"
CATEGORIES = ["OW", "DF", "GW", "GL", "A", "B", "C", "D", "E", "F"]
OUT = Path(__file__).resolve().parent.parent / "src" / "data" / "placing_points.json"


def fetch() -> BeautifulSoup:
    resp = requests.get(URL, headers={"User-Agent": "hj-stats-pipeline"}, timeout=30)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "html.parser")


def find_final_table(soup: BeautifulSoup):
    """Return the T&F final placing table (Table 2.2).

    The page uses <td> elements (not <th>) inside <thead> for column headers.
    We collect ALL tables whose <thead> contains all category codes, then
    prefer the one whose nearest preceding heading/paragraph references
    "Final" (and ideally "Track" or "2.2"). If more than one candidate
    still matches after that filter, we raise rather than silently guess.
    """
    REQUIRED_CATS = ("OW", "DF", "GW", "GL", "A")

    # Step 1: collect every table that has all required category codes in its thead.
    candidates = []
    for table in soup.find_all("table"):
        thead = table.find("thead")
        if not thead:
            continue
        header_cells = [td.get_text(strip=True) for td in thead.find_all("td")]
        if all(cat in header_cells for cat in REQUIRED_CATS):
            candidates.append(table)

    if not candidates:
        raise SystemExit("Could not locate the placing table by category headers in <thead>")

    if len(candidates) == 1:
        return candidates[0]

    # Step 2: narrow by preceding heading text — prefer tables whose nearest
    # heading/paragraph contains "Final" and ("Track" or "2.2").
    def heading_score(table) -> int:
        prev = table.find_previous(["h1", "h2", "h3", "h4", "h5", "h6", "p"])
        if prev is None:
            return 0
        text = prev.get_text(strip=True)
        score = 0
        if re.search(r"final", text, re.IGNORECASE):
            score += 2
        if re.search(r"track|2\.2", text, re.IGNORECASE):
            score += 1
        return score

    max_score = max(heading_score(t) for t in candidates)
    best = [t for t in candidates if heading_score(t) == max_score]

    if len(best) == 1:
        return best[0]

    raise SystemExit(
        f"Ambiguous placing table: {len(best)} candidates matched after heading filter "
        f"(total candidates before filter: {len(candidates)}). "
        "Cannot unambiguously select Table 2.2 — inspect the page structure."
    )


def parse(table) -> dict:
    thead = table.find("thead")
    headers = [td.get_text(strip=True) for td in thead.find_all("td")]
    col = {cat: headers.index(cat) for cat in CATEGORIES if cat in headers}
    missing = [c for c in CATEGORIES if c not in col]
    if missing:
        raise SystemExit(f"Missing category columns in placing table: {missing}")
    final = {cat: {} for cat in CATEGORIES}
    for row in table.find("tbody").find_all("tr"):
        cells = [td.get_text(strip=True) for td in row.find_all(["td", "th"])]
        if not cells:
            continue
        # Position cell: "1st", "2nd", ... — extract leading integer
        m = re.match(r"(\d+)", cells[0])
        if not m:
            continue
        position = m.group(1)
        for cat, idx in col.items():
            if idx >= len(cells):
                continue
            val = cells[idx].replace(",", "").strip()
            if val.isdigit():
                final[cat][position] = int(val)
    return final


def main():
    print(f"Fetching {URL} ...")
    soup = fetch()
    print("Locating T&F final placing table ...")
    table = find_final_table(soup)
    # Verify by checking the preceding heading
    prev = table.find_previous(["h1", "h2", "h3", "h4", "h5", "h6", "p"])
    heading = prev.get_text(strip=True)[:120] if prev else "(no heading found)"
    print(f"Found table: {heading}")
    final = parse(table)
    OUT.write_text(
        json.dumps(
            {
                "source": "World Athletics World Ranking Rules 2025 — Track & Field (Table 2.2, final)",
                "final": final,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"Wrote {OUT}")
    # Print 1st-place values for quick verification
    print("1st-place values:")
    for cat in CATEGORIES:
        pts = final[cat].get("1", "—")
        print(f"  {cat}: {pts}")


if __name__ == "__main__":
    main()
