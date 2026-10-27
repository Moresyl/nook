import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['verification/**/*.test.ts'],
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      include: ['contracts/**/*.ts', 'desktop/services/**/*.ts', 'workbench/lib/settings-drafts.ts', 'workbench/lib/toasts.ts', 'workbench/lib/sidebar-sections.ts', 'workbench/lib/sidebar-pagination.ts', 'workbench/components/project-tree-layout.ts'],
      exclude: ['contracts/bridge-contract.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 },
    },
  },
});
