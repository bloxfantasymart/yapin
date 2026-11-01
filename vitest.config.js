import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    exclude: ['tests/integration/**', 'node_modules/**'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
