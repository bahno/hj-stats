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
