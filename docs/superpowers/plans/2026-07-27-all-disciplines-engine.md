# All-Disciplines Scoring Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ranking engine score any World Athletics Track & Field event group, not just high jump, verified against World Athletics' own ranking calculations.

**Architecture:** A single `EventGroup` descriptor becomes the only place that knows anything discipline-specific — which disciplines belong to the group, how many results are averaged, how long the ranking window is, how marks are written, and which placing tables apply. Every engine function takes that descriptor as a parameter instead of importing high-jump constants. Correctness is proved by replaying World Athletics' own `getRankingScoreCalculation` payloads: given an athlete's full result list, our reconstruction of the counting set must match theirs.

**Tech Stack:** TypeScript (strict), React 18, Vite, Vitest, Python 3.10 for the data pipeline (requests + BeautifulSoup, already in `pipeline/requirements.txt`).

## Global Constraints

- **Scope is Track & Field only.** Road running, race walking, combined events and cross country are explicitly out of scope for this plan. Do not add their placing tables or event groups.
- **Ground truth is the 2026 rules edition:** `https://worldathletics.org/world-ranking-rules/track-field-events-2026`, already extracted to `src/data/placing_tables.json` and `src/data/event_groups.json`. Do not re-derive these values by hand.
- **The app must keep working after every task.** `src/data/placing_points.json` (Table 2.2) stays in place and `src/engine/score.ts`'s existing signatures keep working until the UI plan migrates them.
- **No new runtime dependencies.** No new npm packages. Pipeline scripts may use what is already in `pipeline/requirements.txt`.
- **No network access in unit tests.** Anything needing live API data is captured as a committed fixture by a separate, manually-run script.
- **Tests run with `npm test`** (Vitest, `vitest run`). Test files sit next to their subject as `<name>.test.ts`.
- **Commit after every task.** Never skip hooks.

---

## File Structure

**Created:**

- `pipeline/harvest_disciplines.py` — one-off harvester that discovers the long discipline names the result feeds actually use, per event group, and writes them into `event_groups.json`.
- `src/data/events.ts` — the `EventGroup` type and registry, built from `event_groups.json`.
- `src/engine/mark.ts` — parse, format and compare marks across heights, distances, times and points.
- `src/engine/rounds.ts` — classify a result's round (`final`, `beforeFinal`, `other`) from the competition's own result set.
- `src/engine/placing.ts` — resolve placing points from the full 2026 table set, given event group, discipline, category, round and place.
- `src/engine/window.ts` — ranking-window bounds, including the Area Championships exception.
- `scripts/capture-oracle-fixtures.mjs` — manually-run script that captures live World Athletics payloads as test fixtures.
- `src/engine/__fixtures__/oracle/*.json` — captured payloads (committed).
- `src/engine/oracle.test.ts` — replays the fixtures and asserts our counting-set reconstruction matches World Athletics'.

**Modified:**

- `src/data/event_groups.json` — gains a `disciplines` array per group.
- `src/data/types.ts` — widen the high-jump-only `ScoringTable['event']`.
- `src/engine/counting.ts` — every discipline-specific decision moves onto the `EventGroup` parameter.
- `src/engine/counting.test.ts` — updated for the new signatures.
- `src/data/rankingApi.ts` — `fetchRanking(slug, gender)` replaces `fetchHighJumpRanking(gender)`.
- `src/data/athleteResultsApi.ts` — `fetchAthleteResults(id, years, disciplines)` replaces the high-jump filter.
- `src/data/birminghamApi.ts` — event IDs discovered at runtime instead of hardcoded.
- Call sites in `src/components/AthleteLookup.tsx` and the test files that mock these modules.

---

### Task 1: Harvest the discipline names each event group actually uses

WA rules Table 2.12 names similar events in *short* form (`1500m sh`), but both result
feeds spell them in *long* form (`1500 Metres Short Track`). Matching needs the long
names, and guessing them is how you silently drop half an athlete's results. So harvest
them from the source of truth: `getRankingScoreCalculation` returns a `disciplineList`
for every athlete, which is exactly the set of disciplines that counted for them.

**Files:**
- Create: `pipeline/harvest_disciplines.py`
- Modify: `src/data/event_groups.json` (regenerated with a `disciplines` field)

**Interfaces:**
- Consumes: `src/data/event_groups.json` as written by `pipeline/scrape_rules.py` (fields `label`, `gender`, `mainEvent`, `similarEvents`, `slug`).
- Produces: each group in `event_groups.json` gains `"disciplines": string[]` — long names, sorted, always including the main event's long name.

- [ ] **Step 1: Write the harvester**

Create `pipeline/harvest_disciplines.py`:

```python
"""Discover the long discipline names each event group's results actually carry.

Table 2.12 lists similar events in short form ("1500m sh"); the World Athletics
result feeds use long form ("1500 Metres Short Track"). Matching results to an
event group needs the long names, and they are not published as a mapping — so
read them off real ranking calculations, which is where they are authoritative.

For each event group this samples the top N ranked athletes, fetches each one's
ranking calculation, and unions the `disciplineList` plus every result's own
`discipline`. Athletes ranked near the top have full counting sets, so a small
sample surfaces the similar events quickly; rare ones need a deeper sample,
which is what --sample is for.

Run after scrape_rules.py. Network-bound and slow by design (it is rate limited);
this is a one-off run when World Athletics changes the event group definitions.
"""
import argparse
import json
import time
from pathlib import Path
from urllib.parse import quote

import requests

EA_TRPC = "https://api.european-athletics.com/trpc"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
DATA = Path(__file__).resolve().parent.parent / "src" / "data"
GROUPS = DATA / "event_groups.json"

# Politeness delay between calls. The gateway is undocumented and Cloudflare
# fronted; hammering it is both rude and a good way to get blocked.
DELAY_S = 0.35


def trpc(proc: str, payload: dict) -> dict:
    url = f"{EA_TRPC}/{proc}?input={quote(json.dumps({'json': payload}))}"
    resp = requests.get(url, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=30)
    resp.raise_for_status()
    body = resp.json()
    if "error" in body:
        raise RuntimeError(f"{proc}: {body['error']}")
    return body["result"]["data"]["json"]


def disciplines_for(slug: str, gender: str, sample: int) -> set[str]:
    found: set[str] = set()
    ranking = trpc("worldAthletics.getRanking", {"eventGroup": slug, "gender": gender})
    time.sleep(DELAY_S)
    for row in ranking.get("rankings", [])[:sample]:
        calc_id = row.get("id")
        if calc_id is None:
            continue
        try:
            calc = trpc("worldAthletics.getRankingScoreCalculation", {"calculationId": calc_id})
        except Exception as exc:  # one athlete failing must not lose the whole group
            print(f"    ! calculation {calc_id} failed: {exc}")
            time.sleep(DELAY_S)
            continue
        for name in calc.get("disciplineList") or []:
            found.add(str(name).strip())
        for result in calc.get("results") or []:
            name = str(result.get("discipline", "")).strip()
            if name:
                found.add(name)
        time.sleep(DELAY_S)
    return found


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=int, default=25,
                        help="ranked athletes to sample per event group")
    args = parser.parse_args()

    payload = json.loads(GROUPS.read_text(encoding="utf-8"))
    for group in payload["groups"]:
        slug, gender, label = group.get("slug"), group["gender"], group["label"]
        if not slug:
            raise ValueError(f"{label}: no ranking API slug; fix SLUG_BY_MAIN_EVENT first")
        print(f"  {label} ({slug}/{gender}) …")
        names = disciplines_for(slug, gender, args.sample)
        if not names:
            raise ValueError(f"{label}: no disciplines found; the sample or the slug is wrong")
        group["disciplines"] = sorted(names)
        print(f"    {len(names)}: {sorted(names)}")

    GROUPS.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    total = sum(len(g["disciplines"]) for g in payload["groups"])
    print(f"Wrote {GROUPS}: {len(payload['groups'])} groups, {total} discipline names")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it**

Run: `cd pipeline && python harvest_disciplines.py --sample 25`

Expected: 36 groups printed, each with at least one discipline name. Groups with
similar events (100m, 400m, 800m, 1500m, 5000m, 10,000m, hurdles, 3000mSC) should show
more than one. Field events should show exactly one.

Takes several minutes — roughly 950 requests at the built-in delay.

- [ ] **Step 3: Sanity-check the harvest by eye**

Run: `python -c "import json;d=json.load(open('../src/data/event_groups.json',encoding='utf-8'));[print(g['label'],'->',g['disciplines']) for g in d['groups'][:8]]"`

Expected: `Men's 100m` includes `100 Metres` and short-track sprint names;
`Men's 1500m` includes both `1500 Metres` and `1500 Metres Short Track`;
`Men's High Jump` is exactly `['High Jump']`.

If a group has picked up an unrelated discipline, the sample caught an athlete whose
calculation spans event groups — note it, then raise `--sample` and re-run rather than
hand-editing the JSON.

- [ ] **Step 4: Extend the rules verifier to cover the new field**

In `pipeline/rules_anchors.py`, add below `EVENT_GROUP_ANCHORS`:

```python
# Long discipline names, as the World Athletics result feeds spell them. Verified
# live on 2026-07-27 from real ranking calculations. A group must at minimum
# recognise its own main event, or every result for it gets silently dropped.
EXPECTED_DISCIPLINES = {
    "Men's High Jump": ["High Jump"],
    "Women's High Jump": ["High Jump"],
    "Men's 800m": ["800 Metres"],
    "Men's 1500m": ["1500 Metres", "1500 Metres Short Track"],
}
```

In `pipeline/verify_rules.py`, add to the imports from `rules_anchors` and add this
check, calling it from `main()` alongside the others:

```python
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
```

- [ ] **Step 5: Run the verifier**

Run: `cd pipeline && python verify_rules.py`
Expected: `OK — 9 placing tables, 36 event groups, …` and exit code 0.

- [ ] **Step 6: Commit**

```bash
git add pipeline/harvest_disciplines.py pipeline/rules_anchors.py pipeline/verify_rules.py src/data/event_groups.json
git commit -m "feat(pipeline): harvest the long discipline names each event group uses"
```

---

### Task 2: The event registry

**Files:**
- Create: `src/data/events.ts`
- Create: `src/data/events.test.ts`
- Modify: `src/data/types.ts`

**Interfaces:**
- Consumes: `src/data/event_groups.json` with the `disciplines` field from Task 1.
- Produces:
  - `interface EventGroup { slug: string; label: string; gender: Gender; mainEvent: string; similarEvents: string[]; disciplines: string[]; countingResults: number; windowMonths: number; mark: MarkSpec }`
  - `const EVENT_GROUPS: EventGroup[]`
  - `function findEventGroup(slug: string, gender: Gender): EventGroup | undefined`
  - `function eventGroupsFor(gender: Gender): EventGroup[]`
  - `const DEFAULT_EVENT_SLUG = 'high-jump'`
  - `type MarkSpec = { kind: 'height' | 'distance' | 'time' | 'points'; betterIsHigher: boolean; decimals: number; unit: string }` — declared here, consumed by `src/engine/mark.ts` in Task 3.

- [ ] **Step 1: Write the failing test**

Create `src/data/events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_SLUG, EVENT_GROUPS, eventGroupsFor, findEventGroup } from './events';

describe('event registry', () => {
  it('holds 18 groups per gender', () => {
    expect(EVENT_GROUPS).toHaveLength(36);
    expect(eventGroupsFor('men')).toHaveLength(18);
    expect(eventGroupsFor('women')).toHaveLength(18);
  });

  it('finds a group by slug and gender', () => {
    const hj = findEventGroup('high-jump', 'women');
    expect(hj?.label).toBe("Women's High Jump");
    expect(hj?.disciplines).toContain('High Jump');
  });

  it('averages five results for every track and field group', () => {
    expect(EVENT_GROUPS.every((g) => g.countingResults === 5)).toBe(true);
  });

  it('gives the 10,000m group an 18-month window and everything else 12', () => {
    expect(findEventGroup('10000m', 'men')?.windowMonths).toBe(18);
    expect(findEventGroup('high-jump', 'men')?.windowMonths).toBe(12);
    expect(findEventGroup('1500m', 'men')?.windowMonths).toBe(12);
  });

  it('marks vertical jumps as higher-is-better and track events as lower-is-better', () => {
    expect(findEventGroup('high-jump', 'men')?.mark).toMatchObject({
      kind: 'height', betterIsHigher: true, decimals: 2,
    });
    expect(findEventGroup('shot-put', 'men')?.mark).toMatchObject({
      kind: 'distance', betterIsHigher: true,
    });
    expect(findEventGroup('800m', 'men')?.mark).toMatchObject({
      kind: 'time', betterIsHigher: false,
    });
  });

  it('defaults to high jump, so the current app behaviour is unchanged', () => {
    expect(findEventGroup(DEFAULT_EVENT_SLUG, 'men')).toBeDefined();
  });

  it('never has a group without disciplines to match results against', () => {
    for (const group of EVENT_GROUPS) {
      expect(group.disciplines.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/data/events.test.ts`
Expected: FAIL — cannot resolve `./events`.

- [ ] **Step 3: Write the registry**

Create `src/data/events.ts`:

```ts
/**
 * The event registry: the single place that knows anything discipline-specific.
 *
 * Everything downstream — window bounds, discipline matching, placing tables, mark
 * formatting — takes an EventGroup rather than reaching for a constant. Adding an
 * event group should mean adding data here, never editing the engine.
 *
 * Group membership, main/similar events and the ranking API slug come from World
 * Athletics rules Table 2.12 via pipeline/scrape_rules.py; the long discipline names
 * come from pipeline/harvest_disciplines.py. The per-group properties below are the
 * ones the rules state in prose rather than in a table.
 */
import groupsJson from './event_groups.json';
import type { Gender } from './types';

export type MarkKind = 'height' | 'distance' | 'time' | 'points';

export interface MarkSpec {
  kind: MarkKind;
  /** False for timed events, where a smaller number is a better performance. */
  betterIsHigher: boolean;
  decimals: number;
  unit: string;
}

export interface EventGroup {
  /** European Athletics ranking API `eventGroup` value, e.g. "high-jump". */
  slug: string;
  /** Table 2.12's own label, e.g. "Women's High Jump". */
  label: string;
  gender: Gender;
  mainEvent: string;
  /** Short names, as Table 2.12 writes them. Display only — never match on these. */
  similarEvents: string[];
  /** Long names, as the result feeds write them. Match results on these. */
  disciplines: string[];
  countingResults: number;
  windowMonths: number;
  mark: MarkSpec;
}

interface RawGroup {
  label: string;
  gender: string;
  mainEvent: string;
  similarEvents: string[];
  disciplines?: string[];
  slug: string | null;
}

const HEIGHT: MarkSpec = { kind: 'height', betterIsHigher: true, decimals: 2, unit: 'm' };
const DISTANCE: MarkSpec = { kind: 'distance', betterIsHigher: true, decimals: 2, unit: 'm' };
const TIME: MarkSpec = { kind: 'time', betterIsHigher: false, decimals: 2, unit: 's' };

const MARK_BY_MAIN_EVENT: Record<string, MarkSpec> = {
  'High Jump': HEIGHT,
  'Pole Vault': HEIGHT,
  'Long Jump': DISTANCE,
  'Triple Jump': DISTANCE,
  'Shot Put': DISTANCE,
  'Discus Throw': DISTANCE,
  'Hammer Throw': DISTANCE,
  'Javelin Throw': DISTANCE,
};

/**
 * World Athletics ranking rules, Track & Field: the ranking period is 12 months,
 * except the 10,000m event group, which is 18. Stated in prose on the rules page,
 * not in any table, so it is transcribed here.
 */
const WINDOW_MONTHS_BY_SLUG: Record<string, number> = { '10000m': 18 };
const DEFAULT_WINDOW_MONTHS = 12;

/** Every Track & Field event group averages the best 5 results. Road running and
 *  combined events use 2, which is why this is per-group rather than a constant —
 *  those families are out of scope here but will reuse this field. */
const COUNTING_RESULTS = 5;

export const DEFAULT_EVENT_SLUG = 'high-jump';

function toEventGroup(raw: RawGroup): EventGroup {
  if (!raw.slug) {
    throw new Error(`Event group "${raw.label}" has no ranking API slug`);
  }
  const disciplines = raw.disciplines ?? [];
  if (disciplines.length === 0) {
    throw new Error(
      `Event group "${raw.label}" has no discipline names — run pipeline/harvest_disciplines.py`,
    );
  }
  return {
    slug: raw.slug,
    label: raw.label,
    gender: raw.gender === 'men' ? 'men' : 'women',
    mainEvent: raw.mainEvent,
    similarEvents: raw.similarEvents,
    disciplines,
    countingResults: COUNTING_RESULTS,
    windowMonths: WINDOW_MONTHS_BY_SLUG[raw.slug] ?? DEFAULT_WINDOW_MONTHS,
    mark: MARK_BY_MAIN_EVENT[raw.mainEvent] ?? TIME,
  };
}

export const EVENT_GROUPS: EventGroup[] = (groupsJson.groups as RawGroup[]).map(toEventGroup);

export function findEventGroup(slug: string, gender: Gender): EventGroup | undefined {
  return EVENT_GROUPS.find((g) => g.slug === slug && g.gender === gender);
}

export function eventGroupsFor(gender: Gender): EventGroup[] {
  return EVENT_GROUPS.filter((g) => g.gender === gender);
}
```

- [ ] **Step 4: Widen the high-jump-only scoring table type**

In `src/data/types.ts`, change the `ScoringTable` interface's event field:

```ts
export interface ScoringTable {
  /** The event the table covers. Only high jump exists today; the scoring-tables
   *  pipeline will add the rest (see the scoring-tables plan). */
  event: string;
  unit: string;
  source: string;
  /** gender -> mark string (e.g. "2.30") -> points */
  points_by_mark: Record<Gender, Record<string, number>>;
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- src/data/events.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Run the whole suite to confirm nothing regressed**

Run: `npm test`
Expected: all files pass. The `ScoringTable` widening must not break `src/data/data.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/data/events.ts src/data/events.test.ts src/data/types.ts
git commit -m "feat(engine): add the event group registry"
```

---

### Task 3: The mark model

**Files:**
- Create: `src/engine/mark.ts`
- Create: `src/engine/mark.test.ts`

**Interfaces:**
- Consumes: `MarkSpec` from `src/data/events.ts` (Task 2).
- Produces:
  - `function parseMark(raw: string, spec: MarkSpec): number | null`
  - `function formatMark(value: number, spec: MarkSpec): string`
  - `function isBetterMark(candidate: number, incumbent: number, spec: MarkSpec): boolean`
  - `function compareMarks(a: number, b: number, spec: MarkSpec): number` — sorts best-first.

- [ ] **Step 1: Write the failing test**

Create `src/engine/mark.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MarkSpec } from '../data/events';
import { compareMarks, formatMark, isBetterMark, parseMark } from './mark';

const HEIGHT: MarkSpec = { kind: 'height', betterIsHigher: true, decimals: 2, unit: 'm' };
const TIME: MarkSpec = { kind: 'time', betterIsHigher: false, decimals: 2, unit: 's' };
const POINTS: MarkSpec = { kind: 'points', betterIsHigher: true, decimals: 0, unit: 'pts' };

describe('parseMark', () => {
  it('parses a height in metres', () => {
    expect(parseMark('2.30', HEIGHT)).toBe(2.3);
  });

  it('parses a plain seconds time', () => {
    expect(parseMark('9.67', TIME)).toBe(9.67);
  });

  it('parses minutes and seconds', () => {
    expect(parseMark('1:42.29', TIME)).toBeCloseTo(102.29, 5);
    expect(parseMark('3:34.10', TIME)).toBeCloseTo(214.1, 5);
  });

  it('parses hours, minutes and seconds', () => {
    expect(parseMark('2:04:03', TIME)).toBe(7443);
  });

  it('parses combined-event points', () => {
    expect(parseMark('8804', POINTS)).toBe(8804);
  });

  it('ignores trailing annotations the feed adds', () => {
    expect(parseMark('9.67 ', TIME)).toBe(9.67);
    expect(parseMark('2.30h', HEIGHT)).toBe(2.3);
  });

  it('returns null for a non-performance', () => {
    for (const raw of ['DNF', 'DNS', 'NM', 'DQ', '', '—']) {
      expect(parseMark(raw, TIME)).toBeNull();
    }
  });
});

describe('formatMark', () => {
  it('round-trips a height', () => {
    expect(formatMark(2.3, HEIGHT)).toBe('2.30');
  });

  it('formats seconds under a minute without a colon', () => {
    expect(formatMark(9.67, TIME)).toBe('9.67');
  });

  it('formats minutes and seconds with a zero-padded seconds field', () => {
    expect(formatMark(102.29, TIME)).toBe('1:42.29');
    expect(formatMark(214.1, TIME)).toBe('3:34.10');
  });

  it('formats past an hour', () => {
    expect(formatMark(7443, TIME)).toBe('2:04:03.00');
  });

  it('formats points as a whole number', () => {
    expect(formatMark(8804, POINTS)).toBe('8804');
  });
});

describe('isBetterMark', () => {
  it('treats a bigger height as better', () => {
    expect(isBetterMark(2.31, 2.3, HEIGHT)).toBe(true);
    expect(isBetterMark(2.29, 2.3, HEIGHT)).toBe(false);
  });

  it('treats a smaller time as better', () => {
    expect(isBetterMark(9.58, 9.67, TIME)).toBe(true);
    expect(isBetterMark(9.99, 9.67, TIME)).toBe(false);
  });

  it('does not count an equal mark as better', () => {
    expect(isBetterMark(2.3, 2.3, HEIGHT)).toBe(false);
    expect(isBetterMark(9.67, 9.67, TIME)).toBe(false);
  });
});

describe('compareMarks', () => {
  it('sorts heights best-first', () => {
    expect([2.2, 2.35, 2.3].sort((a, b) => compareMarks(a, b, HEIGHT))).toEqual([2.35, 2.3, 2.2]);
  });

  it('sorts times best-first', () => {
    expect([9.99, 9.58, 9.7].sort((a, b) => compareMarks(a, b, TIME))).toEqual([9.58, 9.7, 9.99]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/engine/mark.test.ts`
Expected: FAIL — cannot resolve `./mark`.

- [ ] **Step 3: Write the implementation**

Create `src/engine/mark.ts`:

```ts
/**
 * Marks across Track & Field are not one kind of number. A high jump is metres where
 * bigger is better; an 800m is a duration written "1:42.29" where smaller is better; a
 * marathon is "2:04:03"; a decathlon is a whole-number points total. Every comparison,
 * sort and format in the engine has to know which it is holding, so all four live behind
 * one MarkSpec-driven interface.
 *
 * Times are carried internally as seconds. That keeps comparison a plain numeric
 * operation and confines the colon-separated formatting to this module.
 */
import type { MarkSpec } from '../data/events';

/** Anything that is not a performance: did not finish, no mark, disqualified. */
const NON_PERFORMANCE = /^(dnf|dns|dq|nm|ng|nh|dnq|—|-)?$/i;

/**
 * A mark string to a number, or null when it carries no performance.
 *
 * Handles the three shapes the feeds emit — "SS.ss", "M:SS.ss" and "H:MM:SS(.ss)" —
 * and tolerates the trailing letters World Athletics appends to annotate a mark
 * (for example an "h" for a hand-timed or hand-measured performance).
 */
export function parseMark(raw: string, spec: MarkSpec): number | null {
  const trimmed = String(raw ?? '').trim();
  if (NON_PERFORMANCE.test(trimmed)) return null;

  // Drop annotation letters, keeping digits, separators and a leading sign.
  const cleaned = trimmed.replace(/[^\d.:]/g, '');
  if (!cleaned) return null;

  const parts = cleaned.split(':');
  if (parts.length > 3) return null;

  if (spec.kind !== 'time' && parts.length === 1) {
    const value = Number(parts[0]);
    return Number.isFinite(value) ? value : null;
  }

  // Seconds last, then minutes, then hours.
  let seconds = 0;
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isFinite(value)) return null;
    seconds = seconds * 60 + value;
  }
  return seconds;
}

/** The inverse of parseMark: a number back to the string form the feeds use. */
export function formatMark(value: number, spec: MarkSpec): string {
  if (spec.kind !== 'time') return value.toFixed(spec.decimals);

  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value - hours * 3600 - minutes * 60;
  const secondsText = seconds.toFixed(spec.decimals).padStart(spec.decimals > 0 ? spec.decimals + 3 : 2, '0');

  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${secondsText}`;
  if (minutes > 0) return `${minutes}:${secondsText}`;
  return seconds.toFixed(spec.decimals);
}

/** Whether `candidate` is a better performance than `incumbent`. Equal is not better. */
export function isBetterMark(candidate: number, incumbent: number, spec: MarkSpec): boolean {
  return spec.betterIsHigher ? candidate > incumbent : candidate < incumbent;
}

/** Comparator sorting marks best-first, for use with Array.prototype.sort. */
export function compareMarks(a: number, b: number, spec: MarkSpec): number {
  return spec.betterIsHigher ? b - a : a - b;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- src/engine/mark.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/engine/mark.ts src/engine/mark.test.ts
git commit -m "feat(engine): add a mark model spanning heights, distances, times and points"
```

---

### Task 4: Round classification

A result's placing points depend on which round it was. World Athletics gives a `race`
code — `F` for a final (`F1`/`F2` for flighted finals), `SF` for a semi-final, `H` for a
heat, `Q`/`Q1`/`Q2` for a field-event qualification round — but "the round before the
final" is not a fixed code. At a meet running heats, semi-finals and a final, the
semi-final is the round before the final and the heat is not. At a meet running only
heats and a final, the heat is. So the round before the final is the *highest*
non-final round the athlete actually contested at that competition.

**Files:**
- Create: `src/engine/rounds.ts`
- Create: `src/engine/rounds.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type RoundKind = 'final' | 'beforeFinal' | 'other'`
  - `interface RoundedResult { competitionId?: string; discipline: string; race: string }`
  - `function classifyRounds<T extends RoundedResult>(results: T[]): Map<T, RoundKind>`
  - `function advancedToFinal(result: RoundedResult, results: RoundedResult[]): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/engine/rounds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { advancedToFinal, classifyRounds } from './rounds';

const at = (competitionId: string, race: string, discipline = '100 Metres') => ({
  competitionId, race, discipline,
});

describe('classifyRounds', () => {
  it('marks finals as finals, including flighted ones', () => {
    const results = [at('1', 'F'), at('2', 'F1'), at('3', 'F2')];
    const kinds = classifyRounds(results);
    expect(results.map((r) => kinds.get(r))).toEqual(['final', 'final', 'final']);
  });

  it('treats a semi-final as the round before the final when heats also ran', () => {
    const heat = at('1', 'H');
    const semi = at('1', 'SF');
    const final = at('1', 'F');
    const kinds = classifyRounds([heat, semi, final]);
    expect(kinds.get(final)).toBe('final');
    expect(kinds.get(semi)).toBe('beforeFinal');
    expect(kinds.get(heat)).toBe('other');
  });

  it('treats a heat as the round before the final when no semi-final ran', () => {
    const heat = at('1', 'H');
    const final = at('1', 'F');
    const kinds = classifyRounds([heat, final]);
    expect(kinds.get(heat)).toBe('beforeFinal');
  });

  it('treats a field qualification round as the round before the final', () => {
    const qual = at('1', 'Q', 'High Jump');
    const final = at('1', 'F', 'High Jump');
    const kinds = classifyRounds([qual, final]);
    expect(kinds.get(qual)).toBe('beforeFinal');
  });

  it('keeps competitions independent of each other', () => {
    const semiA = at('1', 'SF');
    const heatB = at('2', 'H');
    const kinds = classifyRounds([semiA, at('1', 'H'), at('1', 'F'), heatB, at('2', 'F')]);
    expect(kinds.get(semiA)).toBe('beforeFinal');
    expect(kinds.get(heatB)).toBe('beforeFinal');
  });

  it('keeps disciplines within one competition independent', () => {
    const hjQual = at('1', 'Q', 'High Jump');
    const sprintHeat = at('1', 'H', '100 Metres');
    const kinds = classifyRounds([
      hjQual, at('1', 'F', 'High Jump'),
      sprintHeat, at('1', 'SF', '100 Metres'), at('1', 'F', '100 Metres'),
    ]);
    expect(kinds.get(hjQual)).toBe('beforeFinal');
    expect(kinds.get(sprintHeat)).toBe('other');
  });

  it('classifies a non-final round with no final at all as beforeFinal', () => {
    const heat = at('1', 'H');
    expect(classifyRounds([heat]).get(heat)).toBe('beforeFinal');
  });
});

describe('advancedToFinal', () => {
  it('is true when the athlete has a final at the same competition and discipline', () => {
    const qual = at('1', 'Q', 'High Jump');
    expect(advancedToFinal(qual, [qual, at('1', 'F', 'High Jump')])).toBe(true);
  });

  it('is false when they have no final there', () => {
    const qual = at('1', 'Q', 'High Jump');
    expect(advancedToFinal(qual, [qual])).toBe(false);
  });

  it('does not count a final in a different discipline', () => {
    const qual = at('1', 'Q', 'High Jump');
    expect(advancedToFinal(qual, [qual, at('1', 'F', '100 Metres')])).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/engine/rounds.test.ts`
Expected: FAIL — cannot resolve `./rounds`.

- [ ] **Step 3: Write the implementation**

Create `src/engine/rounds.ts`:

```ts
/**
 * Which round a result belongs to, in the sense the placing tables mean.
 *
 * World Athletics' `race` code says what kind of round it was, but the placing tables
 * ask a different question: was this "the round before the Final"? That depends on what
 * else ran at the same competition. Heats, semi-final, final -> the semi-final is the
 * round before the final and the heat scores nothing. Heats then final -> the heat is.
 *
 * So classification is a property of the whole result set, not of one row, and it is
 * scoped per competition AND per discipline: an athlete can contest a high jump
 * qualification and a sprint heat at the same meeting.
 */

export type RoundKind = 'final' | 'beforeFinal' | 'other';

export interface RoundedResult {
  competitionId?: string;
  discipline: string;
  race: string;
}

/** Seniority of a non-final round. Higher is closer to the final. */
const ROUND_SENIORITY: Array<{ prefix: string; rank: number }> = [
  { prefix: 'SF', rank: 3 }, // semi-final
  { prefix: 'Q', rank: 2 },  // field-event qualification
  { prefix: 'H', rank: 1 },  // heat
];

function isFinal(race: string): boolean {
  // "F", and flighted finals "F1"/"F2" — but not "FN" style codes we don't know.
  return /^F\d*$/i.test(race.trim());
}

function seniority(race: string): number {
  const code = race.trim().toUpperCase();
  for (const { prefix, rank } of ROUND_SENIORITY) {
    if (code.startsWith(prefix)) return rank;
  }
  return 0;
}

function bucketKey(result: RoundedResult): string {
  return `${result.competitionId ?? ''}|${result.discipline}`;
}

/**
 * Classify every result. Within each competition-and-discipline bucket, the non-final
 * round with the highest seniority is the round before the final; any less senior round
 * scores nothing.
 */
export function classifyRounds<T extends RoundedResult>(results: T[]): Map<T, RoundKind> {
  const topByBucket = new Map<string, number>();
  for (const result of results) {
    if (isFinal(result.race)) continue;
    const rank = seniority(result.race);
    if (rank === 0) continue;
    const key = bucketKey(result);
    topByBucket.set(key, Math.max(topByBucket.get(key) ?? 0, rank));
  }

  const kinds = new Map<T, RoundKind>();
  for (const result of results) {
    if (isFinal(result.race)) {
      kinds.set(result, 'final');
      continue;
    }
    const rank = seniority(result.race);
    const top = topByBucket.get(bucketKey(result)) ?? 0;
    kinds.set(result, rank > 0 && rank === top ? 'beforeFinal' : 'other');
  }
  return kinds;
}

/**
 * Whether the athlete went on to the final at the same competition and discipline —
 * which is what the placing tables' "Q or q to Final" row is asking.
 */
export function advancedToFinal(result: RoundedResult, results: RoundedResult[]): boolean {
  const key = bucketKey(result);
  return results.some((r) => r !== result && isFinal(r.race) && bucketKey(r) === key);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- src/engine/rounds.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/engine/rounds.ts src/engine/rounds.test.ts
git commit -m "feat(engine): classify result rounds against the placing tables' definition"
```

---

### Task 5: Placing points across the full table set

**Files:**
- Create: `src/engine/placing.ts`
- Create: `src/engine/placing.test.ts`

**Interfaces:**
- Consumes: `EventGroup` from `src/data/events.ts` (Task 2); `RoundKind` from `src/engine/rounds.ts` (Task 4); `src/data/placing_tables.json`.
- Produces:
  - `type FinalFieldSize = 'max9' | 'min10'`
  - `function finalFieldSizeFor(group: EventGroup): FinalFieldSize`
  - `function placingTableFor(group: EventGroup, discipline: string, round: RoundKind, category: CategoryCode): string | null`
  - `function placingPointsFor(args: { group: EventGroup; discipline: string; category: CategoryCode; round: RoundKind; place: number; advanced: boolean }): number`

- [ ] **Step 1: Write the failing test**

Create `src/engine/placing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findEventGroup } from '../data/events';
import { finalFieldSizeFor, placingPointsFor, placingTableFor } from './placing';

const hj = findEventGroup('high-jump', 'men')!;
const sprint = findEventGroup('100m', 'men')!;
const long = findEventGroup('5000m', 'men')!;
const tenK = findEventGroup('10000m', 'men')!;

describe('finalFieldSizeFor', () => {
  it('assumes field events run finals of 10 or more', () => {
    expect(finalFieldSizeFor(hj)).toBe('min10');
  });

  it('assumes track events run finals of at most 9', () => {
    expect(finalFieldSizeFor(sprint)).toBe('max9');
  });
});

describe('placingTableFor', () => {
  it('uses Table 2.2 for a general track and field final', () => {
    expect(placingTableFor(hj, 'High Jump', 'final', 'OW')).toBe('2.2');
  });

  it('uses Table 2.5 for a 5000m final', () => {
    expect(placingTableFor(long, '5000 Metres', 'final', 'OW')).toBe('2.5');
  });

  it('uses Table 2.9 for a 10,000m final but 2.10 for a 10km road race', () => {
    expect(placingTableFor(tenK, '10,000 Metres', 'final', 'OW')).toBe('2.9');
    expect(placingTableFor(tenK, '10km Road Race', 'final', 'OW')).toBe('2.10');
  });

  it('picks the round-before-final table by field size', () => {
    expect(placingTableFor(hj, 'High Jump', 'beforeFinal', 'OW')).toBe('2.4');
    expect(placingTableFor(sprint, '100 Metres', 'beforeFinal', 'OW')).toBe('2.3');
  });

  it('gives 5000m a dedicated OW round table that ignores field size', () => {
    expect(placingTableFor(long, '5000 Metres', 'beforeFinal', 'OW')).toBe('2.6');
  });

  it('falls back to field size for 5000m categories with no dedicated table', () => {
    // 5000m is a track group, so finalFieldSizeFor gives 'max9' -> Table 2.7.
    expect(placingTableFor(long, '5000 Metres', 'beforeFinal', 'DF')).toBe('2.7');
    expect(placingTableFor(long, '5000 Metres', 'beforeFinal', 'GL')).toBe('2.7');
  });

  it('has no table for a round that scores nothing', () => {
    expect(placingTableFor(hj, 'High Jump', 'other', 'OW')).toBeNull();
  });
});

describe('placingPointsFor', () => {
  const score = (args: Partial<Parameters<typeof placingPointsFor>[0]>) =>
    placingPointsFor({
      group: hj, discipline: 'High Jump', category: 'OW',
      round: 'final', place: 1, advanced: false, ...args,
    });

  it('scores a general track and field final from Table 2.2', () => {
    expect(score({})).toBe(260);
    expect(score({ place: 6 })).toBe(160);
    expect(score({ category: 'F', place: 1 })).toBe(11);
  });

  it('reproduces the high jump qualification value verified against live data', () => {
    // Doroshchuk's and Hrubá's Tokyo qualification rounds both scored 70 placing
    // points on top of their mark score — Table 2.4's "Q or q to Final" row.
    expect(score({ round: 'beforeFinal', advanced: true })).toBe(70);
  });

  it('scores a track semi-final that advanced from Table 2.3', () => {
    // Burgin's Tokyo semi-final: 100 placing points.
    expect(
      placingPointsFor({
        group: findEventGroup('800m', 'men')!, discipline: '800 Metres', category: 'OW',
        round: 'beforeFinal', place: 3, advanced: true,
      }),
    ).toBe(100);
  });

  it('scores nothing for a round before the final in a category the tables omit', () => {
    // Jacobs' category B heat scored 0 placing points: Tables 2.3/2.4 only have
    // columns for OW, DF, GW and GL.
    expect(
      placingPointsFor({
        group: sprint, discipline: '100 Metres', category: 'B',
        round: 'beforeFinal', place: 1, advanced: true,
      }),
    ).toBe(0);
  });

  it('scores a non-advancing round by the athlete own place', () => {
    expect(score({ round: 'beforeFinal', advanced: false, place: 11 })).toBe(66);
  });

  it('scores nothing outside the table range', () => {
    expect(score({ place: 40 })).toBe(0);
    expect(score({ round: 'other' })).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/engine/placing.test.ts`
Expected: FAIL — cannot resolve `./placing`.

- [ ] **Step 3: Write the implementation**

Create `src/engine/placing.ts`:

```ts
/**
 * Placing points, across the full 2026 Track & Field table set.
 *
 * Track & Field is not one placing table. Three different *final* tables apply
 * depending on the event group — 2.2 generally, 2.5 for the 5000m and 3000mSC groups,
 * 2.9 for the 10,000m group (and 2.10 for the 10km road races that count inside it) —
 * each with its own round-before-final companions. All of them, plus the group-to-table
 * mapping, come from pipeline/scrape_rules.py.
 */
import placingTablesJson from '../data/placing_tables.json';
import type { EventGroup } from '../data/events';
import type { CategoryCode } from '../data/types';
import type { RoundKind } from './rounds';

interface PlacingTablesFile {
  tables: Record<string, { title: string; scores: Record<string, Record<string, number>> }>;
  eventGroupTables: Record<string, {
    final: string;
    beforeFinal?: Record<string, string>;
    byDiscipline?: Record<string, { final?: string }>;
  }>;
}

const FILE = placingTablesJson as unknown as PlacingTablesFile;

/** The key the "Q or q to Final" row is stored under. */
const ADVANCED_KEY = 'Q';

export type FinalFieldSize = 'max9' | 'min10';

/**
 * Which round-before-final table applies, which the rules make conditional on whether the
 * final has at most 9 athletes (Table 2.3) or 10 or more (Table 2.4).
 *
 * Neither result feed reports the finalist count, so this is a per-family assumption:
 * championship field-event finals take 12, championship track finals take 8. The high
 * jump half is confirmed — Table 2.4's values reproduce World Athletics' live counting
 * sets exactly. The track half is the assumption the oracle test in Task 8 exists to
 * check; if it disproves it, correct it here rather than at the call sites.
 */
export function finalFieldSizeFor(group: EventGroup): FinalFieldSize {
  return group.mark.kind === 'height' || group.mark.kind === 'distance' ? 'min10' : 'max9';
}

function groupTables(group: EventGroup) {
  return FILE.eventGroupTables[group.slug] ?? FILE.eventGroupTables.default;
}

/** The table number that applies, or null when the round scores nothing. */
export function placingTableFor(
  group: EventGroup,
  discipline: string,
  round: RoundKind,
  category: CategoryCode,
): string | null {
  if (round === 'other') return null;
  const tables = groupTables(group);

  if (round === 'final') {
    return tables.byDiscipline?.[discipline]?.final ?? tables.final;
  }

  const beforeFinal = tables.beforeFinal;
  if (!beforeFinal) return null;
  // A category-specific round table wins over the field-size ones — the 5000m and
  // 3000mSC groups have a dedicated OW table (2.6) that is not split by field size.
  return beforeFinal[category] ?? beforeFinal[finalFieldSizeFor(group)] ?? null;
}

/**
 * Placing points for one result. Returns 0 whenever the tables award nothing: a round
 * that is not the final or the one before it, a category with no column in the relevant
 * table (rounds before the final only score in OW, DF, GW and GL), or a place beyond the
 * table's range.
 */
export function placingPointsFor(args: {
  group: EventGroup;
  discipline: string;
  category: CategoryCode;
  round: RoundKind;
  place: number;
  /** Whether the athlete advanced to the final — the tables' "Q or q to Final" row. */
  advanced: boolean;
}): number {
  const { group, discipline, category, round, place, advanced } = args;
  const tableNumber = placingTableFor(group, discipline, round, category);
  if (!tableNumber) return 0;

  const byCategory = FILE.tables[tableNumber]?.scores?.[category];
  if (!byCategory) return 0;

  const key = round === 'beforeFinal' && advanced ? ADVANCED_KEY : String(place);
  return byCategory[key] ?? 0;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- src/engine/placing.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/engine/placing.ts src/engine/placing.test.ts
git commit -m "feat(engine): resolve placing points across the full table set"
```

---

### Task 6: The ranking window

**Files:**
- Create: `src/engine/window.ts`
- Create: `src/engine/window.test.ts`

**Interfaces:**
- Consumes: `EventGroup` from `src/data/events.ts` (Task 2); `parseWaDate` from the new `src/engine/dates.ts` (Step 1 below).
- Produces:
  - `src/engine/dates.ts` exporting `parseWaDate(s: string): number` and `oneYearEarlier(ms: number): number`
  - `interface RankingWindow { startMs: number; endMs: number; areaChampionshipsFromMs: number }`
  - `function rankingWindow(group: EventGroup, rankDateMs: number): RankingWindow`
  - `function isInWindow(result: { date: string; category: string }, window: RankingWindow): boolean`

- [ ] **Step 1: Break the import cycle before it exists**

`window.ts` needs `parseWaDate`, and Task 7 makes `counting.ts` import `isInWindow` —
which would be a cycle. Move the date helpers to their own module first.

Create `src/engine/dates.ts` and move `MONTHS`, `parseWaDate` and `oneYearEarlier` into
it verbatim from `src/engine/counting.ts`, keeping their existing doc comments.

Then in `src/engine/counting.ts`, delete those three declarations and re-export, so every
existing import of `parseWaDate` from `./counting` keeps working:

```ts
export { parseWaDate, oneYearEarlier } from './dates';
```

Run: `npm test`
Expected: all pass — this is a pure move.

- [ ] **Step 2: Write the failing test**

Create `src/engine/window.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findEventGroup } from '../data/events';
import { parseWaDate } from './dates';
import { isInWindow, rankingWindow } from './window';

const hj = findEventGroup('high-jump', 'men')!;
const tenK = findEventGroup('10000m', 'men')!;
const rankDate = parseWaDate('21 JUL 2026');

describe('rankingWindow', () => {
  it('spans 12 months for a general track and field group', () => {
    const w = rankingWindow(hj, rankDate);
    expect(w.endMs).toBe(rankDate);
    expect(w.startMs).toBe(parseWaDate('21 JUL 2025'));
  });

  it('spans 18 months for the 10,000m group', () => {
    expect(rankingWindow(tenK, rankDate).startMs).toBe(parseWaDate('21 JAN 2025'));
  });

  it('opens the Area Championships allowance three calendar years back', () => {
    // Three full calendar years: 2024, 2025, 2026 — so from 01 JAN 2024.
    expect(rankingWindow(hj, rankDate).areaChampionshipsFromMs).toBe(parseWaDate('2024-01-01'));
  });
});

describe('isInWindow', () => {
  const w = rankingWindow(hj, rankDate);

  it('accepts a result inside the rolling window', () => {
    expect(isInWindow({ date: '01 JUN 2026', category: 'A' }, w)).toBe(true);
  });

  it('rejects an ordinary result older than the window', () => {
    expect(isInWindow({ date: '08 JUN 2024', category: 'A' }, w)).toBe(false);
  });

  it('accepts an Area Championships result older than the window', () => {
    // Jacobs' 08 JUN 2024 European Championships result counts in a July 2026
    // ranking: Area Senior Outdoor Championships are included regardless of the
    // ranking period, within three full calendar years.
    expect(isInWindow({ date: '08 JUN 2024', category: 'GL' }, w)).toBe(true);
  });

  it('rejects an Area Championships result beyond three calendar years', () => {
    expect(isInWindow({ date: '20 AUG 2023', category: 'GL' }, w)).toBe(false);
  });

  it('rejects a result in the future of the rank date', () => {
    expect(isInWindow({ date: '01 SEP 2026', category: 'A' }, w)).toBe(false);
  });

  it('rejects an unparseable date rather than silently including it', () => {
    expect(isInWindow({ date: 'nonsense', category: 'A' }, w)).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- src/engine/window.test.ts`
Expected: FAIL — cannot resolve `./window`.

- [ ] **Step 4: Write the implementation**

Create `src/engine/window.ts`:

```ts
/**
 * The ranking window: which results are eligible to count on a given rank date.
 *
 * Two rules, both from the World Athletics Track & Field ranking rules:
 *
 *  - The ranking period is 12 months back from the rank date, except the 10,000m
 *    event group, which is 18. This is per event group, hence EventGroup.windowMonths.
 *
 *  - Area Senior Outdoor Championships (category GL) count regardless of the ranking
 *    period, provided they were held within three full calendar years. This is why a
 *    June 2024 result can still count in a July 2026 ranking, and it is the rule the
 *    original high-jump-only window logic was missing.
 */
import type { EventGroup } from '../data/events';
import { parseWaDate } from './dates';

/** Category code for Area Senior Outdoor Championships. */
const AREA_CHAMPIONSHIPS = 'GL';

/** How many full calendar years back the Area Championships allowance reaches. */
const AREA_CHAMPIONSHIPS_YEARS = 3;

export interface RankingWindow {
  startMs: number;
  endMs: number;
  /** Start of the wider allowance that only Area Championships results may use. */
  areaChampionshipsFromMs: number;
}

/** Shift a UTC timestamp back by whole months, keeping the day of month. */
function monthsEarlier(ms: number, months: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate());
}

export function rankingWindow(group: EventGroup, rankDateMs: number): RankingWindow {
  const year = new Date(rankDateMs).getUTCFullYear();
  return {
    startMs: monthsEarlier(rankDateMs, group.windowMonths),
    endMs: rankDateMs,
    // "Three full calendar years" counts the rank date's own year as one of them,
    // so it opens on 1 January two years before.
    areaChampionshipsFromMs: Date.UTC(year - (AREA_CHAMPIONSHIPS_YEARS - 1), 0, 1),
  };
}

/** Whether a result is eligible to count in this window. */
export function isInWindow(
  result: { date: string; category: string },
  window: RankingWindow,
): boolean {
  const t = parseWaDate(result.date);
  if (!Number.isFinite(t) || t > window.endMs) return false;
  if (t >= window.startMs) return true;
  return result.category === AREA_CHAMPIONSHIPS && t >= window.areaChampionshipsFromMs;
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- src/engine/window.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: all pass — the `dates.ts` extraction must not have changed any behaviour.

- [ ] **Step 7: Commit**

```bash
git add src/engine/dates.ts src/engine/counting.ts src/engine/window.ts src/engine/window.test.ts
git commit -m "feat(engine): add per-group ranking windows with the Area Championships rule"
```

---

### Task 7: Generalize the counting engine

`src/engine/counting.ts` currently hardcodes high jump in four places: the
`discipline === 'High Jump'` checks in `isFinalResult` and `candidateScore`, the
`QUAL_TO_FINAL_PLACING` map, and `COUNTING_RESULTS = 5`. All four move onto the
`EventGroup` parameter, and round scoring delegates to Tasks 4–6.

**Files:**
- Modify: `src/engine/counting.ts`
- Modify: `src/engine/counting.test.ts`

**Interfaces:**
- Consumes: `EventGroup` (Task 2), `classifyRounds`/`advancedToFinal` (Task 4), `placingPointsFor` (Task 5), `rankingWindow`/`isInWindow` (Task 6).
- Produces (changed signatures):
  - `function isCountableResult(r: RankableResult, group: EventGroup): boolean` — replaces `isFinalResult`
  - `function scoreResults(results: RankableResult[], group: EventGroup): ScoredResult[]` — replaces `candidateScore`
  - `function substitutePool(results: RankableResult[], group: EventGroup, window: RankingWindow, countingKeys: Set<string>, cap: number): ScoredResult[]`
  - Unchanged and still exported: `parseWaDate`, `parsePlace`, `resultKey`, `countingKey`, `allCountingInWindow`, `recount`, `oneYearEarlier`.

- [ ] **Step 1: Write the failing test**

Add to `src/engine/counting.test.ts` (keep the existing high-jump cases — they must
still pass, which is the regression guarantee):

```ts
import { describe, expect, it } from 'vitest';
import { findEventGroup } from '../data/events';
import { parseWaDate } from './dates';
import { rankingWindow } from './window';
import {
  isCountableResult, scoreResults, substitutePool, type RankableResult,
} from './counting';

const hjGroup = findEventGroup('high-jump', 'men')!;
const sprintGroup = findEventGroup('100m', 'men')!;

const result = (over: Partial<RankableResult> = {}): RankableResult => ({
  date: '01 JUN 2026', competition: 'Meet', competitionId: 'c1', race: 'F',
  discipline: 'High Jump', category: 'A', place: '1.', resultScore: 1200, ...over,
});

describe('isCountableResult', () => {
  it('accepts a discipline belonging to the group', () => {
    expect(isCountableResult(result(), hjGroup)).toBe(true);
  });

  it('rejects a discipline from another group', () => {
    expect(isCountableResult(result({ discipline: '100 Metres' }), hjGroup)).toBe(false);
  });

  it('accepts a similar event inside the same group', () => {
    const sprint = result({ discipline: '60 Metres' });
    expect(isCountableResult(sprint, sprintGroup)).toBe(sprintGroup.disciplines.includes('60 Metres'));
  });

  it('rejects a result flagged not legal', () => {
    expect(isCountableResult(result({ notLegal: true }), hjGroup)).toBe(false);
  });
});

describe('scoreResults', () => {
  it('scores a final as mark points plus placing points', () => {
    const [scored] = scoreResults([result({ category: 'OW', place: '6.' })], hjGroup);
    expect(scored.score).toBe(1200 + 160); // Table 2.2, OW, 6th
  });

  it('scores an advancing qualification round from the round table', () => {
    const qual = result({ race: 'Q1', category: 'OW', place: '5.', resultScore: 1135 });
    const final = result({ race: 'F', category: 'OW', place: '4.' });
    const scored = scoreResults([qual, final], hjGroup);
    const qualScore = scored.find((s) => s.race === 'Q1');
    expect(qualScore?.score).toBe(1135 + 70); // Table 2.4, "Q or q to Final"
  });

  it('scores a heat behind a semi-final at nothing extra', () => {
    const heat = result({ discipline: '100 Metres', race: 'H', category: 'OW', resultScore: 1249 });
    const semi = result({ discipline: '100 Metres', race: 'SF', category: 'OW', place: '3.' });
    const final = result({ discipline: '100 Metres', race: 'F', category: 'OW', place: '2.' });
    const scored = scoreResults([heat, semi, final], sprintGroup);
    expect(scored.find((s) => s.race === 'H')?.score).toBe(1249);
  });
});

describe('substitutePool with an event group', () => {
  it('excludes results already counting and anything above the cap', () => {
    const window = rankingWindow(hjGroup, parseWaDate('21 JUL 2026'));
    const pool = substitutePool(
      [result({ resultScore: 1300 }), result({ date: '02 JUN 2026', resultScore: 1000 })],
      hjGroup, window, new Set(), 1100,
    );
    expect(pool).toHaveLength(1);
    expect(pool[0].resultScore).toBe(1000);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/engine/counting.test.ts`
Expected: FAIL — `isCountableResult` and `scoreResults` are not exported.

- [ ] **Step 3: Replace the high-jump-specific parts of counting.ts**

In `src/engine/counting.ts`, delete `QUAL_TO_FINAL_PLACING`, `isFinalResult`,
`candidateScore` and `COUNTING_RESULTS`, and add these imports and functions. Leave
`parseWaDate`, `parsePlace`, `resultKey`, `countingKey`, `allCountingInWindow`,
`recount` and `oneYearEarlier` exactly as they are.

```ts
import type { EventGroup } from '../data/events';
import { advancedToFinal, classifyRounds } from './rounds';
import { placingPointsFor } from './placing';
import { isInWindow, type RankingWindow } from './window';
import type { CategoryCode } from '../data/types';

/**
 * Whether a result belongs to this event group at all. An athlete's profile carries
 * every discipline they have ever contested, and an event group spans several of them
 * (the 1500m ranking counts indoor 1500m results too), so membership is a set lookup
 * against the group's harvested discipline names — never a single string comparison.
 */
export function isCountableResult(r: RankableResult, group: EventGroup): boolean {
  return group.disciplines.includes(r.discipline) && !r.notLegal;
}

/**
 * Score every result that belongs to the group: mark points (given by World Athletics)
 * plus placing points (derived from the tables). Rounds are classified across the whole
 * set at once, because whether a round counts as "the round before the Final" depends on
 * what else the athlete contested at that competition — see engine/rounds.ts.
 */
export function scoreResults(results: RankableResult[], group: EventGroup): ScoredResult[] {
  const mine = results.filter((r) => isCountableResult(r, group));
  const rounds = classifyRounds(mine);
  return mine.map((r) => ({
    ...r,
    score: r.resultScore + placingPointsFor({
      group,
      discipline: r.discipline,
      category: r.category as CategoryCode,
      round: rounds.get(r) ?? 'other',
      place: parsePlace(r.place),
      advanced: advancedToFinal(r, mine),
    }),
    t: parseWaDate(r.date),
  }));
}
```

Then replace `substitutePool` with the window-aware version:

```ts
/**
 * Candidate "next best" results, best-to-worst: scorable results inside the window that
 * aren't already counting and don't out-score the counting set. The `cap` (the lowest
 * counting score) keeps this safe without perfectly reproducing World Athletics' window:
 * a genuine 6th is always <= the 5th, so anything above the cap is either already
 * counting or a boundary result World Athletics hasn't counted yet.
 */
export function substitutePool(
  results: RankableResult[],
  group: EventGroup,
  window: RankingWindow,
  countingKeys: Set<string>,
  cap: number,
): ScoredResult[] {
  return scoreResults(results, group)
    .filter((r) => isInWindow(r, window))
    .filter((r) => !countingKeys.has(countingKey(r)) && r.score <= cap)
    .sort((a, b) => b.score - a.score || b.t - a.t);
}
```

- [ ] **Step 4: Update the existing high-jump call site**

In `src/components/AthleteLookup.tsx`, replace the `substitutePool` call and the
`COUNTING_RESULTS` import. Find the existing call and change it to pass the group and
window:

```ts
import { findEventGroup } from '../data/events';
import { rankingWindow } from '../engine/window';

const group = findEventGroup('high-jump', gender)!;
const window = rankingWindow(group, parseWaDate(rankDate));
const subs = substitutePool(results, group, window, countingKeys, cap);
```

Import `COUNTING_RESULTS` from `../engine/simulate` where it is still defined, or use
`group.countingResults`. Prefer `group.countingResults`.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: all pass, with **one intended behaviour change** to watch for.

The old `candidateScore` returned `null` for any round that was not a final and not an
advancing championship qualification — those results were excluded from the substitute
pool entirely. `scoreResults` now includes them, scored at their mark points plus
whatever the round tables award (often zero). This is a deliberate correction: World
Athletics does count such rounds, which is why a category B heat appears in a real
counting set scoring its mark alone.

So a high-jump test asserting that a non-advancing qualification round is absent from
the substitute pool should now expect it present with a mark-only score. Update that
expectation and note why in the test. Any *other* high-jump behaviour change is a
regression — fix the engine, not the test.

- [ ] **Step 6: Commit**

```bash
git add src/engine/counting.ts src/engine/counting.test.ts src/components/AthleteLookup.tsx
git commit -m "feat(engine): drive counting-set reconstruction from the event group"
```

---

### Task 8: Generalize the API clients

**Files:**
- Modify: `src/data/rankingApi.ts`, `src/data/athleteResultsApi.ts`, `src/data/birminghamApi.ts`
- Modify: `src/data/birminghamApi.test.ts`
- Modify: the test files that mock these modules: `src/components/AthleteLookup.easterEgg.test.tsx`, `.entryStandardOnly.test.tsx`, `.favorites.test.tsx`, `.raceCondition.test.tsx`, `.resultReplacement.test.tsx`, `.roadToBirmingham.test.tsx`

**Interfaces:**
- Consumes: `EventGroup` (Task 2).
- Produces:
  - `function fetchRanking(slug: string, gender: Gender): Promise<{ rankDate: string; rows: RankingRow[] }>` — replaces `fetchHighJumpRanking`
  - `function fetchAthleteResults(athleteId: number, years: number[], disciplines: string[]): Promise<AthleteResult[]>` — replaces `fetchAthleteHighJumpResults`
  - `interface CompetitionEvent { id: number; genderCode: 'M' | 'W'; name: string }`
  - `function fetchCompetitionEvents(competitionId: number): Promise<CompetitionEvent[]>`
  - `function eventIdFor(events: CompetitionEvent[], gender: Gender, mainEventName: string): number | null`
  - `function eventIdForGroup(events: CompetitionEvent[], group: EventGroup): number | null`
  - `function fetchRoadToBirmingham(group: EventGroup): Promise<RoadToBirmingham>` — signature changes from `(gender: Gender)`; resolves the event id at runtime.

- [ ] **Step 1: Write the failing test for event discovery**

Add to `src/data/birminghamApi.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { eventIdFor } from './birminghamApi';

describe('eventIdFor', () => {
  const events = [
    { id: 10229509, genderCode: 'W' as const, name: "Women's 100 Metres" },
    { id: 10229526, genderCode: 'W' as const, name: "Women's High Jump" },
    { id: 10229615, genderCode: 'M' as const, name: "Men's High Jump" },
  ];

  it('finds the event by gender and main event name', () => {
    expect(eventIdFor(events, 'men', 'High Jump')).toBe(10229615);
    expect(eventIdFor(events, 'women', 'High Jump')).toBe(10229526);
  });

  it('returns null when the competition does not stage the event', () => {
    expect(eventIdFor(events, 'men', 'Pole Vault')).toBeNull();
  });

  it('does not confuse an event with a longer name that contains it', () => {
    const withHurdles = [
      { id: 1, genderCode: 'M' as const, name: "Men's 100 Metres" },
      { id: 2, genderCode: 'M' as const, name: "Men's 100 Metres Hurdles" },
    ];
    expect(eventIdFor(withHurdles, 'men', '100 Metres')).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/data/birminghamApi.test.ts`
Expected: FAIL — `eventIdFor` is not exported.

- [ ] **Step 3: Implement runtime event discovery**

In `src/data/birminghamApi.ts`, replace the hardcoded `HIGH_JUMP_EVENT_ID` map:

```ts
/**
 * The competition's own event list. Calling the qualifying-system endpoint with no
 * `eventId` returns every event it stages, with ids — so event ids never need
 * hardcoding per discipline. Verified live 2026-07-27.
 */
export interface CompetitionEvent {
  id: number;
  genderCode: 'M' | 'W';
  name: string; // "Men's High Jump"
}

export async function fetchCompetitionEvents(competitionId: number): Promise<CompetitionEvent[]> {
  const data = await trpc<{ events?: CompetitionEvent[] }>(
    'worldAthletics.getCompetitionQualifyingSystem',
    { competitionId },
  );
  return data.events ?? [];
}

/**
 * The event id for a gender and main event, or null when the competition doesn't stage
 * it. Matched on the exact suffix after the gender prefix so that "100 Metres" cannot
 * match "100 Metres Hurdles".
 */
export function eventIdFor(
  events: CompetitionEvent[],
  gender: Gender,
  mainEventName: string,
): number | null {
  const code = gender === 'men' ? 'M' : 'W';
  const suffix = mainEventName.toLowerCase();
  const match = events.find((e) => {
    if (e.genderCode !== code) return false;
    const name = e.name.toLowerCase();
    return name.endsWith(` ${suffix}`) || name === suffix;
  });
  return match?.id ?? null;
}
```

The event list names the *discipline* ("Men's High Jump", "Men's 100 Metres"), but a
track group's `mainEvent` is Table 2.12's short form ("100m"), which will never match.
Resolve through the group's harvested long discipline names instead — add this alongside
`eventIdFor`:

```ts
/**
 * The competition's event id for an event group, or null when it doesn't stage it.
 *
 * The competition event list spells events as disciplines ("Men's 100 Metres") while an
 * event group's mainEvent is Table 2.12's short form ("100m"), so match through the
 * group's harvested long discipline names. Longest first, so that a group containing
 * both "100 Metres" and "100 Metres Hurdles" cannot match the shorter one by accident.
 */
export function eventIdForGroup(events: CompetitionEvent[], group: EventGroup): number | null {
  const candidates = [...group.disciplines].sort((a, b) => b.length - a.length);
  for (const discipline of candidates) {
    const id = eventIdFor(events, group.gender, discipline);
    if (id !== null) return id;
  }
  return null;
}
```

And make `fetchRoadToBirmingham` resolve the id at runtime rather than from a constant:

```ts
/** Fetch the Road to Birmingham qualification tracker for an event group. */
export async function fetchRoadToBirmingham(group: EventGroup): Promise<RoadToBirmingham> {
  const events = await fetchCompetitionEvents(BIRMINGHAM_COMPETITION_ID);
  const eventId = eventIdForGroup(events, group);
  if (eventId === null) {
    throw new Error(`Birmingham does not stage ${group.label}`);
  }
  const data = await trpc<QualifyingSystemResponse>(
    'worldAthletics.getCompetitionQualifyingSystem',
    { competitionId: BIRMINGHAM_COMPETITION_ID, eventId },
  );
  return {
    entryNumber: data.entryNumber,
    entryStandard: data.entryStandard,
    rankDate: data.rankDate,
    numberOfCompetitorsFilledUpByWorldRankings: data.numberOfCompetitorsFilledUpByWorldRankings,
    firstRankingDay: data.firstRankingDay,
    lastRankingDay: data.lastRankingDay,
    qualifications: data.qualifications,
  };
}
```

This costs one extra request per road-to fetch. Acceptable: it is one call per gender
per page view, and it removes a hardcoded id per discipline that would otherwise need
maintaining for 36 combinations and re-doing for every future championship.

- [ ] **Step 4: Rename the ranking and results fetchers**

In `src/data/rankingApi.ts`, replace `fetchHighJumpRanking`:

```ts
/** Fetch a full ranking for an event group and gender (all pages). */
export async function fetchRanking(
  slug: string,
  gender: Gender,
): Promise<{ rankDate: string; rows: RankingRow[] }> {
  const first = await trpc<RankingResponse>('worldAthletics.getRanking', {
    eventGroup: slug,
    gender,
  });
  const rows = [...first.rankings];
  for (let page = 2; page <= first.pages; page++) {
    const next = await trpc<RankingResponse>('worldAthletics.getRanking', {
      eventGroup: slug,
      gender,
      page,
    });
    rows.push(...next.rankings);
  }
  return { rankDate: first.rankDate, rows };
}
```

In `src/data/athleteResultsApi.ts`, replace `fetchAthleteHighJumpResults`:

```ts
/**
 * An athlete's results across the given calendar years, filtered to the disciplines that
 * count for one event group. Everything else — rounds, windowing, scoring — is left to
 * engine/counting.ts. Years are fetched in parallel; one year's failure fails the whole
 * call, so callers should catch and degrade.
 */
export async function fetchAthleteResults(
  athleteId: number,
  years: number[],
  disciplines: string[],
): Promise<AthleteResult[]> {
  const perYear = await Promise.all(years.map((y) => fetchResultsForYear(athleteId, y)));
  return perYear.flat().filter((r) => disciplines.includes(r.discipline));
}
```

- [ ] **Step 5: Update every call site and mock**

Run: `grep -rn "fetchHighJumpRanking\|fetchAthleteHighJumpResults" src/`

For each hit, rename to `fetchRanking` / `fetchAthleteResults` and add the new argument.
In `src/components/AthleteLookup.tsx` pass `group.slug` and `group.disciplines`, using
`findEventGroup('high-jump', gender)!` until the UI plan adds event selection. In the
six `AthleteLookup.*.test.tsx` files, update the `vi.mock` factory keys to the new names.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all 33 files pass. Behaviour for high jump must be unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/data/ src/components/AthleteLookup.tsx
git commit -m "feat(data): make the API clients event-group aware"
```

---

### Task 9: Prove it against World Athletics' own calculations

The strong test. For a real athlete, given their full profile results, our reconstruction
must select the same counting set that World Athletics selected and reach the same
average. This exercises discipline membership, window bounds, round classification and
placing tables all at once — the failure mode being guarded against is silently
mis-scoring 17 newly-supported events.

Fixtures are captured once by a manually-run script and committed, so the test itself
never touches the network.

**Files:**
- Create: `scripts/capture-oracle-fixtures.mjs`
- Create: `src/engine/__fixtures__/oracle/` (captured JSON, committed)
- Create: `src/engine/oracle.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–8.
- Produces: no exports; a test plus a capture script.

- [ ] **Step 1: Write the capture script**

Create `scripts/capture-oracle-fixtures.mjs`:

```js
/**
 * Capture live World Athletics payloads as offline test fixtures.
 *
 * Run by hand, not in CI: `node scripts/capture-oracle-fixtures.mjs`
 *
 * For each event group it takes the top-ranked athlete, then saves both halves of the
 * oracle: World Athletics' own ranking calculation (the counting set they chose) and the
 * athlete's full profile results (the input our engine reconstructs from).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const EA = 'https://api.european-athletics.com/trpc';
const WA_GRAPHQL = 'https://graphql-prod-4877.edge.aws.worldathletics.org/graphql';
const WA_API_KEY = 'da2-tzmostylynabpfkrgbmmml4toq';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const OUT = new URL('../src/engine/__fixtures__/oracle/', import.meta.url);

const groups = JSON.parse(readFileSync(new URL('../src/data/event_groups.json', import.meta.url), 'utf8')).groups;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function trpc(proc, input) {
  const url = `${EA}/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${proc}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${proc}: ${JSON.stringify(body.error)}`);
  return body.result.data.json;
}

const RESULTS_QUERY = `query GetSingleCompetitorResultsDate($id: Int, $resultsByYear: Int, $resultsByYearOrderBy: String) {
  getSingleCompetitorResultsDate(id: $id, resultsByYear: $resultsByYear, resultsByYearOrderBy: $resultsByYearOrderBy) {
    activeYears
    resultsByDate { date competition competitionId discipline category race place mark notLegal resultScore }
  }
}`;

async function resultsForYear(athleteId, year) {
  const res = await fetch(WA_GRAPHQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': WA_API_KEY },
    body: JSON.stringify({
      operationName: 'GetSingleCompetitorResultsDate',
      query: RESULTS_QUERY,
      variables: { id: athleteId, resultsByYear: year, resultsByYearOrderBy: 'date' },
    }),
  });
  const body = await res.json();
  return body?.data?.getSingleCompetitorResultsDate?.resultsByDate ?? [];
}

mkdirSync(OUT, { recursive: true });

for (const group of groups) {
  if (!group.slug) continue;
  try {
    const ranking = await trpc('worldAthletics.getRanking', { eventGroup: group.slug, gender: group.gender });
    const row = ranking.rankings?.[0];
    if (!row) { console.log(`skip ${group.label}: empty ranking`); continue; }

    const calculation = await trpc('worldAthletics.getRankingScoreCalculation', { calculationId: row.id });
    const athleteId = Number(String(row.athleteUrlSlug).match(/-(\d+)$/)?.[1]);
    const rankYear = Number(String(ranking.rankDate).match(/(\d{4})/)?.[1]);
    // Cover the widest window any group uses (18 months) plus the three calendar
    // year Area Championships allowance.
    const years = [rankYear, rankYear - 1, rankYear - 2];
    const results = (await Promise.all(years.map((y) => resultsForYear(athleteId, y)))).flat();

    const name = `${group.slug}-${group.gender}.json`;
    writeFileSync(new URL(name, OUT), JSON.stringify({
      group: { slug: group.slug, gender: group.gender, label: group.label },
      athlete: { name: row.athlete, urlSlug: row.athleteUrlSlug, athleteId },
      rankDate: ranking.rankDate,
      rankingScore: row.rankingScore,
      calculation,
      results,
    }, null, 2) + '\n');
    console.log(`wrote ${name}: ${row.athlete}, ${calculation.results?.length ?? 0} counting, ${results.length} total`);
  } catch (err) {
    console.log(`skip ${group.label}: ${err.message}`);
  }
  await sleep(400);
}
```

- [ ] **Step 2: Run the capture**

Run: `node scripts/capture-oracle-fixtures.mjs`
Expected: up to 36 files written to `src/engine/__fixtures__/oracle/`, each naming an
athlete and a counting-set size of 5.

- [ ] **Step 3: Write the oracle test**

Create `src/engine/oracle.test.ts`:

```ts
/**
 * Replay World Athletics' own ranking calculations against our reconstruction.
 *
 * Each fixture holds both halves: the counting set World Athletics chose, and the full
 * profile results we reconstruct from. Reproducing their set proves discipline
 * membership, window bounds, round classification and placing tables at once.
 *
 * Fixtures are captured by scripts/capture-oracle-fixtures.mjs. Refresh them when the
 * rankings move; the test never touches the network.
 */
import { describe, expect, it } from 'vitest';
import { findEventGroup } from '../data/events';
import { countingKey, parseWaDate, scoreResults } from './counting';
import { isInWindow, rankingWindow } from './window';

const fixtures = import.meta.glob('./__fixtures__/oracle/*.json', { eager: true }) as Record<
  string,
  { default: OracleFixture }
>;

interface OracleFixture {
  group: { slug: string; gender: 'men' | 'women'; label: string };
  athlete: { name: string };
  rankDate: string;
  rankingScore: number;
  calculation: {
    averagePerformanceScore: number;
    results: Array<{
      date: string; discipline: string; category: string; race: string;
      place: string; performanceScore: number; resultScore: number;
    }>;
  };
  results: Array<{
    date: string; competition: string; competitionId: string; discipline: string;
    category: string; race: string; place: string; mark: string;
    notLegal: boolean; resultScore: number;
  }>;
}

const entries = Object.values(fixtures).map((m) => m.default);

describe('reconstruction matches World Athletics', () => {
  it('has fixtures to replay', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  for (const fixture of entries) {
    const { label, slug, gender } = fixture.group;

    describe(`${label} — ${fixture.athlete.name}`, () => {
      const group = findEventGroup(slug, gender)!;
      const window = rankingWindow(group, parseWaDate(fixture.rankDate));

      it('scores every counting result to the value World Athletics gives it', () => {
        const scored = scoreResults(fixture.results, group);
        const byKey = new Map(scored.map((s) => [countingKey(s), s.score]));
        for (const official of fixture.calculation.results) {
          const ours = byKey.get(countingKey(official));
          // A counting result we cannot even find is a membership failure; one we
          // find but score differently is a placing-table or round failure.
          expect(ours, `no scored result matching ${official.date} ${official.discipline}`)
            .toBeDefined();
          expect(ours, `${official.date} ${official.discipline} ${official.race}`)
            .toBe(official.performanceScore);
        }
      });

      it('keeps every counting result inside the window', () => {
        for (const official of fixture.calculation.results) {
          expect(isInWindow(official, window), `${official.date} ${official.category}`).toBe(true);
        }
      });

      it('reproduces the published ranking score from the counting set', () => {
        const scores = fixture.calculation.results.map((r) => r.performanceScore);
        const average = Math.floor(scores.reduce((sum, s) => sum + s, 0) / scores.length);
        expect(average).toBe(fixture.calculation.averagePerformanceScore);
      });
    });
  }
});
```

- [ ] **Step 4: Run the oracle test**

Run: `npm test -- src/engine/oracle.test.ts`

Expected: this is the task's real work. Every failure is information:

- *"no scored result matching …"* — the group is missing a discipline name. Re-run
  `pipeline/harvest_disciplines.py` with a larger `--sample`.
- *a beforeFinal result scoring wrong on a track group* — the `finalFieldSizeFor`
  assumption in `src/engine/placing.ts` is wrong for that group. Correct it there and
  record what the data showed in a comment.
- *a counting result outside the window* — a window rule is missing. The known
  candidate is the overweighting rule (only the latest edition of an OW or DF
  competition counts), which is deliberately not implemented yet.

Fix the engine, never the fixture. If a failure turns out to be a rule not yet
implemented, mark that case with `it.fails(...)` and add a comment naming the rule, so
the gap is visible rather than silent.

- [ ] **Step 5: Record the outcome**

Add a short section to `docs/superpowers/specs/2026-07-27-all-disciplines-research.md`
under "Open questions" stating which event groups reproduce World Athletics exactly,
which do not, and why — in particular whether the track `max9` assumption held.

- [ ] **Step 6: Commit**

```bash
git add scripts/capture-oracle-fixtures.mjs src/engine/__fixtures__ src/engine/oracle.test.ts docs/superpowers/specs/2026-07-27-all-disciplines-research.md
git commit -m "test(engine): verify reconstruction against World Athletics' own calculations"
```

---

## Out of scope for this plan

These need their own plans and are deliberately excluded:

- **UI and storage** — event selection in the calculator, lookup, comparison and
  notification preferences; adding the event dimension to the `favorites` and
  `ranking_snapshots` keys; making `notify-poll` fetch only the event groups some
  favorite actually references (36 combinations is 18x the current traffic).
- **Scoring tables** — parsing mark-to-points for every Track & Field event, which
  unlocks the calculator and simulator beyond high jump. Blocked on the source research.
- **Overweighting rules** — only the latest edition of an OW or DF competition counts.
  Task 9 is expected to surface where this matters; implement it once the oracle says
  which groups it actually affects.
- **Wind modification** (Table 2.1, already extracted) — only relevant once the
  simulator covers sprints, hurdles, long jump and triple jump.
