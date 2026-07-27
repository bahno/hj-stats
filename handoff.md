# Handoff: all-disciplines generalization

Written 2026-07-27. Read this first in a new session, then read the plan.

## Where the work lives

- Worktree: `C:\Users\Marek\Desktop\projects\.claude\worktrees\all-disciplines`
- Branch: `worktree-all-disciplines`, draft PR #16 (`https://github.com/bahno/hj-stats/pull/16`)
- Commits: `a878c0e` research → `552d255` corrections → `fc5a90d` rules extraction → `1891b36` plan
- Working tree clean apart from an untracked `claude.md` at the repo root (not mine, left alone)

## Goal

Generalize `hj-stats` from high jump only to all World Athletics **Track & Field** event
groups (36 of them). Scope decided by the user:

- Track & Field only. Road running, race walking and combined events are deferred.
- Rankings / real-athlete features first; the what-if calculator follows.
- Keep the `hj-stats` name for now.

## Done

**`docs/superpowers/specs/2026-07-27-all-disciplines-research.md`** — what generalizes free,
what needs parameterizing, what is net new, verification strategy, open questions.

**Rules extraction pipeline** (`fc5a90d`):

- `pipeline/rules_anchors.py` — values read off the rendered page **by eye, before** the
  extractor existed, so a parser bug cannot redefine "correct". Do not regenerate these
  from extractor output.
- `pipeline/scrape_rules.py` — pulls every `Table 2.N` from
  `worldathletics.org/world-ranking-rules/track-field-events-2026`.
- `pipeline/verify_rules.py` — anchors, no-zero-scores, monotonicity (catches row
  misalignment), categories, wind, event groups, and that `placing_points.json` still
  equals Table 2.2.
- Generated: `src/data/placing_tables.json` (9 placing tables + `eventGroupTables` +
  categories + wind), `src/data/event_groups.json` (36 groups).
  `src/data/placing_points.json` was regenerated **byte-identical** to the hand-curated
  file — that is the main evidence the extractor is right.
- Deleted `pipeline/scrape_placing.py`. It scraped the **2025** page while the data was
  2026 (an OW win: 375 vs 260). Live footgun, gone.

**`docs/superpowers/plans/2026-07-27-all-disciplines-engine.md`** — 9 TDD tasks, full test
and implementation code per task. This is the thing to execute.

Last verified state: 169 tests / 33 files passing; `verify.py` and `verify_rules.py` both
exit 0.

## Not done — next action

The writing-plans skill requires an execution handoff that was never presented. Offer the
user the choice, then execute:

1. **Subagent-driven** (recommended) — a fresh subagent per task, review between tasks.
2. **Inline** — execute in-session via `superpowers:executing-plans`, batched with checkpoints.

Note the standing instruction in this repo: do not call the Agent tool unless the user
asks for it. So option 1 needs the user to say yes.

## The plan's 9 tasks

1. Harvest discipline long names (`pipeline/harvest_disciplines.py`)
2. Event registry (`src/data/events.ts`) — `EventGroup`, `MarkSpec`, `findEventGroup`
3. Mark model (`src/engine/mark.ts`) — parse/format/compare across time, distance, height
4. Round classification (`src/engine/rounds.ts`) — `classifyRounds`, `advancedToFinal`
5. Placing resolution (`src/engine/placing.ts`) — pick the right table, then the points
6. Ranking window (extract `src/engine/dates.ts`, add `src/engine/window.ts`)
7. Generalize `src/engine/counting.ts` — drop the `discipline === 'High Jump'` check
8. Generalize the API clients — kill the hardcoded `HIGH_JUMP_EVENT_ID`
9. Oracle verification against `getRankingScoreCalculation`

Tasks 6 and 7 are coupled: `dates.ts` must be extracted first or `window.ts` and
`counting.ts` import each other circularly. The plan already handles this; do not
"simplify" it back.

## Things that will bite you

- **Table 2.3 vs 2.4.** 2.3 is "Final is of max. 9 athletes", 2.4 is "10 or more".
  I had this backwards in the first research commit; `552d255` fixed it. Neither the EA
  nor the WA feed reports finalist count, so the plan assumes field events → `min10`,
  track → `max9`, and lets Task 9's oracle test disprove it. If oracle results diverge,
  that assumption is the first suspect.
- **Task 7 changes behaviour on purpose.** `scoreResults` now includes non-final rounds
  that the old `candidateScore` returned `null` for. A test will fail against the old
  expectation; the fix is the expectation, not the code. The plan says so explicitly.
- **Cloudflare 403.** Both the WA and EA hosts reject default client agents. Send a
  browser `User-Agent`. Worth re-checking whether the Deno poller trips this too.
- **Non-final rounds do score.** Confirmed live: a semi-final placing scored 100; a heat
  scored 0 only because Tables 2.3/2.4 have no columns below GL.
- **Road-to event IDs need no hardcoding.** `getCompetitionQualifyingSystem` returns the
  full `events[]` list from `competitionId` alone. This was expected to be the hard part
  and is not.
- **Empty table cells are omitted, never stored as 0.** "Scores nothing" and "not ranked"
  are different states.

## Deliberately out of scope for the engine plan

- **UI / storage plan** — event selection, `favorites` and `ranking_snapshots` key changes,
  scaling the poller to 36 group/gender combinations. Needs writing.
- **Scoring tables plan** (mark → performance points). Blocked: **the user is doing this
  research themselves**. `pipeline/parse_scoring.py` currently extracts the high jump
  column only, via hardcoded PDF page ranges.
- Overweighting rules (only the latest OW/DF edition counts) — documented, not implemented.
- Race walk slugs were never found in the EA ranking API.
