import { describe, it, expect } from 'vitest';
import { mergeEvents, buildRankingDigest, type AthleteEvents } from './detectors';

function ev(over: Partial<AthleteEvents> = {}): AthleteEvents {
  return {
    slug: 'tamberi',
    name: 'Gianmarco Tamberi',
    gender: 'men',
    results: [],
    place: [],
    score: null,
    qualification: null,
    ...over,
  };
}

describe('mergeEvents', () => {
  it('passes through athletes present on only one side', () => {
    const a = ev({ slug: 'a', score: { from: 1, to: 2, delta: 1 } });
    const b = ev({ slug: 'b', score: { from: 5, to: 6, delta: 1 } });
    const out = mergeEvents([a], [b]);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.slug).sort()).toEqual(['a', 'b']);
  });

  it('treats the same slug in different genders as different athletes', () => {
    const men = ev({ gender: 'men' });
    const women = ev({ gender: 'women' });
    expect(mergeEvents([men], [women])).toHaveLength(2);
  });

  it('chains a place move: 8→5 then 5→3 reads as 8→3', () => {
    const first = ev({ place: [{ scope: 'european', from: 8, to: 5, direction: 'up' }] });
    const second = ev({ place: [{ scope: 'european', from: 5, to: 3, direction: 'up' }] });
    const [merged] = mergeEvents([first], [second]);
    expect(merged.place).toEqual([{ scope: 'european', from: 8, to: 3, direction: 'up' }]);
  });

  it('recomputes direction when the net move reverses', () => {
    const first = ev({ place: [{ scope: 'world', from: 3, to: 1, direction: 'up' }] });
    const second = ev({ place: [{ scope: 'world', from: 1, to: 9, direction: 'down' }] });
    const [merged] = mergeEvents([first], [second]);
    expect(merged.place).toEqual([{ scope: 'world', from: 3, to: 9, direction: 'down' }]);
  });

  it('drops a place change that went back to where it started', () => {
    const first = ev({ place: [{ scope: 'european', from: 4, to: 2, direction: 'up' }] });
    const second = ev({ place: [{ scope: 'european', from: 2, to: 4, direction: 'down' }] });
    const [merged] = mergeEvents([first], [second]);
    expect(merged.place).toEqual([]); // reporting "4 → 4" would be nonsense
  });

  it('merges each scope independently', () => {
    const first = ev({ place: [{ scope: 'european', from: 8, to: 5, direction: 'up' }] });
    const second = ev({ place: [{ scope: 'world', from: 20, to: 15, direction: 'up' }] });
    const [merged] = mergeEvents([first], [second]);
    expect(merged.place).toEqual([
      { scope: 'european', from: 8, to: 5, direction: 'up' },
      { scope: 'world', from: 20, to: 15, direction: 'up' },
    ]);
  });

  it('chains score changes and recomputes the delta across both', () => {
    const first = ev({ score: { from: 1200, to: 1250, delta: 50 } });
    const second = ev({ score: { from: 1250, to: 1275.5, delta: 25.5 } });
    const [merged] = mergeEvents([first], [second]);
    expect(merged.score).toEqual({ from: 1200, to: 1275.5, delta: 75.5 });
  });

  it('drops a score that returned to its starting value', () => {
    const first = ev({ score: { from: 1200, to: 1250, delta: 50 } });
    const second = ev({ score: { from: 1250, to: 1200, delta: -50 } });
    expect(mergeEvents([first], [second])[0].score).toBeNull();
  });

  it('unions results and dedupes ones already pending', () => {
    const r1 = { date: '12 JUL 2026', competition: 'Rome', mark: '2.30' };
    const r2 = { date: '19 JUL 2026', competition: 'Oslo', mark: '2.32' };
    const [merged] = mergeEvents([ev({ results: [r1] })], [ev({ results: [r1, r2] })]);
    expect(merged.results).toEqual([r1, r2]);
  });

  it('drops a qualification that flipped and flipped back', () => {
    const first = ev({ qualification: { from: true, to: false, place: 33, target: 32 } });
    const second = ev({ qualification: { from: false, to: true, place: 30, target: 32 } });
    expect(mergeEvents([first], [second])[0].qualification).toBeNull();
  });

  it('keeps a qualification change that stands', () => {
    const first = ev({ qualification: { from: false, to: true, place: 30, target: 32 } });
    const second = ev({ place: [{ scope: 'world', from: 9, to: 8, direction: 'up' }] });
    expect(mergeEvents([first], [second])[0].qualification).toEqual({
      from: false,
      to: true,
      place: 30,
      target: 32,
    });
  });

  it('keeps a pending résumé owed from the earlier run', () => {
    const standing = {
      europeanPlace: 3,
      worldPlace: 9,
      score: 1300,
      qualified: true,
      qualPlace: 12,
      qualTarget: 32,
      seasonBest: '2.30',
    };
    const first = ev({ intro: standing });
    const second = ev({ place: [{ scope: 'world', from: 9, to: 8, direction: 'up' }] });
    const [merged] = mergeEvents([first], [second]);
    expect(merged.intro).toEqual(standing);
    // The résumé still takes precedence over the deltas in the rendered digest.
    expect(buildRankingDigest('Sam', [merged])!.text).toContain('now following');
  });

  it('produces a sendable digest from pending events alone', () => {
    // The retry case: the snapshot has already advanced, so this run computes
    // nothing new — the digest must still be built from what was parked.
    const parked = ev({ place: [{ scope: 'european', from: 8, to: 5, direction: 'up' }] });
    const digest = buildRankingDigest('Sam', mergeEvents([parked], []));
    expect(digest).not.toBeNull();
    expect(digest!.text).toContain('European rank 8 → 5');
  });
});
