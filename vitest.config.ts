import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['verification/**/*.test.ts'],
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      include: ['contracts/**/*.ts', 'desktop/services/**/*.ts'],
      exclude: ['contracts/bridge-contract.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 },
    },
  },
});
