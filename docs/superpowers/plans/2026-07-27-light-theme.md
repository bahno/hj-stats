# Light Theme + Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a light color theme alongside the existing dark theme, plus a toggle button that lets the user switch between them, defaulting to the OS/browser color-scheme preference on first visit.

**Architecture:** A `data-theme="light"|"dark"` attribute on `<html>` selects between two CSS custom-property blocks in `src/styles.css`. A new `ThemeContext` resolves the active theme (stored `localStorage` choice, else live OS preference via `matchMedia`), applies the attribute, and exposes a `toggleTheme` action. A small icon button renders the toggle in the existing `.account-corner`.

**Tech Stack:** React 18, TypeScript, Vite, Vitest + Testing Library (existing stack, no new dependencies).

## Global Constraints

- No new npm dependencies.
- Follow the existing context pattern (see `src/hooks/FavoritesContext.tsx`, `src/auth/AuthContext.tsx`): `createContext` + `useContext` hook that throws if used outside its provider, `useCallback`/`useMemo` for the exposed value.
- Follow the existing `matchMedia` guard pattern used in `src/components/inputs/WheelPicker.tsx:17` (`typeof window.matchMedia === 'function'`), since jsdom (the test environment) does not implement `matchMedia` and calling it unguarded throws in tests.
- `Logo.tsx`'s blue→pink gradient and `ScoreVsHeightChart.tsx`'s `COLORS` array are explicitly out of scope — do not theme them.
- `localStorage` key: `theme`, values `'light'` or `'dark'` only (never `'system'` — "system" is just the absence of a stored key).

---

### Task 1: `ThemeContext` — resolve and expose the active theme

**Files:**
- Create: `src/hooks/ThemeContext.tsx`
- Test: `src/hooks/ThemeContext.test.tsx`

**Interfaces:**
- Produces: `export type Theme = 'light' | 'dark'`; `export function ThemeProvider({ children }: { children: ReactNode })`; `export function useTheme(): { theme: Theme; toggleTheme: () => void }`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/hooks/ThemeContext.test.tsx
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- ThemeContext`
Expected: FAIL — `Cannot find module './ThemeContext'` (file doesn't exist yet).

- [ ] **Step 3: Implement `ThemeContext`**

```tsx
// src/hooks/ThemeContext.tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

interface ThemeValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function canMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

function systemTheme(): Theme {
  if (!canMatchMedia()) return 'dark';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function storedTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [explicit, setExplicit] = useState<Theme | null>(() => storedTheme());
  const [system, setSystem] = useState<Theme>(() => systemTheme());

  useEffect(() => {
    if (!canMatchMedia()) return;
    const mq = window.matchMedia(DARK_QUERY);
    const apply = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const theme = explicit ?? system;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f6f7' : '#0f1115');
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    window.localStorage.setItem(STORAGE_KEY, next);
    setExplicit(next);
  }, [theme]);

  const value = useMemo<ThemeValue>(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- ThemeContext`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/ThemeContext.tsx src/hooks/ThemeContext.test.tsx
git commit -m "feat: add ThemeContext to resolve and toggle light/dark theme"
```

---

### Task 2: Light theme CSS tokens

**Files:**
- Modify: `src/styles.css:1-22`

**Interfaces:**
- Consumes: nothing (pure CSS).
- Produces: `:root[data-theme="light"]` block that `ThemeContext` (Task 1) and `ThemeToggle` (Task 3) rely on being present for the light theme to render correctly once `data-theme="light"` is set on `<html>`.

- [ ] **Step 1: Add the light token block**

Insert immediately after the existing `:root { ... }` block (after line 22) in `src/styles.css`:

```css
/* Light theme: same-hue tokens as :root above, re-tuned (mostly darkened)
   so text/status colors clear roughly AA contrast against a white panel. */
:root[data-theme="light"] {
  --bg: #f4f6f7;
  --panel: #ffffff;
  --line: #d8dee1;
  --text: #14181a;
  --muted: #56635f;
  --accent: #1a56db;
  --accent-rgb: 26 86 219;
  --men: #1a56db;
  --women: #be185d;
  --pos: #15803d;
  --pos-rgb: 21 128 61;
  --neg: #b91c1c;
  --neg-rgb: 185 28 28;
  --gold: #b45309;
  --silver: #64748b;
  --bronze: #7c4a2d;
}
```

Leave `--men`/`--women` as used by `.card.men`/`.card.women` and `.fav-chip.men`/`.fav-chip.women`, which set their own literal `--accent-rgb` overrides (`src/styles.css:143-150`, `src/styles.css:1710-1715`) independent of the theme — no change needed there, they already read fine on both light and dark since they're used at low opacity (`rgb(var(--accent-rgb) / 0.5)` etc.) against `var(--bg)`/`var(--panel)`.

- [ ] **Step 2: Verify manually**

Run: `npm run dev`, open the printed local URL in a browser, open devtools, run `document.documentElement.setAttribute('data-theme', 'light')` in the console.
Expected: page background turns light, panels turn white, text turns dark, and no element becomes unreadable (illegible text, invisible borders). Run `document.documentElement.removeAttribute('data-theme')` to confirm it reverts to the original dark look.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "feat: add light theme CSS tokens"
```

---

### Task 3: `ThemeToggle` button, wired into the app

**Files:**
- Create: `src/components/ThemeToggle.tsx`
- Test: `src/components/ThemeToggle.test.tsx`
- Modify: `src/App.tsx:1,72-105` (wrap in `ThemeProvider`, render `ThemeToggle` in `.account-corner`)
- Modify: `src/styles.css` (`.account-corner` rule, currently at the "Account control (top-right corner)" section) to lay out two buttons side by side
- Test: `src/App.theme.test.tsx`

**Interfaces:**
- Consumes: `useTheme` from `src/hooks/ThemeContext.tsx` (Task 1): `{ theme: 'light' | 'dark', toggleTheme: () => void }`.
- Produces: `export function ThemeToggle()` — a self-contained button, no props.

- [ ] **Step 1: Write the failing `ThemeToggle` test**

```tsx
// src/components/ThemeToggle.test.tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ThemeToggle`
Expected: FAIL — `Cannot find module './ThemeToggle'`.

- [ ] **Step 3: Implement `ThemeToggle`**

```tsx
// src/components/ThemeToggle.tsx
import { useTheme } from '../hooks/ThemeContext';

function SunIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </svg>
  );
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === 'light';
  const label = isLight ? 'Switch to dark theme' : 'Switch to light theme';
  return (
    <button
      type="button"
      className="account-icon-btn"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      {isLight ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ThemeToggle`
Expected: PASS.

- [ ] **Step 5: Wire `ThemeProvider` and `ThemeToggle` into `App.tsx`**

In `src/App.tsx`, add imports next to the other provider/component imports (near line 6 and line 11):

```tsx
import { ThemeProvider } from './hooks/ThemeContext';
import { ThemeToggle } from './components/ThemeToggle';
```

In the `Shell` component's `.account-corner` div (`src/App.tsx:82-88`), render the toggle alongside the existing `AccountSlot`:

```tsx
          <div className="account-corner">
            <ThemeToggle />
            <AccountSlot
              active={view === 'account'}
              onOpenAccount={() => setView('account')}
              onSignIn={() => setShowAuth(true)}
            />
          </div>
```

In the default-exported `App` component (`src/App.tsx:98-106`), wrap `AuthProvider` in `ThemeProvider` (outermost, since the theme doesn't depend on auth state):

```tsx
export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <FavoritesProvider>
          <Shell />
        </FavoritesProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 6: Update `.account-corner` layout in `src/styles.css`**

Find the existing rule (in the "Account control (top-right corner)" section):

```css
.account-corner {
  position: absolute;
  top: 20px;
  right: 16px;
  z-index: 5;
}
```

Replace with:

```css
.account-corner {
  position: absolute;
  top: 20px;
  right: 16px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 7: Write the failing App-level integration test**

```tsx
// src/App.theme.test.tsx
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
```

- [ ] **Step 8: Run all tests to verify everything passes**

Run: `npm test`
Expected: PASS — full suite green, including the new `App.theme.test.tsx`, `ThemeToggle.test.tsx`, `ThemeContext.test.tsx`, and the pre-existing `App.test.tsx` (unaffected, since it only asserts on the "Calculator" heading and absence of "Sign in").

- [ ] **Step 9: Manually verify in the browser**

Run: `npm run dev`, open the app. Confirm a second circular icon button now sits to the left of the account icon in the top-right corner, and clicking it flips the whole app between light and dark instantly, with the correct sun/moon icon per state. Reload the page after toggling — confirm the choice persists (survives reload) via `localStorage`.

- [ ] **Step 10: Commit**

```bash
git add src/components/ThemeToggle.tsx src/components/ThemeToggle.test.tsx src/App.tsx src/App.theme.test.tsx src/styles.css
git commit -m "feat: add theme toggle button to the account corner"
```

---

### Task 4: Theme-aware chart chrome

**Files:**
- Modify: `src/components/charts/CategoryBarChart.tsx:8-11`
- Modify: `src/components/charts/ScoreVsHeightChart.tsx:17-20`

**Interfaces:**
- Consumes: the CSS custom properties `--line`, `--muted`, `--panel` defined in `src/styles.css` (base `:root` block, Task 2's light override).
- Produces: nothing new — internal recoloring only.

- [ ] **Step 1: Update `CategoryBarChart.tsx`**

Change:

```tsx
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2733" />
        <XAxis dataKey="category" stroke="#8b949e" />
        <YAxis stroke="#8b949e" />
        <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid #1e2733' }} />
```

to:

```tsx
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
        <XAxis dataKey="category" stroke="var(--muted)" />
        <YAxis stroke="var(--muted)" />
        <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)' }} />
```

Leave `<Bar dataKey="total" fill="#3b82f6" />` unchanged — it's a data-series color, not theme chrome (same treatment as `ScoreVsHeightChart`'s `COLORS` array below).

- [ ] **Step 2: Update `ScoreVsHeightChart.tsx`**

Change:

```tsx
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2733" />
        <XAxis dataKey="height" stroke="#8b949e" />
        <YAxis stroke="#8b949e" />
        <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid #1e2733' }} />
```

to:

```tsx
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
        <XAxis dataKey="height" stroke="var(--muted)" />
        <YAxis stroke="var(--muted)" />
        <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)' }} />
```

Leave the `COLORS` array unchanged, per the design spec (categorical series colors, not theme colors).

- [ ] **Step 3: Run the existing test for the component that renders these charts**

Run: `npm test -- Compare`
Expected: PASS — `Compare.test.tsx` renders `CategoryBarChart` and `ScoreVsHeightChart` and asserts on table rows/text, not colors, so it should be unaffected. This is the only automated coverage available for these two chart components: `Compare.tsx` (`src/components/Compare.tsx:10-11,50,52`) is not currently wired into app navigation (`src/components/Nav.tsx` only lists `'calculator'` and `'rankings'`), so the color change can't be checked by browsing the running app — confirm instead by reading the diff and running this test.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/charts/CategoryBarChart.tsx src/components/charts/ScoreVsHeightChart.tsx
git commit -m "fix(charts): use theme CSS variables for grid/axis/tooltip colors"
```

---

## Self-Review Notes

- **Spec coverage:** mechanism (Task 1), toggle UI (Task 3), palette (Task 2), chart hardcoded-color fixes (Task 4), testing (each task's test step), out-of-scope items (Logo gradient, chart `COLORS` array, cat-chip tier colors) explicitly left untouched in Tasks 2 and 4.
- **Placeholder scan:** none found — every step has literal code or exact commands.
- **Type consistency:** `Theme = 'light' | 'dark'` and `useTheme()`'s return shape (`{ theme, toggleTheme }`) are defined once in Task 1 and consumed identically in Tasks 3's `ThemeToggle.tsx` and its test.
