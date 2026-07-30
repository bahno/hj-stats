import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { findEventGroup } from '../../data/events';
import { parseScoringTable, type ParsedTable } from '../../engine/scoring';
import { decompose, wheelsFor } from '../../engine/markWheels';
import { MarkSelect } from './MarkSelect';

const chunks = import.meta.glob('../../data/scoring/*.json', { eager: true }) as Record<
  string,
  {
    default: {
      slug: string;
      gender: string;
      column: string;
      marks: Record<string, number>;
    };
  }
>;

function tableFor(slug: string, gender: 'men' | 'women'): ParsedTable {
  const group = findEventGroup(slug, gender)!;
  return parseScoringTable(group, chunks[`../../data/scoring/${slug}-${gender}.json`].default);
}

describe('MarkSelect', () => {
  it('renders a determined digit as text, not a spinner that cannot move', () => {
    // The 10,000m book lists roughly one mark per second: 1157 distinct minute:second
    // pairs across 1400 rows, and only 243 of those pairs offer more than one hundredth.
    // Find a mark whose hundredths the cascade fully determines, and check that slot is
    // not presented as a control the user can drag with no effect.
    const table = tableFor('10000m', 'men');
    const determined = table.rows.find(
      (r) => wheelsFor(table, decompose(r.value, table.spec))[2].options.length === 1,
    );
    expect(determined).toBeDefined();

    render(<MarkSelect table={table} value={determined!.value} onChange={() => {}} rows={3} />);
    const hundredths = screen.getByLabelText('hundredths');
    expect(hundredths).toHaveAttribute('role', 'img');
    expect(hundredths).not.toHaveAttribute('role', 'listbox');
    expect(hundredths.textContent).toMatch(/^\d{2}$/);
  });

  it('keeps a wheel with real choices spinnable', () => {
    // High jump lists every centimetre, so that wheel always has choices.
    const table = tableFor('high-jump', 'men');
    render(<MarkSelect table={table} value={2.3} onChange={() => {}} rows={3} />);
    expect(screen.getByLabelText('centimetres')).toHaveAttribute('role', 'listbox');
    expect(screen.getByLabelText('metres')).toHaveAttribute('role', 'listbox');
  });

  it('writes the composed mark out the way the feeds write it', () => {
    render(<MarkSelect table={tableFor('10000m', 'men')} value={1668.56} onChange={() => {}} />);
    expect(screen.getByText('27:48.56')).toBeInTheDocument();
  });
});
