import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ThemeProvider } from '../hooks/ThemeContext';
import { ThemeToggle } from './ThemeToggle';

test('toggles the aria-label and click behavior between light and dark', () => {
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
  const button = screen.getByRole('button');
  const firstLabel = button.getAttribute('aria-label');
  expect(firstLabel).toMatch(/^Switch to (light|dark) theme$/);

  fireEvent.click(button);
  const secondLabel = button.getAttribute('aria-label');
  expect(secondLabel).not.toBe(firstLabel);
  expect(secondLabel).toMatch(/^Switch to (light|dark) theme$/);
});
