import '@testing-library/jest-dom';

// jsdom does not implement ResizeObserver; Recharts' ResponsiveContainer requires it.
// This minimal stub prevents a hard ReferenceError so chart-containing components can render.
(globalThis as any).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
