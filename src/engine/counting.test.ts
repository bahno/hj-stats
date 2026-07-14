import { expect, test } from 'vitest';
import {
  allCountingInWindow,
  combinedScore,
  countingKey,
  oneYearEarlier,
  parsePlace,
  parseWaDate,
  recount,
  resultKey,
  substitutePool,
  type CountingEntry,
  type RankableResult,
} from './counting';

/**
 * Real WorldAthletics data for Oleh DOROSHCHUK (men's HJ, fetched 2026-07), used to verify
 * that scoring + finals-filtering + a rolling 12-month window reproduce the official
 * counting set exactly, and that the next-best result behind it is picked up correctly.
 */
function r(
  date: string,
  competition: string,
  category: string,
  race: string,
  place: string,
  resultScore: number,
): RankableResult {
  // competitionId keys same-competition rounds together (a qual and its final share one).
  return {
    date, competition, competitionId: competition, category, race, place, resultScore,
    discipline: 'High Jump', notLegal: false,
  };
}

const doroshchuk: RankableResult[] = [
  r('18 JAN 2025', 'Lviv', 'F', 'F', '1.', 1179),
  r('05 FEB 2025', 'Trinec', 'B', 'F', '2.', 1152),
  r('08 FEB 2025', 'Hustopece', 'B', 'F', '2.', 1161),
  r('22 FEB 2025', 'Kyiv', 'D', 'F', '1.', 1197),
  r('06 MAR 2025', 'EuroInd', 'A', 'Q1', '2.', 1117), // qual round (out of window anyway)
  r('08 MAR 2025', 'EuroInd', 'A', 'F', '1.', 1215),
  r('21 MAR 2025', 'Nanjing', 'GW', 'F', '5.', 1161),
  r('06 JUN 2025', 'Roma', 'GW', 'F', '2.', 1179),
  r('09 AUG 2025', 'UkrCh', 'B', 'F', '1.', 1161),
  r('16 AUG 2025', 'Chorzow', 'GW', 'F', '3.', 1161),
  r('22 AUG 2025', 'Bruxelles', 'GW', 'F', '1.', 1135),
  r('28 AUG 2025', 'Zurich', 'DF', 'F', '2.', 1179),
  r('14 SEP 2025', 'Tokyo', 'OW', 'Q1', '1.', 1135), // advancing qual → 1135 + OW-to-final 70 = 1205
  r('16 SEP 2025', 'Tokyo', 'OW', 'F', '4.', 1188),
  r('17 JAN 2026', 'Lviv', 'F', 'F', '1.', 1126),
  r('07 FEB 2026', 'Hustopece', 'B', 'F', '3.', 1161),
  r('10 FEB 2026', 'Trinec', 'B', 'F', '4.', 1099),
  r('28 FEB 2026', 'Kyiv', 'D', 'F', '1.', 1179),
  r('21 MAR 2026', 'Torun', 'GW', 'F', '1.', 1179),
  r('19 JUN 2026', 'Doha', 'GW', 'F', '3.', 1126),
  r('27 JUN 2026', 'Berdichev', 'F', 'F', '1.', 1206),
  r('10 JUL 2026', 'Monaco', 'GW', 'F', '1.', 1197),
];

// The official counting set (from the calculation endpoint), keyed the same way.
const counting = [
  { date: '16 SEP 2025', category: 'OW', place: '4.', resultScore: 1188 }, // 1378
  { date: '28 AUG 2025', category: 'DF', place: '2.', resultScore: 1179 }, // 1329
  { date: '21 MAR 2026', category: 'GW', place: '1.', resultScore: 1179 }, // 1319
  { date: '22 AUG 2025', category: 'GW', place: '1.', resultScore: 1135 }, // 1275
  { date: '16 AUG 2025', category: 'GW', place: '3.', resultScore: 1161 }, // 1271
];

test('parseWaDate parses the WA date format', () => {
  expect(parseWaDate('16 SEP 2025')).toBe(Date.UTC(2025, 8, 16));
  expect(parseWaDate('2025-09-16')).toBe(Date.UTC(2025, 8, 16)); // ISO fallback
  expect(parseWaDate('garbage')).toBeNaN();
});

test('parsePlace pulls the finish position out of assorted place strings', () => {
  expect(parsePlace('4.')).toBe(4);
  expect(parsePlace('=2.')).toBe(2);
  expect(parsePlace('DNF')).toBe(0);
});

test('oneYearEarlier steps back a calendar year', () => {
  expect(oneYearEarlier(Date.UTC(2026, 6, 8))).toBe(Date.UTC(2025, 6, 8));
});

test('combinedScore adds placing points to the mark score', () => {
  // Tokyo final: OW place 4 -> +190
  expect(combinedScore({ category: 'OW', place: '4.', resultScore: 1188 })).toBe(1378);
  // Toruń: GW place 1 -> +140
  expect(combinedScore({ category: 'GW', place: '1.', resultScore: 1179 })).toBe(1319);
});

const rankDate = parseWaDate('08 JUL 2026');
const windowStart = oneYearEarlier(rankDate);

// The counting set as the app has it: official key + exact score, plus the lowest as the cap.
const countingEntries: CountingEntry[] = counting.map((c, i) => ({
  key: resultKey(c),
  score: [1378, 1329, 1319, 1275, 1271][i],
}));
const countingKeys = new Set(counting.map(countingKey));
const cap = Math.min(...countingEntries.map((c) => c.score)); // 1271

test('allCountingInWindow accepts a window covering the counting set, rejects one that clips it', () => {
  expect(allCountingInWindow(counting, windowStart, rankDate)).toBe(true);
  // A window starting after Chorzów (16 AUG 2025) leaves a counting result outside.
  expect(allCountingInWindow(counting, parseWaDate('01 SEP 2025'), rankDate)).toBe(false);
});

test('an advancing championship qualification round is a substitute, scored qual-to-final', () => {
  const subs = substitutePool(doroshchuk, windowStart, rankDate, countingKeys, cap);
  // Tokyo Q1 advanced to the final (same competition), so it counts: 1135 + OW 70 = 1205,
  // ranked below the finals above it — never inflated by the round's own "1st" place.
  const q1 = subs.find((s) => s.competition === 'Tokyo' && s.race === 'Q1');
  expect(q1?.score).toBe(1205);
});

test('a qualification round with no final at the same competition is not a substitute', () => {
  // Same data but strip the Tokyo final: the Q1 no longer "advanced", so it drops out.
  const noFinal = doroshchuk.filter((x) => !(x.competition === 'Tokyo' && x.race === 'F'));
  const subs = substitutePool(noFinal, windowStart, rankDate, countingKeys, cap);
  expect(subs.some((s) => s.competition === 'Tokyo' && s.race === 'Q1')).toBe(false);
});

test('flight finals (F1/F2) are treated as finals, not skipped', () => {
  const results = [r('02 MAY 2026', 'NCAA Meet', 'F', 'F1', '1.', 1188)]; // a flight-1 final
  const subs = substitutePool(results, windowStart, rankDate, new Set(), 2000);
  expect(subs).toHaveLength(1);
  expect(subs[0].score).toBe(1199); // 1188 + F-place-1 placing (11)
});

test('a counting qual is excluded from substitutes even though its place drifts between feeds', () => {
  // Advancing OW qual scored 1135 + 70 = 1205; calc records place "9.", profile "7.".
  const results = [
    r('16 SEP 2025', 'Worlds', 'OW', 'F', '8.', 1126), // the final (so the qual "advanced")
    r('14 SEP 2025', 'Worlds', 'OW', 'Q2', '7.', 1135), // profile place 7.
    r('20 JUL 2025', 'Local', 'C', 'F', '1.', 1120), // a genuine substitute
  ];
  const keys = new Set([countingKey({ date: '14 SEP 2025', category: 'OW', place: '9.', resultScore: 1135 })]);
  const subs = substitutePool(results, windowStart, rankDate, keys, 1205);
  expect(subs.some((s) => s.race === 'Q2')).toBe(false); // not duplicated as a substitute
  expect(subs.some((s) => s.competition === 'Local')).toBe(true);
});

test('a qualification round in a non-championship category is not scorable as a substitute', () => {
  const local = [
    r('01 JUN 2026', 'Local', 'B', 'F', '1.', 1100), // a final at the same competition
    r('01 JUN 2026', 'Local', 'B', 'Q1', '1.', 1100), // B-tier qual — no qual-to-final value
  ];
  const subs = substitutePool(local, windowStart, rankDate, new Set(), 2000);
  expect(subs.some((s) => s.race === 'Q1')).toBe(false);
  expect(subs.some((s) => s.race === 'F')).toBe(true);
});

test('substitutePool excludes out-of-window results and anything above the cap', () => {
  const subs = substitutePool(doroshchuk, windowStart, rankDate, countingKeys, cap);
  const comps = subs.map((s) => s.competition);
  expect(comps).not.toContain('Monaco'); // 10 JUL 2026 — past the window end (and above cap)
  expect(comps).not.toContain('Roma'); // 06 JUN 2025 — before the window start
  expect(comps).not.toContain('EuroInd'); // 08 MAR 2025 — before the window start
  // None of the counting results reappear as substitutes.
  expect(comps).not.toContain('Chorzow');
});

test('the top substitute (next to slide in) is Doha', () => {
  const subs = substitutePool(doroshchuk, windowStart, rankDate, countingKeys, cap);
  expect(subs[0].competition).toBe('Doha');
  expect(subs[0].score).toBe(1236);
});

test('a high-scoring result WA has not counted yet is capped out, not treated as the 6th', () => {
  // Even with a window end past Monaco (1337), the cap keeps it out of the substitutes.
  const badEnd = parseWaDate('26 JUL 2026');
  const subs = substitutePool(doroshchuk, oneYearEarlier(badEnd), badEnd, countingKeys, cap);
  expect(subs.some((s) => s.competition === 'Monaco')).toBe(false);
  expect(subs[0].competition).toBe('Doha');
});

test('removing a counting competition slides in the next best and re-averages', () => {
  const subs = substitutePool(doroshchuk, windowStart, rankDate, countingKeys, cap);
  const removed = new Set([resultKey({ date: '16 AUG 2025', category: 'GW', place: '3.', resultScore: 1161 })]); // Chorzów (1271)
  const { substitutesUsed, baseScores, average } = recount(countingEntries, removed, subs);
  expect(substitutesUsed).toHaveLength(1);
  expect(substitutesUsed[0].competition).toBe('Doha'); // 1236 slides in
  // Was avg(1378,1329,1319,1275,1271)=1314; now avg(1378,1329,1319,1275,1236)=1307.
  expect(average).toBe(1307);
  expect(baseScores).toEqual([1378, 1329, 1319, 1275, 1236]);
});

/**
 * Michaela Hrubá's real case: her best counting result is a World Champs *qualification*
 * round (race Q2, place "1.") that WA scores with her final championship placing (70), not
 * the round's own place. We trust WA's calc for the counting set, so we never re-score that
 * round; the substitute pool is finals-only, so we never mistake a qualification round for
 * the 6th (which would be mis-scored, e.g. 1140 + OW-place-1 260 = 1400).
 */
const hruba: RankableResult[] = [
  r('09 AUG 2025', 'Heilbronn', 'B', 'F', '5.', 1160), // counting (1198)
  r('15 AUG 2025', 'Silesia', 'A', 'F', '4.', 1101), // counting (1171)
  r('18 SEP 2025', 'Tokyo', 'OW', 'Q2', '1.', 1140), // counting qualification round (1210 per WA)
  r('21 SEP 2025', 'Tokyo', 'OW', 'F', '12.', 1101), // counting final (1171)
  r('24 JUN 2026', 'Zagreb', 'A', 'F', '8.', 1121), // the true 6th (1163)
  r('25 JAN 2026', 'Lodz', 'B', 'F', '2.', 1121), // counting (1177)
];

const hrubaCounting = [
  { date: '18 SEP 2025', category: 'OW', place: '1.', resultScore: 1140 }, // 1210
  { date: '09 AUG 2025', category: 'B', place: '5.', resultScore: 1160 }, // 1198
  { date: '25 JAN 2026', category: 'B', place: '2.', resultScore: 1121 }, // 1177
  { date: '15 AUG 2025', category: 'A', place: '4.', resultScore: 1101 }, // 1171
  { date: '21 SEP 2025', category: 'OW', place: '12.', resultScore: 1101 }, // 1171
];
const hrubaEntries: CountingEntry[] = hrubaCounting.map((c, i) => ({
  key: resultKey(c),
  score: [1210, 1198, 1177, 1171, 1171][i],
}));

test('a counted qualification round is honoured but never re-scored as a substitute', () => {
  const keys = new Set(hrubaCounting.map(countingKey));
  const subs = substitutePool(hruba, parseWaDate('12 JUL 2025'), parseWaDate('12 JUL 2026'), keys, 1171);
  // The qualification round is not offered as a substitute...
  expect(subs.some((s) => s.race === 'Q2')).toBe(false);
  // ...and the real next-best is the Zagreb final at 1163 (A place 8), within the cap.
  expect(subs[0].competition).toBe('Zagreb');
  expect(subs[0].score).toBe(1163);

  // Removing the weakest counting result (a 1171) slides Zagreb in: avg(1210,1198,1177,1171,1163)=1183.
  const removed = new Set([resultKey(hrubaCounting[4])]);
  const { average } = recount(hrubaEntries, removed, subs);
  expect(average).toBe(1183);
});
