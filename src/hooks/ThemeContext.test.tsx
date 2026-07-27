import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeContext';

function Probe() {
  const { theme, toggleTheme } = useTheme();
  return <button onClick={toggleTheme}>{theme}</button>;
}

function mockMatchMedia(prefersDark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  // @ts-expect-error jsdom has no built-in matchMedia; remove our stub between tests
  delete window.matchMedia;
});

test('defaults to the system preference when nothing is stored (system = light)', () => {
  mockMatchMedia(false);
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByRole('button')).toHaveTextContent('light');
  expect(document.documentElement.getAttribute('data-theme')).toBe('light');
});

test('defaults to the system preference when nothing is stored (system = dark)', () => {
  mockMatchMedia(true);
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByRole('button')).toHaveTextContent('dark');
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
});

test('toggling stores an explicit choice and updates the document attribute', () => {
  mockMatchMedia(true); // system prefers dark
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByRole('button')).toHaveTextContent('light');
  expect(window.localStorage.getItem('theme')).toBe('light');
  expect(document.documentElement.getAttribute('data-theme')).toBe('light');
});

test('an explicit stored choice overrides the system preference on mount', () => {
  window.localStorage.setItem('theme', 'light');
  mockMatchMedia(true); // system prefers dark, but the stored choice wins
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByRole('button')).toHaveTextContent('light');
});

test('throws when useTheme is used outside a ThemeProvider', () => {
  function Bare() {
    useTheme();
    return null;
  }
  expect(() => render(<Bare />)).toThrow('useTheme must be used within a ThemeProvider');
});
