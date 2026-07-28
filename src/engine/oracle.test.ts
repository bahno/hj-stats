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

/**
 * Fixtures whose counting set we reconstruct result-for-result but *select* differently,
 * kept as `it.fails` so the gap stays visible instead of silently disappearing.
 *
 * triple-jump-men: Pichardo's 5th and 6th results tie exactly at 1244 — the Tokyo 2025
 * qualification (17 SEP 2025, mark score 1174 + 70 placing) and the Rome 2024 European
 * Championships qualification (09 JUN 2024, mark score 1216 + 28). World Athletics counts
 * the older, Area-Championships one. That contradicts the newest-first tie-break that
 * `substitutePool` uses and that the other 35 fixtures confirm, and it fits a "higher mark
 * score wins a tie" rule — but on a single observation, so the rule is not implemented
 * rather than guessed at.
 */
const KNOWN_SELECTION_DIVERGENCE = new Set(['triple-jump-men']);

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

      // Scoring the results World Athletics chose is only half the claim: substitutePool
      // also has to *choose* them out of the athlete's whole result list. Same ordering it
      // uses — best score first, newest first on a tie.
      const selects = KNOWN_SELECTION_DIVERGENCE.has(`${slug}-${gender}`) ? it.fails : it;
      selects('selects the same counting set World Athletics did', () => {
        const pool = scoreResults(fixture.results, group)
          .filter((r) => isInWindow(r, window))
          .sort((a, b) => b.score - a.score || b.t - a.t);
        const ours = pool.slice(0, fixture.calculation.results.length).map(countingKey).sort();
        const theirs = fixture.calculation.results.map(countingKey).sort();
        expect(ours).toEqual(theirs);
      });
    });
  }
});
