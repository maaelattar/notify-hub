import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      'src/': new URL('./src/', import.meta.url).pathname,
      'test/': new URL('./test/', import.meta.url).pathname,
    },
  },
});