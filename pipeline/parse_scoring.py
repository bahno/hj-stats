"""Parse the World Athletics Scoring Tables PDF for men's & women's high jump."""
import io
import json
import re
from pathlib import Path

import pdfplumber
import requests

PDF_URL = (
    "https://worldathletics.org/download/download"
    "?filename=4f77dcb3-2945-4c58-ad8b-955a999b13e8.pdf"
    "&urlslug=World+Athletics+Scoring+Tables+of+Athletics"
)
OUT = Path(__file__).resolve().parent.parent / "src" / "data" / "scoring_table.json"

# PDF page ranges (0-indexed) for the jumps/throws/combined sections.
# Table of contents (doc page 3) shows:
#   Men's Jumps, Throws and Combined Events  -> doc page 397
#   Women's Jumps, Throws and Combined Events -> doc page 817
# The section header is one page, data follows immediately.
MEN_PAGES = range(397, 426)    # 0-indexed; 29 data pages
WOMEN_PAGES = range(817, 846)  # 0-indexed; 29 data pages


def download() -> bytes:
    resp = requests.get(PDF_URL, headers={"User-Agent": "hj-stats-pipeline"}, timeout=60)
    resp.raise_for_status()
    return resp.content


def _parse_section(pages) -> dict[str, int]:
    """Extract {mark -> points} for high jump from one section's pages.

    Each page uses one of two alternating column layouts:
      Layout A:  Points  HJ  PV  LJ  TJ  SP  DT  HT  JT  ...
      Layout B:  HJ  PV  LJ  TJ  SP  DT  HT  JT  ...  Points

    HJ is always the first field after Points (or the very first field when
    Points appears at the end). A '-' means no mark is listed for that score.
    """
    result: dict[str, int] = {}
    hj_mark_re = re.compile(r"^\d+\.\d+$")

    for page in pages:
        txt = page.extract_text() or ""
        lines = txt.split("\n")

        # Detect layout from the header line that contains both HJ and PV/LJ.
        points_at_end = False
        for line in lines:
            stripped = line.strip()
            if "HJ" in stripped and ("PV" in stripped or "LJ" in stripped):
                parts = stripped.split()
                points_at_end = parts[-1] == "Points"
                break

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            # Skip header / title lines — any line starting with a letter is
            # a header, footer, or title.  Real data rows start with a digit
            # (either the points value or the HJ mark).
            if re.match(r"^[A-Za-z]", stripped):
                continue
            parts = stripped.split()
            if len(parts) < 2:
                continue
            try:
                if points_at_end:
                    points = int(parts[-1])
                    hj_val = parts[0]
                else:
                    points = int(parts[0])
                    hj_val = parts[1]
            except (ValueError, IndexError):
                continue
            if hj_val != "-" and hj_mark_re.match(hj_val):
                result[hj_val] = points

    return result


def extract(pdf_bytes: bytes) -> dict:
    """Extract {mark -> points} for men's and women's high jump."""
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        men = _parse_section([pdf.pages[i] for i in MEN_PAGES])
        women = _parse_section([pdf.pages[i] for i in WOMEN_PAGES])
    return {"men": men, "women": women}


def main() -> None:
    print("Downloading scoring tables PDF…")
    pdf_bytes = download()
    print(f"Downloaded {len(pdf_bytes):,} bytes. Extracting high jump data…")
    points_by_mark = extract(pdf_bytes)
    OUT.write_text(
        json.dumps(
            {
                "event": "high_jump",
                "unit": "m",
                "source": "World Athletics Scoring Tables 2025",
                "points_by_mark": points_by_mark,
            },
            indent=2,
        )
        + "\n"
    )
    print(
        f"Wrote {OUT}: "
        f"men={len(points_by_mark['men'])} "
        f"women={len(points_by_mark['women'])} marks"
    )


if __name__ == "__main__":
    main()
