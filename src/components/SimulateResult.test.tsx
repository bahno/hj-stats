import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { findEventGroup } from '../data/events';
import { SimulateResult } from './SimulateResult';

function renderFor(slug: string) {
  const group = findEventGroup(slug, 'men')!;
  return render(
    <SimulateResult
      group={group}
      baseScores={[1100, 1090, 1080, 1070, 1060]}
      currentScore={1080}
      currentPlace={10}
      peerScores={[1200, 1150, 1100]}
      rankingType="european"
    />,
  );
}

describe('SimulateResult', () => {
  it('scores a mark in a track event, which the old gate blocked entirely', async () => {
    renderFor('10000m');
    await waitFor(() => expect(screen.getByTestId('sim-score')).toBeInTheDocument());
    expect(Number(screen.getByTestId('sim-score').textContent)).toBeGreaterThan(0);
  });

  it('renders minutes/seconds wheels for a track event', async () => {
    renderFor('10000m');
    await waitFor(() => expect(screen.getByLabelText('minutes')).toBeInTheDocument());
    expect(screen.getByLabelText('seconds')).toBeInTheDocument();
  });

  it('renders no minutes wheel for the high jump', async () => {
    renderFor('high-jump');
    await waitFor(() => expect(screen.getByLabelText('metres')).toBeInTheDocument());
    expect(screen.getByLabelText('centimetres')).toBeInTheDocument();
    expect(screen.queryByLabelText('minutes')).not.toBeInTheDocument();
  });

  it('opens at a mark near the athlete\'s own current score', async () => {
    // The old hardcoded 2.10 m / 1.80 m default has no 36-group equivalent, so the
    // simulator seeds itself from currentScore instead.
    renderFor('high-jump');
    await waitFor(() => expect(screen.getByTestId('sim-score')).toBeInTheDocument());
    // currentScore is 1080 and a category A win adds 100, so the opening result should
    // land near 1180 rather than at some constant unrelated to this athlete.
    const score = Number(screen.getByTestId('sim-score').textContent);
    expect(Math.abs(score - 1180)).toBeLessThan(30);
  });
});
