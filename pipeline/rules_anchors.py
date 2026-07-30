"""Authoritative anchor values for the World Athletics Track & Field ranking rules.

Read BY EYE from the rendered rules page, independently of the extraction code in
scrape_rules.py, so that a parser bug cannot silently redefine what "correct" means.

Source: https://worldathletics.org/world-ranking-rules/track-field-events-2026
Read on 2026-07-27.

Do NOT edit these to force a pass. If the extractor disagrees, either the extractor
is wrong or World Athletics changed the rules — check the page before touching this
file, and if the rules did change, re-read the new values by eye.

NOTE on the ranking year: these tables are versioned per year and the values move a
lot between editions (2025 Table 2.2 gave 375 for an OW win; 2026 gives 260). Anchors
here are for RANKING_YEAR in scrape_rules.py. Bumping the year means re-reading every
value below.
"""

# --- Table 2.2: Track & Field, Final -----------------------------------------
# Columns: OW DF GW GL A B C D E F
T2_2 = {
    "1": {"OW": 260, "DF": 170, "GW": 140, "GL": 120, "A": 100, "B": 70, "C": 42, "D": 28, "E": 18, "F": 11},
    "9": {"OW": 91, "DF": 63, "GW": 49, "GL": 42, "A": 35, "B": 24, "C": 14},
    "16": {"OW": 57},
}

# --- Table 2.3: round before the Final, when the Final has max. 9 athletes ----
# Columns: OW DF GW GL. "Q" is the "Q or q to Final" row (the athlete advanced).
T2_3 = {
    "Q": {"OW": 100, "DF": 70, "GW": 60, "GL": 50},
    "9": {"OW": 91, "DF": 63, "GW": 49, "GL": 42},
    "16": {"OW": 50},
}

# --- Table 2.4: round before the Final, when the Final has 10 or more --------
# This is the table the existing high-jump code hardcodes as QUAL_TO_FINAL_PLACING.
T2_4 = {
    "Q": {"OW": 70, "DF": 46, "GW": 35, "GL": 28},
    "11": {"OW": 66, "DF": 39, "GW": 28, "GL": 25},
    "16": {"OW": 50},
}

# --- Table 2.5: 5000m and 3000mSC, Final -------------------------------------
# The 2nd-place row on the live page has an EMPTY place label; its values are the
# ones below and the extractor is expected to infer the label from sequence.
T2_5 = {
    "1": {"OW": 215, "DF": 130, "GW": 115, "GL": 95, "A": 70, "B": 50, "C": 35, "D": 25, "E": 14, "F": 8},
    "2": {"OW": 190, "DF": 115, "GW": 95, "GL": 85, "A": 63, "B": 42, "C": 28, "D": 19, "E": 11, "F": 5},
    "16": {"OW": 43},
}

# --- Table 2.6: 5000m and 3000mSC, round before Final, OW only ---------------
# The "10-13th" row is a RANGE and must expand to places 10, 11, 12 and 13.
T2_6 = {
    "Q": {"OW": 56},
    "10": {"OW": 52},
    "13": {"OW": 52},
    "14": {"OW": 49},
    "16": {"OW": 43},
}

# --- Table 2.7: 5000m/3000mSC, round before Final, Final of max. 9 -----------
T2_7 = {
    "Q": {"DF": 60, "GW": 42, "GL": 35},
    "12": {"DF": 35, "GW": 25, "GL": 21},
}

# --- Table 2.8: 5000m/3000mSC, round before Final, Final of 10 or more ------
T2_8 = {
    "Q": {"DF": 35, "GW": 25, "GL": 21},
    "12": {"DF": 28, "GW": 18, "GL": 14},
}

# --- Table 2.9: 10,000m ------------------------------------------------------
T2_9 = {
    "1": {"OW": 200, "DF": 125, "GW": 100, "GL": 80, "A": 56, "B": 42, "C": 32, "D": 21, "E": 14, "F": 7},
    "16": {"OW": 32},
}

# --- Table 2.10: 10km Road Race ---------------------------------------------
# Counts inside the 10,000m event group as a "similar event".
T2_10 = {
    "1": {"OW": 70, "DF": 50, "GW": 42, "GL": 32, "A": 21, "B": 14, "C": 7},
    "3": {"OW": 53, "DF": 35, "GW": 31, "GL": 22, "A": 13, "B": 7, "C": 2},
    "12": {"OW": 15},
}

PLACING_ANCHORS = {
    "2.2": T2_2, "2.3": T2_3, "2.4": T2_4, "2.5": T2_5, "2.6": T2_6,
    "2.7": T2_7, "2.8": T2_8, "2.9": T2_9, "2.10": T2_10,
}

# --- Table 2.12: event groups ------------------------------------------------
# 36 groups: 18 per gender. Spot-checked entries, keyed by the group's own label.
EXPECTED_EVENT_GROUP_COUNT = 36

EVENT_GROUP_ANCHORS = {
    "Men's 100m": {"mainEvent": "100m", "similarEvents": ["50m", "55m", "60m"]},
    "Men's 1500m": {
        "mainEvent": "1500m",
        "similarEvents": ["1500m sh", "Mile", "Mile sh", "2000m", "2000m sh", "Mile Road Race"],
    },
    "Men's 10,000m": {"mainEvent": "10,000m", "similarEvents": ["10km Road Race"]},
    "Women's High Jump": {"mainEvent": "High Jump", "similarEvents": []},
    "Women's Javelin Throw": {"mainEvent": "Javelin Throw", "similarEvents": []},
}

# Long discipline names, as the World Athletics result feeds spell them. Verified
# live on 2026-07-27 from real ranking calculations. A group must at minimum
# recognise its own main event, or every result for it gets silently dropped.
EXPECTED_DISCIPLINES = {
    "Men's High Jump": ["High Jump"],
    "Women's High Jump": ["High Jump"],
    "Men's 800m": ["800 Metres"],
    "Men's 1500m": ["1500 Metres", "1500 Metres Short Track"],
}

# --- Table 2.11: competition categories -------------------------------------
EXPECTED_CATEGORY_CODES = ["OW", "DF", "GW", "GL", "A", "B", "C", "D", "E", "F"]

# --- Table 2.1: wind modification -------------------------------------------
# Tail wind costs points, head wind awards them. Note the published table gives
# -0 pts for both +1 and +2 m/s tail wind.
WIND_ANCHORS = {"+4": -24, "+2": 0, "+1": 0, "0": 0, "-1": 6, "-4": 24}
