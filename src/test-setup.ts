import '@testing-library/jest-dom';
import { beforeEach } from 'vitest';

// The app keeps its shareable state in the query string, and jsdom shares one
// window across every test in a file — so an event picked by one test would
// otherwise still be in the URL, and decide the starting state of the next.
beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

// jsdom does not implement ResizeObserver; Recharts' ResponsiveContainer requires it.
// This minimal stub prevents a hard ReferenceError so chart-containing components can render.
(globalThis as any).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
