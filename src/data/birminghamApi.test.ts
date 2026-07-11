import { expect, test } from 'vitest';
import {
  findQualification,
  worldRankingPoolPeers,
  type QualificationEntry,
  type RoadToBirmingham,
} from './birminghamApi';

function entry(urlSlug: string, overrides: Partial<QualificationEntry> = {}): QualificationEntry {
  return {
    qualifiedBy: 'Qualified by Entry Standard',
    qualificationTypeId: 'q1',
    qualified: true,
    qualificationPosition: 1,
    countryPosition: 1,
    competitor: { athleteId: 1, name: 'Test Athlete', country: 'CZE', urlSlug },
    withdrawn: false,
    rejected: false,
    qualificationDetails: { result: '2.30', venue: 'Prague (CZE)', date: '01 JUN 2026' },
    ...overrides,
  };
}

const data: RoadToBirmingham = {
  entryNumber: 30,
  entryStandard: '2.27',
  rankDate: '26 JUL 2026',
  numberOfCompetitorsFilledUpByWorldRankings: 17,
  firstRankingDay: '27 JUL 2025',
  lastRankingDay: '26 JUL 2026',
  qualifications: [entry('italy/gianmarco-tamberi-14375750'), entry('ukraine/oleh-doroshchuk-14803002')],
};

test('finds the qualification entry matching the athlete urlSlug', () => {
  expect(findQualification(data, 'ukraine/oleh-doroshchuk-14803002')?.competitor.name).toBe(
    'Test Athlete',
  );
});

test('returns undefined when no entry matches', () => {
  expect(findQualification(data, 'czechia/nobody-99999999')).toBeUndefined();
});

test('worldRankingPoolPeers includes only q4/n4 entries with a score, excluding self', () => {
  const pool: RoadToBirmingham = {
    ...data,
    qualifications: [
      entry('a', {
        qualificationTypeId: 'q4',
        qualified: true,
        competitor: { athleteId: 2, name: 'A', country: 'FRA', urlSlug: 'a' },
        qualificationDetails: { score: 1200 },
      }),
      entry('b', {
        qualificationTypeId: 'n4',
        qualified: false,
        competitor: { athleteId: 3, name: 'B', country: 'GER', urlSlug: 'b' },
        qualificationDetails: { score: 1050 },
      }),
      entry('c', { qualificationTypeId: 'q1' }), // entry standard, no score — excluded
      entry('self', { qualificationTypeId: 'n4', qualified: false, qualificationDetails: { score: 1000 } }),
    ],
  };
  expect(worldRankingPoolPeers(pool, 'self')).toEqual([
    { score: 1200, country: 'FRA' },
    { score: 1050, country: 'GER' },
  ]);
});
