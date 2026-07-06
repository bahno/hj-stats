import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Compare } from './Compare';

test('renders a row per category in the numbers table', () => {
  render(<Compare />);
  // OW row is always present
  expect(screen.getByText('OW')).toBeInTheDocument();
  expect(screen.getAllByTestId('compare-row').length).toBe(10);
});
