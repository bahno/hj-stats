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
import { byCountingOrder, countingKey, parseWaDate, scoreResults } from './counting';
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
 * kept as `it.fails` so the gap stays visible instead of silently disappearing. Keyed by
 * athlete, since a group can have more than one fixture.
 *
 * Pichardo's triple-jump-men entry used to live here, an exact 1244 tie between his Tokyo
 * 2025 and Rome 2024 qualifications. It is resolved: `byCountingOrder` now breaks a tied
 * score by mark score, on 7 of 7 supporting observations.
 *
 * Aleksandra ZAUCHA is a different and still-unexplained class: World Athletics omits her
 * 11 JUL 2026 result scoring 1027 and counts a 27 JUN 2026 one scoring 1005 instead, so
 * they are leaving a strictly higher-scoring result out of the average. Juan Antonio PÉREZ
 * (Men's 10,000m) shows the same shape, where a 1107 European Running Championships road
 * result is passed over for a 1103. Some eligibility rule we do not implement is at work;
 * two observations is not enough to name it, so it is recorded rather than guessed at.
 */
const KNOWN_SELECTION_DIVERGENCE = new Set(['Aleksandra ZAUCHA']);

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
      // uses (byCountingOrder): best score first, then higher mark score, then newest.
      const selects = KNOWN_SELECTION_DIVERGENCE.has(fixture.athlete.name) ? it.fails : it;
      selects('selects the same counting set World Athletics did', () => {
        const pool = scoreResults(fixture.results, group)
          .filter((r) => isInWindow(r, window))
          .sort(byCountingOrder);
        const ours = pool.slice(0, fixture.calculation.results.length).map(countingKey).sort();
        const theirs = fixture.calculation.results.map(countingKey).sort();
        expect(ours).toEqual(theirs);
      });
    });
  }
});
