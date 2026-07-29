# Light theme + theme switch

## Problem

The app is hardcoded to a single dark palette, defined almost entirely as CSS
custom properties in `src/styles.css:1-22`. We want a light theme and a way
for users to switch between light, dark, and "follow system," with the choice
remembered across visits.

## Mechanism

- Theme is expressed as `data-theme="light"` or `data-theme="dark"` on the
  `<html>` element. `src/styles.css` gains a
  `:root[data-theme="light"] { ... }` block that overrides the existing
  `:root` (dark) tokens. No other selector in the stylesheet changes — every
  rule already consumes the custom properties, not literal colors, so the
  override block is the only structural change needed to styles.css.
- A new `ThemeContext` (`src/hooks/ThemeContext.tsx`, mirroring the existing
  `FavoritesContext`/`AuthContext` pattern) owns:
  - `theme`: the resolved value actually applied (`'light' | 'dark'`).
  - `setTheme(theme: 'light' | 'dark' | 'system')`: user action from the
    toggle.
  - Resolution order: if `localStorage.getItem('theme')` is `'light'` or
    `'dark'`, use it. Otherwise resolve from
    `window.matchMedia('(prefers-color-scheme: dark)')`, and keep tracking
    that media query live (via its `change` event) for as long as no
    explicit choice has been stored.
  - Clicking the toggle writes an explicit `'light'`/`'dark'` to
    `localStorage` and detaches the media-query listener's effect on the
    resolved theme (it keeps listening only to decide what "system" would
    currently mean, not to override an explicit choice).
  - The context applies the resolved theme to `document.documentElement`
    (`data-theme` attribute) and to `<meta name="theme-color">` in
    `index.html`, so mobile browser chrome matches.
- `App.tsx`'s `Shell` wraps children in `ThemeProvider`, alongside the
  existing `AuthProvider`/`FavoritesProvider`.

## Toggle UI

- A circular icon button, visually matching `.account-icon-btn`, placed in
  `.account-corner` to the left of the existing account button.
- Icon: sun in light mode, moon in dark mode (click flips to the other,
  always resulting in an explicit — not "system" — stored choice). No
  three-way UI; "system" is only the implicit initial state before the user
  ever clicks the toggle.

## Palette

New `:root[data-theme="light"]` tokens:

- `--bg`: soft off-white page background.
- `--panel`: white card background.
- `--line`: light gray border.
- `--text`: near-black.
- `--muted`: a darker muted gray-green than the dark theme's, so secondary
  text stays legible on white.
- `--accent` / `--accent-rgb`, `--men`, `--women`, `--pos`, `--neg`,
  `--gold`, `--silver`, `--bronze`: each re-tuned (deepened/darkened as
  needed) to clear roughly AA contrast against the new light `--bg`/`--panel`
  while staying recognizably the same hue as its dark-theme counterpart.
  These colors are also used as low-opacity tints/glows (e.g.
  `rgb(var(--accent-rgb) / 0.16)`), which will read differently against a
  light background — verify visually during implementation.
- `--pos-rgb` / `--neg-rgb` follow their re-tuned hex values.

Unaffected by the theme:

- `Logo.tsx`'s blue→pink gradient (already explicitly called out in its own
  comment as fixed, encoding the men/women pairing rather than the accent
  theme).
- The 10-color categorical palette in `ScoreVsHeightChart.tsx`'s `COLORS`
  array (per-series line colors, not theme colors).
- The tier colors in `styles.css`'s `.cat-chip[data-cat="..."]` rules
  (bronze/silver/gold/emerald/diamond/crimson/orange prestige ladder) — kept
  as literal RGB triples already, low-opacity usage should hold up on light
  backgrounds; revisit only if contrast looks wrong in review.

## Other hardcoded-color fixes

`src/components/charts/CategoryBarChart.tsx` and
`ScoreVsHeightChart.tsx` currently hardcode dark-mode hex for grid/axis/tooltip
chrome (`#1e2733`, `#8b949e`, `#0d1117`). Since recharts accepts CSS variable
strings directly as SVG/style values, swap these to `var(--line)`,
`var(--muted)`, and `var(--panel)` respectively so the charts follow the
theme.

## Testing

- Existing component tests (`Calculator.test.tsx`, `AthleteLookup.*.test.tsx`,
  etc.) should be unaffected since they don't assert on color values.
- Add a small test for `ThemeContext`/the toggle: defaults to system
  preference when no stored choice exists, toggling persists an explicit
  choice to `localStorage`, and `data-theme` is applied to the document root.

## Out of scope

- Per-component theme customization beyond the token overrides above.
- Any "auto" theme UI beyond the initial system-preference default (no
  three-way switch).
