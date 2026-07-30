import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The app is served from the root of bahno.info, not a project subpath. Every
  // built asset URL is absolute from here, so this and public/CNAME have to agree.
  base: '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
    // Don't scan ephemeral agent worktrees, which carry their own copies of these tests.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
