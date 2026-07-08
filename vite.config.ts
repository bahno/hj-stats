import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/hj-stats/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
    // Don't scan ephemeral agent worktrees, which carry their own copies of these tests.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
