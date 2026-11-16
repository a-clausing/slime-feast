import { defineConfig } from 'vitest/config';

// GitHub Pages serves this project at https://<user>.github.io/slime-feast/
// so production assets must resolve under that base path.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/slime-feast/' : '/',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
