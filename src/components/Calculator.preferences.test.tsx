import { render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

vi.mock('../hooks/usePreferences', () => ({
  usePreferences: () => ({
    defaultGender: 'women',
    setDefaultGender: vi.fn().mockResolvedValue(undefined),
    loading: false,
  }),
}));

import { Calculator } from './Calculator';

test('opens on the saved default gender', async () => {
  render(<Calculator />);
  // The women's gender switch is checked when the preference is applied.
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: 'Gender' })).toHaveAttribute(
      'aria-checked',
      'true',
    ),
  );
});
