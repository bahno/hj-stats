import { expect, test } from 'vitest';
import { findQualification, type QualificationEntry, type RoadToBirmingham } from './birminghamApi';

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
