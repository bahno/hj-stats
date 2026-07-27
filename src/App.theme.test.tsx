import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

vi.mock('./lib/supabase', () => ({ supabase: null, isAuthEnabled: false }));

import App from './App';

test('the theme toggle flips the document data-theme attribute', () => {
  render(<App />);
  const before = document.documentElement.getAttribute('data-theme');
  const toggle = screen.getByLabelText(/^Switch to (light|dark) theme$/);
  fireEvent.click(toggle);
  const after = document.documentElement.getAttribute('data-theme');
  expect(after).not.toBe(before);
  expect(['light', 'dark']).toContain(after);
});
