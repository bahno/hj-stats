# Simulator: scoring every event group — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `SimulateResult` score a simulated mark in any of the 36 Track & Field event groups, replacing the high-jump-only gate.

**Architecture:** `src/data/scoring_tables.json` is split into 36 per-group chunks loaded on demand, so first paint does not grow. A new `engine/scoring.ts` ports the book's sparse-lookup rule; a new `engine/markWheels.ts` decomposes marks into digit groups and cascades them so every reachable wheel combination is a real listed mark; `inputs/MarkSelect.tsx` renders them. `simulate.ts` switches placing from the Table-2.2-only `placingPoints` to the group-aware `placingPointsFor`.

**Tech Stack:** TypeScript, React, Vite (`import.meta.glob`), Vitest + Testing Library, Python 3 for the pipeline.

**Spec:** `docs/superpowers/specs/2026-07-30-simulator-all-disciplines-design.md`

## Global Constraints

- **Scope is `SimulateResult` only.** `Calculator`, `Compare` and `ScoreVsHeightChart` keep importing the high-jump-only `scoring_table.json`. Do not touch them. Their existing tests passing untouched is the check that the high-jump path did not move.
- **Never hand-edit generated files.** `src/data/scoring_tables.json` and everything under `src/data/scoring/` are generated. Regenerate via the pipeline.
- **Marks are compared by parsing, never as strings.** Use `parseMark` / `formatMark` from `src/engine/mark.ts`.
- **Decompose and compose marks with integer arithmetic** on a hundredths-scaled value. `2.30 - 2` is `0.2999999999999998` in floating point; `Math.round(2.3 * 100) % 100` is `30`.
- **Baseline to protect:** 452 tests pass, `npx tsc -b` exits 0, `python pipeline/verify.py` exits 0, `python pipeline/verify_rules.py` exits 0. No task may regress these.
- **Wind:** World Athletics adjusts scores for wind in `100m`, `200m`, `110mh`, `100mh`, `long-jump`, `triple-jump`. That adjustment is not in these tables. Never "fix" a wind discrepancy by changing the tables.

## File Structure

| File | Responsibility |
|---|---|
| `pipeline/split_scoring.py` | **Create.** Split `scoring_tables.json` into 36 per-group chunks |
| `pipeline/verify.py` | **Modify.** Assert the chunks match their source |
| `pipeline/README.md` | **Modify.** Document the new pipeline step and its order |
| `src/data/scoring/*.json` | **Create (generated).** 36 chunks, ~8 kB gzipped each |
| `src/engine/scoring.ts` | **Create.** `loadScoringTable`, `markPoints`, `markNearestScore` |
| `src/engine/scoring.test.ts` | **Create.** Oracle port + unit tests |
| `src/engine/markWheels.ts` | **Create.** `decompose`, `compose`, `wheelsFor`, `snapSelection` |
| `src/engine/markWheels.test.ts` | **Create.** Cascade tests |
| `src/components/inputs/MarkSelect.tsx` | **Create.** N `WheelPicker`s from the cascade |
| `src/engine/simulate.ts` | **Modify.** Group-aware `resultScoreFor`, `placingPointsFor`, `countingResults` |
| `src/engine/simulate.test.ts` | **Modify.** Cover the placing-table switch |
| `src/components/SimulateResult.tsx` | **Modify.** `group` prop, async table load, `MarkSelect` |
| `src/components/SimulateResult.test.tsx` | **Create.** Component behaviour on a non-high-jump group |
| `src/components/AthleteLookup.tsx` | **Modify.** Remove the `hasScoringTable` gate |
| `src/engine/marks.ts` | **Modify.** Delete `hasScoringTable` |

---

### Task 1: Split the scoring tables into per-group chunks

**Files:**
- Create: `pipeline/split_scoring.py`
- Create (generated): `src/data/scoring/<slug>-<gender>.json` × 36
- Modify: `pipeline/verify.py`
- Modify: `pipeline/README.md`

**Interfaces:**
- Consumes: `src/data/scoring_tables.json`, shape `{ events: { men|women: { slug: { column, marks: { markString: points } } } } }`
- Produces: one file per group at `src/data/scoring/<slug>-<gender>.json`, shape:
  ```json
  {
    "generated_by": "pipeline/split_scoring.py",
    "slug": "high-jump",
    "gender": "men",
    "column": "High Jump",
    "marks": { "2.54": 1400, "2.53": 1396 }
  }
  ```

- [ ] **Step 1: Write the splitter**

Create `pipeline/split_scoring.py`:

```python
"""Split the combined scoring tables into one file per event group.

scoring_tables.json is 1.1 MB. The app only ever needs one group at a time, so the
frontend loads these chunks on demand instead (src/engine/scoring.ts). Run this after
parse_scoring.py; verify.py checks the two agree.
"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src" / "data" / "scoring_tables.json"
OUT_DIR = ROOT / "src" / "data" / "scoring"


def chunks(source: dict) -> dict[str, dict]:
    """Every group's chunk, keyed by output filename stem."""
    out = {}
    for gender, groups in source["events"].items():
        for slug, table in groups.items():
            out[f"{slug}-{gender}"] = {
                "generated_by": "pipeline/split_scoring.py",
                "slug": slug,
                "gender": gender,
                "column": table["column"],
                "marks": table["marks"],
            }
    return out


def main() -> None:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    written = chunks(source)

    # Rewrite from scratch, so a group dropped upstream cannot linger as a stale file
    # that verify.py would then happily check against nothing.
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True)

    for stem, chunk in written.items():
        path = OUT_DIR / f"{stem}.json"
        path.write_text(json.dumps(chunk, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Wrote {len(written)} scoring-table chunks to {OUT_DIR.relative_to(ROOT)}.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it**

```bash
python pipeline/split_scoring.py
```

Expected: `Wrote 36 scoring-table chunks to src/data/scoring.`

- [ ] **Step 3: Add the verify check**

In `pipeline/verify.py`, add near the other verify functions:

```python
SPLIT_DIR = ROOT / "src" / "data" / "scoring"


def verify_split(events: dict) -> list[str]:
    """The per-group chunks must reproduce the combined file exactly.

    They are what the app actually loads, so a stale chunk would score marks off an
    old table while every other check still passed.
    """
    if not SPLIT_DIR.is_dir():
        return [f"split chunks not found at {SPLIT_DIR} — run pipeline/split_scoring.py"]

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
                errors.append(f"split chunk {slug}-{gender} disagrees with scoring_tables.json")
    return errors
```

Wire it into `main()`, after the existing `verify_anchors` call:

```python
    errors += verify_split(events)
```

- [ ] **Step 4: Verify it catches a stale chunk**

```bash
python pipeline/verify.py
```
Expected: exit 0.

Now prove the check works rather than assuming it:

```bash
python -c "
import json,pathlib
p = pathlib.Path('src/data/scoring/high-jump-men.json')
d = json.loads(p.read_text())
d['marks']['2.54'] = 1
p.write_text(json.dumps(d, indent=1) + '\n')
"
python pipeline/verify.py
```
Expected: exit 1, with `split chunk high-jump-men disagrees with scoring_tables.json`.

Restore, and confirm green again:
```bash
python pipeline/split_scoring.py && python pipeline/verify.py
```
Expected: exit 0.

- [ ] **Step 5: Document the pipeline order**

In `pipeline/README.md`, add `split_scoring.py` to the step list immediately after `parse_scoring.py`, noting that `parse_scoring.py` must always be followed by `split_scoring.py` or the chunks go stale, and that `verify.py` catches it.

- [ ] **Step 6: Commit**

```bash
git add pipeline/split_scoring.py pipeline/verify.py pipeline/README.md src/data/scoring
git commit -m "feat(scoring): split the scoring tables into per-group chunks"
```

---

### Task 2: The lookup engine

**Files:**
- Create: `src/engine/scoring.ts`
- Create: `src/engine/scoring.test.ts`

**Interfaces:**
- Consumes: `src/data/scoring/*.json` (Task 1), `parseMark` from `./mark`, `EventGroup` / `MarkSpec` from `../data/events`
- Produces:
  ```ts
  export interface ScoringRow { value: number; points: number }
  export interface ParsedTable {
    slug: string; gender: Gender; column: string; spec: MarkSpec; rows: ScoringRow[];
  }
  export function markPoints(table: ParsedTable, value: number): number
  export function markNearestScore(table: ParsedTable, score: number): number
  export function loadScoringTable(group: EventGroup): Promise<ParsedTable>
  export function parseScoringTable(group: EventGroup, raw: RawScoringChunk): ParsedTable
  ```

- [ ] **Step 1: Write the failing test**

Create `src/engine/scoring.test.ts`:

```ts
/**
 * The oracle here is the same one pipeline/verify.py runs: every counting result World
 * Athletics itself published in the captured fixtures, scored against these tables.
 * That covers all 36 groups with real data, which no hand-written expectation would.
 */
import { describe, expect, it } from 'vitest';
import { findEventGroup } from '../data/events';
import { parseMark } from './mark';
import { markNearestScore, markPoints, parseScoringTable } from './scoring';
import type { ParsedTable } from './scoring';

const chunks = import.meta.glob('../data/scoring/*.json', { eager: true }) as Record<
  string,
  { default: { slug: string; gender: 'men' | 'women'; column: string; marks: Record<string, number> } }
>;

function tableFor(slug: string, gender: 'men' | 'women'): ParsedTable {
  const group = findEventGroup(slug, gender);
  if (!group) throw new Error(`no event group ${slug} ${gender}`);
  const chunk = chunks[`../data/scoring/${slug}-${gender}.json`];
  if (!chunk) throw new Error(`no scoring chunk ${slug}-${gender}`);
  return parseScoringTable(group, chunk.default);
}

describe('markPoints', () => {
  it('scores an exactly listed mark', () => {
    // 2.30 m is a listed high jump mark.
    const table = tableFor('high-jump', 'men');
    expect(markPoints(table, 2.3)).toBeGreaterThan(0);
  });

  it('takes the lower score when a mark falls between two rows', () => {
    const table = tableFor('high-jump', 'men');
    // A jump of 2.305 clears 2.30 but not 2.31, so it scores exactly what 2.30 scores.
    expect(markPoints(table, 2.305)).toBe(markPoints(table, 2.3));
    expect(markPoints(table, 2.305)).toBeLessThan(markPoints(table, 2.31));
  });

  it('takes the lower score for a timed event, where faster is better', () => {
    const table = tableFor('100m', 'men');
    // 9.865 is slower than 9.86, so it can only earn what 9.87 earns.
    expect(markPoints(table, 9.865)).toBe(markPoints(table, 9.87));
    expect(markPoints(table, 9.865)).toBeLessThan(markPoints(table, 9.86));
  });

  it('saturates above the table and floors below it', () => {
    const table = tableFor('high-jump', 'men');
    expect(markPoints(table, 9)).toBe(1400);
    expect(markPoints(table, 0.1)).toBe(0);
  });
});

describe('markNearestScore', () => {
  it('returns the mark whose points sit closest to a score', () => {
    const table = tableFor('high-jump', 'men');
    const mark = markNearestScore(table, 1149);
    expect(Math.abs(markPoints(table, mark) - 1149)).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/engine/scoring.test.ts`
Expected: FAIL — cannot resolve `./scoring`.

- [ ] **Step 3: Implement**

Create `src/engine/scoring.ts`:

```ts
/**
 * Turning a mark into performance points, for every event group.
 *
 * Lookup is NOT an exact match. The book lists 1400 scores per event, which for a long
 * event is far fewer rows than there are possible marks. Its rule — "should a performance
 * fall between two results on the tables the lower score shall be considered" — means a
 * mark earns the best score whose listed mark it actually reaches. pipeline/verify.py's
 * score_for() is the reference implementation and the two are checked against the same
 * World Athletics fixtures.
 *
 * The tables are 1.1 MB combined, so they ship as per-group chunks (pipeline/split_scoring.py)
 * loaded on demand. Nothing here is on the first-paint path.
 */
import type { Gender } from '../data/types';
import type { EventGroup, MarkSpec } from '../data/events';
import { parseMark } from './mark';

export interface ScoringRow {
  /** The listed mark, parsed: metres for a field event, seconds for a timed one. */
  value: number;
  points: number;
}

export interface ParsedTable {
  slug: string;
  gender: Gender;
  /** The header cell the marks were read from, kept so a mis-attributed column shows. */
  column: string;
  spec: MarkSpec;
  /** Best mark first. markWheels relies on this order. */
  rows: ScoringRow[];
}

export interface RawScoringChunk {
  slug: string;
  gender: string;
  column: string;
  marks: Record<string, number>;
}

/** Parse a chunk's mark strings once, so no string parsing happens on the render path. */
export function parseScoringTable(group: EventGroup, raw: RawScoringChunk): ParsedTable {
  const rows: ScoringRow[] = [];
  for (const [mark, points] of Object.entries(raw.marks)) {
    const value = parseMark(mark, group.mark);
    if (value === null) continue;
    rows.push({ value, points });
  }
  rows.sort((a, b) => (group.mark.betterIsHigher ? b.value - a.value : a.value - b.value));
  return { slug: group.slug, gender: group.gender, column: raw.column, spec: group.mark, rows };
}

/**
 * The points a mark earns: the highest score whose listed mark the performance reaches.
 * A mark better than every row saturates at the top score; one worse than every row is 0.
 */
export function markPoints(table: ParsedTable, value: number): number {
  let best = 0;
  for (const row of table.rows) {
    const reaches = table.spec.betterIsHigher ? value >= row.value : value <= row.value;
    if (reaches && row.points > best) best = row.points;
  }
  return best;
}

/**
 * The listed mark scoring closest to `score`. The simulator opens here, so its wheels
 * start at roughly the athlete's own level in any event rather than at a constant that
 * only ever made sense for the high jump.
 */
export function markNearestScore(table: ParsedTable, score: number): number {
  let best = table.rows[0];
  for (const row of table.rows) {
    if (Math.abs(row.points - score) < Math.abs(best.points - score)) best = row;
  }
  return best.value;
}

const chunks = import.meta.glob('../data/scoring/*.json');
const cache = new Map<string, Promise<ParsedTable>>();

/**
 * The group's table, fetched on demand and memoized per slug+gender so re-renders and
 * repeat lookups of the same group do not re-import.
 */
export function loadScoringTable(group: EventGroup): Promise<ParsedTable> {
  const key = `${group.slug}-${group.gender}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const load = chunks[`../data/scoring/${key}.json`];
  if (!load) return Promise.reject(new Error(`No scoring table for ${key}`));

  const pending = load()
    .then((mod) => parseScoringTable(group, (mod as { default: RawScoringChunk }).default))
    // Don't cache a rejection — a transient chunk fetch failure must be retryable.
    .catch((err) => {
      cache.delete(key);
      throw err;
    });
  cache.set(key, pending);
  return pending;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/engine/scoring.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the oracle test**

Append to `src/engine/scoring.test.ts`:

```ts
/**
 * Mirrors verify_oracle() in pipeline/verify.py, which reports:
 *   "152 captured World Athletics results reproduced exactly,
 *    20 wind-affected results differ by the wind adjustment."
 *
 * Only rows for the group's MAIN discipline are checked. A group covers similar events
 * too — the 100m group counts a 60m result — but those score off their own column in the
 * book, which is not in these tables.
 */
const MAIN_DISCIPLINE: Record<string, string> = {
  '100m': '100 Metres', '200m': '200 Metres', '400m': '400 Metres', '800m': '800 Metres',
  '1500m': '1500 Metres', '5000m': '5000 Metres', '10000m': '10,000 Metres',
  '110mh': '110 Metres Hurdles', '100mh': '100 Metres Hurdles',
  '400mh': '400 Metres Hurdles', '3000msc': '3000 Metres Steeplechase',
  'high-jump': 'High Jump', 'pole-vault': 'Pole Vault', 'long-jump': 'Long Jump',
  'triple-jump': 'Triple Jump', 'shot-put': 'Shot Put', 'discus-throw': 'Discus Throw',
  'hammer-throw': 'Hammer Throw', 'javelin-throw': 'Javelin Throw',
};

/** World Athletics adjusts these events' scores for wind; the tables carry no wind. */
const WIND_AFFECTED = new Set(['100m', '200m', '110mh', '100mh', 'long-jump', 'triple-jump']);

interface OracleFixture {
  group: { slug: string; gender: 'men' | 'women' };
  calculation: { results: Array<{ discipline: string; mark: string; resultScore: number }> };
  results: Array<{ date: string; discipline: string; mark: string; notLegal: boolean }>;
}

const oracle = import.meta.glob('./__fixtures__/oracle/*.json', { eager: true }) as Record<
  string,
  { default: OracleFixture }
>;

describe('markPoints against World Athletics fixtures', () => {
  const fixtures = Object.values(oracle).map((m) => m.default);

  // A wind-aided mark carries a wind adjustment, so it is allowed to differ wherever it
  // appears. Keyed the way verify.py keys it.
  const windAided = new Set<string>();
  for (const f of fixtures) {
    for (const row of f.results ?? []) {
      if (row.notLegal) windAided.add(`${row.date}|${String(row.mark).trim()}|${row.discipline}`);
    }
  }

  let exact = 0;
  let windDiffs = 0;
  const mismatches: string[] = [];

  for (const f of fixtures) {
    if (!f.group) continue;
    const { slug, gender } = f.group;
    const group = findEventGroup(slug, gender);
    if (!group || !chunks[`../data/scoring/${slug}-${gender}.json`]) continue;
    const table = tableFor(slug, gender);

    for (const row of f.calculation?.results ?? []) {
      if (row.discipline !== MAIN_DISCIPLINE[slug]) continue;
      if (row.resultScore == null) continue;
      const mark = String(row.mark).trim();
      const value = parseMark(mark, group.mark);
      if (value === null) continue;
      const got = markPoints(table, value);
      if (got === row.resultScore) exact++;
      else if (WIND_AFFECTED.has(slug)) windDiffs++;
      else mismatches.push(`${gender} ${slug} ${mark}: WA scored ${row.resultScore}, tables give ${got}`);
    }
  }

  it('reproduces every non-wind-affected result exactly', () => {
    expect(mismatches).toEqual([]);
  });

  it('checks a meaningful number of results, so the tolerance cannot widen unnoticed', () => {
    // verify.py reports 152 exact / 20 wind-affected. Refreshing fixtures moves these,
    // but a collapse toward zero means the filter above stopped matching anything.
    expect(exact).toBeGreaterThanOrEqual(140);
    expect(windDiffs).toBeLessThanOrEqual(40);
    expect(windAided.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Run it**

Run: `npx vitest run src/engine/scoring.test.ts`
Expected: PASS. If `mismatches` is non-empty, the TS port disagrees with `score_for()` — compare against `pipeline/verify.py:161` rather than adjusting the expectation.

- [ ] **Step 7: Commit**

```bash
git add src/engine/scoring.ts src/engine/scoring.test.ts
git commit -m "feat(scoring): score a mark in any event group"
```

---

### Task 3: The wheel cascade

**Files:**
- Create: `src/engine/markWheels.ts`
- Create: `src/engine/markWheels.test.ts`

**Interfaces:**
- Consumes: `ParsedTable` from `./scoring` (Task 2), `MarkSpec` from `../data/events`
- Produces:
  ```ts
  export interface Wheel { key: string; label: string; pad: number; options: number[]; hidden: boolean }
  export function decompose(value: number, spec: MarkSpec): number[]
  export function compose(groups: number[], spec: MarkSpec): number
  export function wheelsFor(table: ParsedTable, selection: number[]): Wheel[]
  export function snapSelection(table: ParsedTable, selection: number[]): number[]
  ```

- [ ] **Step 1: Write the failing test**

Create `src/engine/markWheels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findEventGroup } from '../data/events';
import { parseScoringTable, type ParsedTable } from './scoring';
import { compose, decompose, snapSelection, wheelsFor } from './markWheels';

const chunks = import.meta.glob('../data/scoring/*.json', { eager: true }) as Record<
  string,
  { default: { slug: string; gender: string; column: string; marks: Record<string, number> } }
>;

function tableFor(slug: string, gender: 'men' | 'women'): ParsedTable {
  const group = findEventGroup(slug, gender)!;
  return parseScoringTable(group, chunks[`../data/scoring/${slug}-${gender}.json`].default);
}

const HEIGHT = findEventGroup('high-jump', 'men')!.mark;
const TIME = findEventGroup('400m', 'men')!.mark;

describe('decompose / compose', () => {
  it('splits a height into metres and centimetres without float drift', () => {
    expect(decompose(2.3, HEIGHT)).toEqual([2, 30]);
    expect(decompose(2.05, HEIGHT)).toEqual([2, 5]);
  });

  it('splits a time into minutes, seconds and hundredths', () => {
    // 26:45.49 is 1605.49 seconds.
    expect(decompose(1605.49, TIME)).toEqual([26, 45, 49]);
    expect(decompose(9.87, TIME)).toEqual([0, 9, 87]);
  });

  it('round-trips', () => {
    expect(compose(decompose(2.3, HEIGHT), HEIGHT)).toBeCloseTo(2.3, 5);
    expect(compose(decompose(1605.49, TIME), TIME)).toBeCloseTo(1605.49, 5);
    expect(compose(decompose(9.87, TIME), TIME)).toBeCloseTo(9.87, 5);
  });
});

describe('wheelsFor', () => {
  it('hides a wheel with only one possible value', () => {
    // The 100m men table runs 9.46 to 16.79 — never a whole minute.
    const wheels = wheelsFor(tableFor('100m', 'men'), [0, 10, 0]);
    expect(wheels.filter((w) => !w.hidden)).toHaveLength(2);
    expect(wheels[0].hidden).toBe(true);
  });

  it('keeps the minutes wheel where the table crosses a minute', () => {
    // The 400m men table runs 41.97 to 1:18.01.
    const wheels = wheelsFor(tableFor('400m', 'men'), [0, 45, 0]);
    expect(wheels.filter((w) => !w.hidden)).toHaveLength(3);
    expect(wheels[0].options).toEqual([0, 1]);
  });

  it('restricts a lower wheel to values that exist under the current selection', () => {
    // High jump men tops out at 2.54, so with metres = 2 no centimetre above 54 exists.
    const wheels = wheelsFor(tableFor('high-jump', 'men'), [2, 30]);
    const cm = wheels[1].options;
    expect(Math.max(...cm)).toBeLessThanOrEqual(54);
    expect(cm).toContain(30);
  });

  it('offers every combination as a real listed mark', () => {
    const table = tableFor('high-jump', 'men');
    const listed = new Set(table.rows.map((r) => Math.round(r.value * 100)));
    const wheels = wheelsFor(table, [2, 30]);
    for (const cm of wheels[1].options) {
      expect(listed.has(Math.round(compose([2, cm], table.spec) * 100))).toBe(true);
    }
  });
});

describe('snapSelection', () => {
  it('snaps a now-invalid lower selection to the nearest valid value', () => {
    const table = tableFor('high-jump', 'men');
    // 2.99 does not exist; with metres = 2 the highest centimetre is 54.
    const snapped = snapSelection(table, [2, 99]);
    expect(snapped[0]).toBe(2);
    expect(snapped[1]).toBeLessThanOrEqual(54);
  });

  it('leaves a valid selection alone', () => {
    const table = tableFor('high-jump', 'men');
    expect(snapSelection(table, [2, 30])).toEqual([2, 30]);
  });

  it('always yields a listed mark', () => {
    const table = tableFor('400m', 'men');
    const listed = new Set(table.rows.map((r) => Math.round(r.value * 100)));
    for (const attempt of [[0, 0, 0], [1, 59, 99], [0, 41, 97]]) {
      const snapped = snapSelection(table, attempt);
      expect(listed.has(Math.round(compose(snapped, table.spec) * 100))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/engine/markWheels.test.ts`
Expected: FAIL — cannot resolve `./markWheels`.

- [ ] **Step 3: Implement**

Create `src/engine/markWheels.ts`:

```ts
/**
 * A mark, split into the digit groups a picker can spin.
 *
 * One wheel per mark does not survive the jump from high jump's 163 listed marks to a
 * 10,000m's 1400. Splitting a mark into its natural digit groups turns one very deep
 * wheel into two or three shallow ones: metres and centimetres for a field event,
 * minutes, seconds and hundredths for a timed one.
 *
 * The wheels CASCADE: each one offers only the values that actually occur in the table
 * given the wheels above it. Every reachable combination is therefore a mark the book
 * really lists, so there is no invalid state and no dialling in a 2.99 m high jump.
 *
 * All arithmetic is on hundredths-scaled integers. `2.30 - 2` is 0.2999999999999998 in
 * floating point, which would decompose to 29 centimetres.
 */
import type { MarkSpec } from '../data/events';
import type { ParsedTable } from './scoring';

export interface Wheel {
  key: string;
  label: string;
  /** Digits to zero-pad the option label to. 0 means no padding. */
  pad: number;
  /** Ascending. Always contains the current selection for this position. */
  options: number[];
  /** True when only one value is possible across the whole table, so it need not render. */
  hidden: boolean;
}

interface GroupSpec {
  key: string;
  label: string;
  pad: number;
  /** How many hundredths one unit of this group is worth. */
  scale: number;
  /** Modulus applied after dividing by scale, or null for the leading group. */
  modulus: number | null;
}

const FIELD_GROUPS: GroupSpec[] = [
  { key: 'metres', label: 'm', pad: 0, scale: 100, modulus: null },
  { key: 'centimetres', label: 'cm', pad: 2, scale: 1, modulus: 100 },
];

const TIME_GROUPS: GroupSpec[] = [
  { key: 'minutes', label: 'min', pad: 0, scale: 6000, modulus: null },
  { key: 'seconds', label: 'sec', pad: 2, scale: 100, modulus: 60 },
  { key: 'hundredths', label: '.00', pad: 2, scale: 1, modulus: 100 },
];

function groupsFor(spec: MarkSpec): GroupSpec[] {
  return spec.kind === 'time' ? TIME_GROUPS : FIELD_GROUPS;
}

/** A mark value to its digit groups, most significant first. */
export function decompose(value: number, spec: MarkSpec): number[] {
  const hundredths = Math.round(value * 100);
  return groupsFor(spec).map((g) => {
    const raw = Math.floor(hundredths / g.scale);
    return g.modulus === null ? raw : raw % g.modulus;
  });
}

/** Digit groups back to a mark value. The inverse of decompose. */
export function compose(groups: number[], spec: MarkSpec): number {
  const specs = groupsFor(spec);
  let hundredths = 0;
  for (let i = 0; i < specs.length; i++) hundredths += (groups[i] ?? 0) * specs[i].scale;
  return hundredths / 100;
}

/** Every listed mark, decomposed once. */
function rowGroups(table: ParsedTable): number[][] {
  return table.rows.map((r) => decompose(r.value, table.spec));
}

/**
 * The wheels for the current selection. Wheel `i`'s options are the distinct values at
 * position `i` among the marks whose positions `0..i-1` match the selection.
 *
 * `hidden` is decided across the WHOLE table, not the filtered subset, so a wheel cannot
 * appear and disappear as the user spins the one above it.
 */
export function wheelsFor(table: ParsedTable, selection: number[]): Wheel[] {
  const specs = groupsFor(table.spec);
  const all = rowGroups(table);

  return specs.map((g, i) => {
    const matching = all.filter((groups) =>
      selection.slice(0, i).every((sel, j) => groups[j] === sel),
    );
    const options = [...new Set(matching.map((groups) => groups[i]))].sort((a, b) => a - b);
    const distinctOverall = new Set(all.map((groups) => groups[i])).size;
    return { key: g.key, label: g.label, pad: g.pad, options, hidden: distinctOverall <= 1 };
  });
}

function nearest(options: number[], want: number): number {
  return options.reduce((best, o) => (Math.abs(o - want) < Math.abs(best - want) ? o : best), options[0]);
}

/**
 * Make a selection valid, left to right. Moving a higher wheel can strand the ones below
 * it — with metres at 2, a high jump has no centimetre above 54 — so each stranded value
 * snaps to the NEAREST still-valid one. Nearest rather than first, so a nudge keeps you at
 * a comparable mark instead of jumping to the extreme of the new range.
 */
export function snapSelection(table: ParsedTable, selection: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < groupsFor(table.spec).length; i++) {
    const options = wheelsFor(table, out)[i].options;
    out.push(options.includes(selection[i]) ? selection[i] : nearest(options, selection[i] ?? 0));
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/engine/markWheels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/markWheels.ts src/engine/markWheels.test.ts
git commit -m "feat(scoring): cascade a mark into spinnable digit groups"
```

---

### Task 4: The mark picker

**Files:**
- Create: `src/components/inputs/MarkSelect.tsx`

**Interfaces:**
- Consumes: `wheelsFor`, `snapSelection`, `decompose`, `compose` (Task 3); `ParsedTable` (Task 2); `WheelPicker` from `./WheelPicker`; `formatMark` from `../../engine/mark`
- Produces:
  ```tsx
  export function MarkSelect(props: {
    table: ParsedTable; value: number; onChange: (mark: number) => void; rows?: number;
  }): JSX.Element
  ```

- [ ] **Step 1: Implement**

Create `src/components/inputs/MarkSelect.tsx`:

```tsx
import { WheelPicker, type WheelOption } from './WheelPicker';
import { compose, decompose, snapSelection, wheelsFor } from '../../engine/markWheels';
import { formatMark } from '../../engine/mark';
import type { ParsedTable } from '../../engine/scoring';

/**
 * A mark picker for any event group: one wheel per digit group, cascading so every
 * reachable combination is a mark the book actually lists. Replaces HeightSelect in the
 * simulator; HeightSelect stays for the high-jump-only Calculator and Compare.
 */
export function MarkSelect({
  table,
  value,
  onChange,
  rows,
}: {
  table: ParsedTable;
  value: number;
  onChange: (mark: number) => void;
  rows?: number;
}) {
  const selection = decompose(value, table.spec);
  const wheels = wheelsFor(table, selection);

  function handle(index: number, next: number) {
    const wanted = [...selection];
    wanted[index] = next;
    // Everything below the moved wheel may now be stranded; snap it back onto the table.
    onChange(compose(snapSelection(table, wanted), table.spec));
  }

  return (
    <div className="field mark-select">
      <span>Mark</span>
      <div className="mark-wheels">
        {wheels.map((wheel, i) =>
          wheel.hidden ? null : (
            <WheelPicker
              key={wheel.key}
              options={wheel.options.map<WheelOption>((o) => ({
                value: o,
                label: wheel.pad ? String(o).padStart(wheel.pad, '0') : String(o),
              }))}
              value={selection[i]}
              onChange={(next) => handle(i, next)}
              ariaLabel={wheel.key}
              rows={rows}
            />
          ),
        )}
      </div>
      {/* The wheels show digit groups; this is the mark they add up to, written the way
          the feeds write it. It is also the only place a time over an hour reads
          correctly — the minutes wheel counts total minutes, so a 1:13:43 shows 73. */}
      <output className="mark-readout">{formatMark(value, table.spec)}</output>
    </div>
  );
}
```

- [ ] **Step 2: Add styling**

In `src/styles.css`, alongside the existing `.field` rules, add:

```css
.mark-select .mark-wheels {
  display: flex;
  gap: 6px;
  align-items: center;
}

.mark-select .mark-readout {
  display: block;
  margin-top: 4px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/inputs/MarkSelect.tsx src/styles.css
git commit -m "feat(ui): a mark picker that works for every event group"
```

---

### Task 5: Score a simulated result for its own group

**Files:**
- Modify: `src/engine/simulate.ts:1-18`
- Modify: `src/engine/simulate.test.ts`

**Interfaces:**
- Consumes: `markPoints`, `ParsedTable` (Task 2); `placingPointsFor` from `./placing`; `EventGroup` from `../data/events`
- Produces:
  ```ts
  export function resultScoreFor(
    group: EventGroup, table: ParsedTable, mark: number, category: CategoryCode, place: number,
  ): number
  export function recomputeRanking(base: number[], simScore: number, countingResults: number): Recompute
  ```

- [ ] **Step 1: Write the failing test**

Add to `src/engine/simulate.test.ts`:

```ts
import { findEventGroup } from '../data/events';
import { parseScoringTable, type ParsedTable } from './scoring';

const chunks = import.meta.glob('../data/scoring/*.json', { eager: true }) as Record<
  string,
  { default: { slug: string; gender: string; column: string; marks: Record<string, number> } }
>;

function tableFor(slug: string, gender: 'men' | 'women'): ParsedTable {
  const group = findEventGroup(slug, gender)!;
  return parseScoringTable(group, chunks[`../data/scoring/${slug}-${gender}.json`].default);
}

describe('resultScoreFor uses the group\'s own placing table', () => {
  it('scores a high jump final off Table 2.2', () => {
    const group = findEventGroup('high-jump', 'men')!;
    const table = tableFor('high-jump', 'men');
    // Table 2.2 awards 100 for winning a category A final.
    const marksOnly = markPoints(table, 2.3);
    expect(resultScoreFor(group, table, 2.3, 'A', 1) - marksOnly).toBe(100);
  });

  it('scores a 10,000m final off Table 2.9, not Table 2.2', () => {
    // This is the whole reason the simulator switched off placing_points.json. Winning a
    // category A final is worth 100 under Table 2.2 but only 56 under Table 2.9, so
    // scoring a 10,000m against 2.2 would inflate it by 44 points.
    const group = findEventGroup('10000m', 'men')!;
    const table = tableFor('10000m', 'men');
    const marksOnly = markPoints(table, 1600); // 26:40
    expect(resultScoreFor(group, table, 1600, 'A', 1) - marksOnly).toBe(56);
  });

  it('does not fall through to the 10km road table', () => {
    // group.mainEvent is "10,000m", a Table 2.12 short label. The byDiscipline override
    // key is "10 Kilometres Road", a feed long-name. They never match, so the group's own
    // final table applies — which is right, but only by accident. Pin it: Table 2.10
    // would award 21 for the same win.
    const group = findEventGroup('10000m', 'men')!;
    const road = placingPointsFor({
      group, discipline: '10 Kilometres Road', category: 'A', round: 'final',
      place: 1, advanced: false,
    });
    expect(road).toBe(21);
    expect(placingPointsFor({
      group, discipline: group.mainEvent, category: 'A', round: 'final',
      place: 1, advanced: false,
    })).toBe(56);
  });

  it('scores a 5000m final off Table 2.5', () => {
    const group = findEventGroup('5000m', 'men')!;
    const table = tableFor('5000m', 'men');
    const marksOnly = markPoints(table, 780); // 13:00
    expect(resultScoreFor(group, table, 780, 'A', 1) - marksOnly).toBe(70);
  });
});

describe('recomputeRanking honours the group\'s counting count', () => {
  it('averages the best N', () => {
    const { newScore } = recomputeRanking([100, 200, 300, 400, 500], 600, 5);
    expect(newScore).toBe(400); // 600+500+400+300+200 = 2000 / 5
  });
});
```

Add the imports `markPoints` from `./scoring` and `placingPointsFor` from `./placing` at the top of the file.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/engine/simulate.test.ts`
Expected: FAIL — `resultScoreFor` has the old signature.

- [ ] **Step 3: Implement**

In `src/engine/simulate.ts`, replace lines 1-18 (the imports, `COUNTING_RESULTS` and `resultScoreFor`) with:

```ts
import type { CategoryCode, CountryScore } from '../data/types';
import type { EventGroup } from '../data/events';
import { markPoints, type ParsedTable } from './scoring';
import { placingPointsFor } from './placing';

/**
 * Combined counting score of one simulated result: mark points + placing points.
 *
 * Placing comes from placingPointsFor rather than the Table-2.2-only placing_points.json,
 * because Track & Field is not one placing table: the 5000m and 3000mSC groups score
 * finals off Table 2.5 and the 10,000m group off Table 2.9. Simulating those against 2.2
 * would be silently wrong.
 *
 * The simulator always asks "what if I place Nth in this competition", which is a final,
 * so `round` is fixed and `advanced` is irrelevant. `discipline` is the group's main event
 * — deliberately not a feed long-name, so it never matches a byDiscipline override and the
 * group's own final table applies.
 */
export function resultScoreFor(
  group: EventGroup,
  table: ParsedTable,
  mark: number,
  category: CategoryCode,
  place: number,
): number {
  return (
    markPoints(table, mark) +
    placingPointsFor({
      group,
      discipline: group.mainEvent,
      category,
      round: 'final',
      place,
      advanced: false,
    })
  );
}
```

Then change `recomputeRanking` to take the count rather than read a module constant:

```ts
export function recomputeRanking(
  base: number[],
  simScore: number,
  countingResults: number,
): Recompute {
  const keepCount = Math.min(countingResults, base.length + 1);
  const kept = [...base, simScore].sort((a, b) => b - a).slice(0, keepCount);
  const newScore = Math.floor(kept.reduce((sum, s) => sum + s, 0) / kept.length);
  const atCapacity = base.length >= countingResults;
  const min = base.length ? Math.min(...base) : -Infinity;
  const counts = !atCapacity || simScore > min;
  return { newScore, counts, dropped: counts && atCapacity ? min : null };
}
```

Delete the `COUNTING_RESULTS` export and the now-unused `Gender`, `placingPoints`, `scoringTable`, `performanceScore` and `placingScore` imports. Leave `MAX_PER_COUNTRY` and everything below it untouched.

- [ ] **Step 4: Update the existing call sites**

Adding a required third parameter breaks every current caller. There are exactly four, and
none of them should change behaviour — every Track & Field group counts 5:

- `src/engine/simulate.test.ts:17` — `recomputeRanking(BASE, 1450)` → `recomputeRanking(BASE, 1450, 5)`
- `src/engine/simulate.test.ts:25` — `recomputeRanking(BASE, 1000)` → `recomputeRanking(BASE, 1000, 5)`
- `src/engine/simulate.test.ts:32` — `recomputeRanking([1200, 1100, 1000], 1300)` → add `, 5`
- `src/components/SimulateResult.tsx:80` — handled in Task 6

Their existing expected values (1391, and the unchanged-ranking case) must stay exactly as
they are. If one moves, the refactor changed behaviour and is wrong.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/engine/simulate.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/simulate.ts src/engine/simulate.test.ts
git commit -m "fix(simulate): score a simulated result off its own group's placing table"
```

---

### Task 6: Wire the simulator to its group

**Files:**
- Modify: `src/components/SimulateResult.tsx`
- Create: `src/components/SimulateResult.test.tsx`

**Interfaces:**
- Consumes: `loadScoringTable`, `markNearestScore` (Task 2); `MarkSelect` (Task 4); `resultScoreFor`, `recomputeRanking` (Task 5)
- Produces: `SimulateResult` gains a required `group: EventGroup` prop and drops `gender` (it is `group.gender`).

- [ ] **Step 1: Write the failing test**

Create `src/components/SimulateResult.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { findEventGroup } from '../data/events';
import { SimulateResult } from './SimulateResult';

function renderFor(slug: string) {
  const group = findEventGroup(slug, 'men')!;
  return render(
    <SimulateResult
      group={group}
      baseScores={[1100, 1090, 1080, 1070, 1060]}
      currentScore={1080}
      currentPlace={10}
      peerScores={[1200, 1150, 1100]}
      rankingType="european"
    />,
  );
}

describe('SimulateResult', () => {
  it('scores a mark in a track event, which the old gate blocked entirely', async () => {
    renderFor('10000m');
    await waitFor(() => expect(screen.getByTestId('sim-score')).toBeInTheDocument());
    expect(Number(screen.getByTestId('sim-score').textContent)).toBeGreaterThan(0);
  });

  it('renders a minutes wheel for a track event and none for high jump', async () => {
    const { unmount } = renderFor('10000m');
    await waitFor(() => expect(screen.getByLabelText('minutes')).toBeInTheDocument());
    unmount();

    renderFor('high-jump');
    await waitFor(() => expect(screen.getByLabelText('metres')).toBeInTheDocument());
    expect(screen.queryByLabelText('minutes')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/SimulateResult.test.tsx`
Expected: FAIL — `SimulateResult` has no `group` prop.

- [ ] **Step 3: Implement**

In `src/components/SimulateResult.tsx`:

Replace the imports of `categories, scoringTable` / `availableMarks, defaultHeightFor` / `HeightSelect` with:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { categories } from '../engine/data';
import type { EventGroup } from '../data/events';
import { loadScoringTable, markNearestScore, type ParsedTable } from '../engine/scoring';
import { MarkSelect } from './inputs/MarkSelect';
```

Change the signature — `gender` goes, `group` arrives:

```tsx
export function SimulateResult({
  group,
  baseScores,
  currentScore,
  currentPlace,
  peerScores,
  road,
  rankingType,
}: {
  group: EventGroup;
  baseScores: number[];
  currentScore: number;
  currentPlace: number;
  peerScores: number[];
  road?: RoadSimData;
  rankingType: RankingType;
}) {
```

Replace the `marks` / `mark` / `effectiveMark` block with the async load:

```tsx
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mark, setMark] = useState<number | null>(null);
  const [category, setCategory] = useState<CategoryCode>('A');
  const [place, setPlace] = useState(1);

  // Reload whenever the group changes, and ignore a resolve that lands after the user has
  // already moved on — otherwise a slow chunk can overwrite a newer group's table.
  useEffect(() => {
    let live = true;
    setTable(null);
    setLoadFailed(false);
    setMark(null);
    loadScoringTable(group)
      .then((loaded) => {
        if (!live) return;
        setTable(loaded);
        // Open at the athlete's own level rather than a constant that only ever suited
        // the high jump.
        setMark(markNearestScore(loaded, currentScore));
      })
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
    // currentScore is deliberately not a dependency: it should seed the opening mark, not
    // yank the wheels back every time the ranking refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);
```

**Hook ordering matters here and is easy to get wrong.** React forbids calling hooks
conditionally, so the early return for the loading state must sit *below* every `useState`
and `useMemo` in this component. The order in the function body must be exactly:

1. all `useState` calls (`table`, `loadFailed`, `mark`, `category`, `place`)
2. the `useEffect` that loads the table
3. the non-hook derivations (`useBirmingham`, `effBaseScores`, `effCurrentScore`)
4. the `sim` `useMemo` — made null-safe, below
5. `scoreD`
6. the `standing` `useMemo` — already null-safe, it never touches `table`
7. **then** the early returns
8. then the JSX

Make `sim` null-safe so it can run before the guard:

```tsx
  const sim = useMemo(() => {
    if (!table || mark === null) {
      return { simScore: 0, newScore: 0, counts: false, dropped: null as number | null };
    }
    const simScore = resultScoreFor(group, table, mark, category, place);
    const { newScore, counts, dropped } = recomputeRanking(
      effBaseScores, simScore, group.countingResults,
    );
    return { simScore, newScore, counts, dropped };
  }, [group, table, mark, category, place, effBaseScores]);
```

Then the guards, placed after `standing`:

```tsx
  if (loadFailed) {
    return (
      <p className="comps-hint muted" data-testid="sim-load-failed">
        Couldn't load the scoring table for {group.mainEvent}.
      </p>
    );
  }
  if (!table || mark === null) {
    return <p className="comps-hint muted">Loading scoring table…</p>;
  }
```

After the guards, TypeScript narrows `table` to `ParsedTable` and `mark` to `number`, so
the JSX below can use them directly.

Swap the picker in the fields row:

```tsx
        <MarkSelect table={table} value={mark} onChange={setMark} rows={3} />
```

And give the score a test hook in the outcome paragraph:

```tsx
          This result scores <strong data-testid="sim-score">{sim.simScore}</strong> (mark + placing).
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/SimulateResult.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/SimulateResult.tsx src/components/SimulateResult.test.tsx
git commit -m "feat(ui): simulate a result in any event group"
```

---

### Task 7: Remove the gate

**Files:**
- Modify: `src/components/AthleteLookup.tsx:41,43,943-953`
- Modify: `src/engine/marks.ts`
- Modify: `src/engine/marks.test.ts`

**Interfaces:**
- Consumes: `SimulateResult` with its new `group` prop (Task 6)
- Produces: nothing new. `hasScoringTable` ceases to exist.

- [ ] **Step 1: Remove the gate**

In `src/components/AthleteLookup.tsx`, replace the ternary at line 943 and its fallback with the bare component:

```tsx
          <SimulateResult
            group={group}
            baseScores={simBaseScores}
            currentScore={simCurrentScore}
            currentPlace={ranked.row.place}
            peerScores={peerScores}
            road={simRoad}
            rankingType={rankingType}
          />
```

Delete the `hasScoringTable` import (line 43) and the `scoringTable` import (line 41) if nothing else in the file uses it. Delete the comment above the old ternary — it describes a gate that no longer exists.

- [ ] **Step 2: Delete the dead helper**

In `src/engine/marks.ts`, delete `hasScoringTable` and its doc comment. Keep `availableMarks`, `DEFAULT_HEIGHT` and `defaultHeightFor` — `Calculator` and `Compare` still use them. Delete the `EventGroup` import if it is now unused.

In `src/engine/marks.test.ts`, delete any test covering `hasScoringTable`.

- [ ] **Step 3: Fix the gate's own test**

`src/components/AthleteLookup.eventGroup.test.tsx` asserts on `data-testid="no-scoring-table"`. That element is gone. Replace the assertion: selecting a non-high-jump group must now render the simulator, not the "isn't available" message. Await the async table load with `findBy*`.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: PASS, at least 452 tests plus the new ones. Investigate any failure — do not delete a failing assertion to go green.

- [ ] **Step 5: Typecheck and build**

```bash
npx tsc -b
npm run build
```
Expected: both exit 0.

- [ ] **Step 6: Confirm the split actually paid for itself**

The whole reason for Task 1 is that the main bundle must not carry 222 kB gzipped of scoring tables. Assert it rather than assume it:

```bash
ls -la dist/assets/*.js
ls dist/assets/ | grep -c "high-jump\|10000m\|scoring"
```

Expected: the main entry chunk is close to what it was before this work, and the scoring tables appear as many small separate chunks. If the main chunk grew by roughly 200 kB, something imported `scoring_tables.json` or a chunk statically — find it and make it dynamic.

- [ ] **Step 7: Run the Python checks**

```bash
python pipeline/verify.py
python pipeline/verify_rules.py
```
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/components/AthleteLookup.tsx src/engine/marks.ts src/engine/marks.test.ts src/components/AthleteLookup.eventGroup.test.tsx
git commit -m "feat(ui): simulate a result in every event group, not just high jump"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| `pipeline/split_scoring.py` + chunks | 1 |
| `verify.py` split check | 1 |
| `engine/scoring.ts` (`loadScoringTable`, `markPoints`) | 2 |
| Oracle port, 152 exact / wind tolerance on mismatch only | 2 |
| `engine/markWheels.ts` cascade + snap | 3 |
| `inputs/MarkSelect.tsx` | 4 |
| `simulate.ts` placing switch to `placingPointsFor` | 5 |
| `COUNTING_RESULTS` → `group.countingResults` | 5 |
| `SimulateResult` group prop, async load, opening mark | 6 |
| `AthleteLookup` gate removal, `hasScoringTable` deletion | 7 |
| Bundle-size verification | 7, Step 6 |
| All four verification commands | 7, Steps 4–7 |

**Known risk carried from the spec:** `finalFieldSizeFor` (`src/engine/placing.ts:41`) assumes championship track finals take 8 and field finals 12. The simulator always scores a final, and that assumption only affects rounds *before* the final, so it does not bite here. It is the reason not to add a round selector to the simulator without evidence.
