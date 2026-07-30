# Simulating a result in every event group

Design, 2026-07-30. Branch `worktree-scoring-tables`.

`src/data/scoring_tables.json` holds mark-to-points for all 36 Track & Field event groups
and nothing reads it. The simulator inside `AthleteLookup` is still gated to high jump by
`hasScoringTable`. This wires the tables in and removes that gate.

## Scope

**Only `SimulateResult`.** `Calculator` and `Compare` (and `ScoreVsHeightChart` behind it)
keep importing the high-jump-only `scoring_table.json` and are not touched. They have no
event-group picker and giving them one is a separate piece of work.

Out of scope, unchanged from the handoff: overweighting, road running, race walking,
combined events, cross country, and the wind adjustment World Athletics applies to the
100m, 200m, hurdles, long jump and triple jump.

## The lookup rule

Lookup is **not** an exact match. The book lists 1400 scores per event, which for a long
event is far fewer rows than there are possible marks. The rule, stated in the book and
implemented in `score_for()` at `pipeline/verify.py:161`, is:

> Should a performance fall between two results on the tables the lower score shall be
> considered.

So a mark earns the best score whose listed mark it actually reaches — `<=` for timed
events where faster is better, `>=` otherwise. A mark better than every listed row
saturates at the top score; a mark worse than every row scores 0.

## Architecture

Four new modules and four changed files. Each new module has one job and is testable
without the others.

### `pipeline/split_scoring.py` (new)

Reads `src/data/scoring_tables.json`, writes `src/data/scoring/<slug>-<gender>.json` for
each of the 36 groups. Each output file is the group's `{ column, marks }` object plus a
generated-file banner naming this script. About 8 kB gzipped each.

Follows the repo's existing generated-file idiom: `pipeline/README.md` gains the step, and
it runs after `parse_scoring.py`. `verify.py` gains a check that the split files agree
with the source they came from, so a stale split cannot pass silently.

### `src/engine/scoring.ts` (new)

The lookup engine. Two exports:

- `loadScoringTable(group: EventGroup): Promise<ParsedTable>` — resolves the group's chunk
  via `import.meta.glob('../data/scoring/*.json')`, memoized per `slug-gender` so a
  re-render or a second lookup of the same group does not re-import. On resolve it parses
  each mark string once through `parseMark(raw, group.mark)` into `{ value, points }[]`, so
  no string parsing happens on the render path.
- `markPoints(table: ParsedTable, value: number, spec: MarkSpec): number` — the port of
  `score_for()`. Walks the parsed rows and returns the highest `points` whose `value` the
  performance reaches, 0 if none. 1400 rows is a trivial scan; no index is warranted.

`ParsedTable` keeps the rows sorted best-mark-first so `markWheels` can build cascades off
the same array without re-sorting.

### `src/engine/markWheels.ts` (new)

Turns a parsed table into cascading wheel options. Pure, no React.

Marks decompose into digit groups by `MarkSpec.kind`:

| Kind | Groups | Example |
|---|---|---|
| `height`, `distance` | `[metres, centimetres]` | `2.30` → `[2, 30]` |
| `time` | `[minutes, seconds, hundredths]` | `26:45.49` → `[26, 45, 49]` |

`time` needs the minutes group even for sprints because the 400m table spans 41.97 to
1:18.01 and so crosses the minute boundary. A wheel whose options collapse to a single
distinct value is dropped, which is why the 100m renders two wheels rather than three.

Two exports:

- `wheelsFor(table, spec, selection)` — the options for every wheel given the current
  selection. Wheel *i*'s options are the distinct group-*i* values among the marks whose
  groups `0..i-1` match the selection. Every reachable combination is therefore a mark
  that is actually listed; there is no invalid state and no saturating at the top score.
- `snapSelection(table, spec, selection)` — after a higher wheel moves, the lower
  selections may no longer exist. Each is snapped to the nearest still-valid value,
  left to right. Nearest rather than first, so nudging the metres wheel keeps you at a
  comparable mark instead of jumping to the extreme of the new range.

### `src/components/inputs/MarkSelect.tsx` (new)

Renders one `WheelPicker` per wheel from `wheelsFor`, composes the selection back into a
mark value, and reports it up. Replaces `HeightSelect` in the simulator only —
`HeightSelect` stays for `Calculator` and `Compare`.

Labels come from the group: metres and centimetres wheels for a field event, minutes,
seconds and hundredths for a track one. The composed mark renders through
`formatMark(value, group.mark)` so it reads the way the feeds write it.

## Changed files

### `src/engine/simulate.ts`

`resultScoreFor` currently sums `performanceScore(scoringTable, ...)` and
`placingScore(placingPoints, ...)`. Both halves change.

The mark half becomes `markPoints` against the loaded table.

**The placing half is a correctness fix, not cleanup.** `placingPoints` is
`placing_points.json`, Table 2.2 alone. Track & Field is not one placing table: the 5000m
and 3000mSC groups score their finals off Table 2.5 and the 10,000m group off Table 2.9.
Simulating a 5000m against Table 2.2 would be wrong. `placingPointsFor` at
`src/engine/placing.ts:76` already covers all nine tables and takes the group, so the
simulator switches to it:

```
placingPointsFor({
  group,
  discipline: group.mainEvent,
  category,
  round: 'final',
  place,
  advanced: false,
})
```

`round: 'final'` because the simulator asks "what if I place Nth in this competition",
which is a final. The UI gains no new control.

This collapses one of the two coexisting scoring paths the handoff flagged. `score.ts`
keeps its current signatures for `Calculator` and `Compare`, so the other path stays until
those migrate.

`COUNTING_RESULTS = 5` at `simulate.ts:6` becomes `group.countingResults`. Every Track &
Field group is 5 today, so this changes no behaviour, but the constant is now reachable
from groups other than high jump and leaving it hardcoded would be a live trap rather
than the dead configurability the handoff correctly declined to remove earlier.

### `src/components/SimulateResult.tsx`

Gains a `group: EventGroup` prop. Loads the group's table in an effect, keyed by
`slug-gender`, and renders a short loading line until it resolves. A load failure renders
a message saying the scoring table could not be loaded, not a blank simulator.

`HeightSelect` becomes `MarkSelect`. `availableMarks` and `defaultHeightFor` are no longer
used here.

**Opening mark.** Today it is a hardcoded 2.10 m for men and 1.80 m for women. For 36
groups there is no such constant to hardcode. The simulator already receives
`currentScore`, the athlete's own average ranking score, so it opens at the listed mark
whose points are nearest that score. That puts the wheels at roughly the athlete's own
level in any event, with no new props and no per-group table of defaults. It is a
starting position only; the score shown is always computed from the wheels.

### `src/components/AthleteLookup.tsx`

The `hasScoringTable` ternary at line 943 goes, along with the `data-testid="no-scoring-table"`
fallback. `group` is passed to `SimulateResult`.

### `src/engine/marks.ts`

`hasScoringTable` becomes unused and is deleted with its test. `availableMarks` and
`defaultHeightFor` stay — `Calculator` and `Compare` still use them.

## Testing

**The oracle is free.** `verify.py:179` already checks these tables against captured World
Athletics counting results across all 36 groups and passes today:

> 152 captured World Athletics results reproduced exactly, 20 wind-affected results
> differ by the wind adjustment.

Porting that assertion gives `scoring.test.ts` a real all-discipline oracle on day one
rather than hand-written expectations. Mirror its logic exactly:

- Only rows whose `discipline` is the group's **main** event are checked. A group covers
  similar events too — the 100m group counts a 60m result — but those score off their own
  column in the book, which is not in these tables.
- For each such row, `markPoints(table, parseMark(row.mark))` must equal the row's
  `resultScore`.
- Wind tolerance applies **on mismatch only**, not as an upfront exclusion: a mismatch is
  forgiven if the group is one of the six wind-affected ones (`100m`, `200m`, `110mh`,
  `100mh`, `long-jump`, `triple-jump`) or the row is `notLegal`. An exact match still
  counts as a pass in those events, which is why 152 of 172 rows verify strictly.
- Assert the exact-match count, so the tolerance cannot quietly widen to "everything"
  while the suite stays green.

Note the naming trap the tables document: in the WA feeds `resultScore` is the mark points
these tables produce, while `performanceScore` is already mark plus placing.

`markWheels.test.ts`:

- Every combination reachable through the cascade parses back to a mark listed in the table.
- A wheel with one distinct value is dropped; the 100m renders two wheels, the 400m three.
- Moving a higher wheel snaps lower selections to the nearest valid value, and the result
  is always a listed mark.
- Round-trips through `parseMark`/`formatMark` for a height, a distance, a sub-minute time
  and a time over an hour.

`SimulateResult` component test: mounts on a non-high-jump group, waits out the async
load, moves a wheel, asserts the score changes. Plus one asserting the simulator now
renders for a group that previously hit the gate.

Existing `Calculator`, `Compare` and `score.test.ts` must pass untouched — they are the
check that the high-jump path did not move.

## Verification

All four must pass before this is done:

- `npx vitest run` — 452 tests pass on the merged base today; this must not regress
- `npx tsc -b` exits 0
- `npm run build` succeeds, and the main bundle does **not** grow by the table's 222 kB
  gzipped — that is the whole point of the split, so it is asserted rather than assumed
- `python pipeline/verify.py` and `python pipeline/verify_rules.py` exit 0

## Decisions made and why

**Split per group behind a dynamic import**, not one static import. The file is 222 kB
gzipped and the app has no code splitting at all today, so a static import would land on
every first paint for a feature only reachable after a successful athlete lookup. The
file is already keyed by slug and gender, so the split is mechanical.

**Cascading wheels over real marks**, not independent wheels across the table's full
range. The tables run to a 0.92 m high jump and a 1:13:43 10,000m, so independent wheels
would offer mostly nonsense combinations. Cascading costs snap logic but makes every
reachable state a real listed mark.

**Wheels rather than a text input.** The app's established input idiom is the wheel
picker. A single wheel does not survive the jump from high jump's 163 rows to a 10,000m's
1400, but splitting a mark into its digit groups turns one 1400-row wheel into three
shallow ones.

## Known risk

`finalFieldSizeFor` at `src/engine/placing.ts:41` assumes championship track finals take 8
and field finals 12, because neither feed reports the finalist count. The high jump half
is confirmed against live counting sets. That assumption now reaches the simulator for
every track group. It only affects rounds before the final, and the simulator always
scores a final, so it does not bite here — but it is the reason not to add a round
selector to the simulator without evidence first.
