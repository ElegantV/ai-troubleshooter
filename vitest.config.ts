import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/ui/**/*.spec.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 60000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/agent/**', 'src/auth/**', 'src/collector/parse-lineage.ts', 'src/collector/collect.ts'],
      exclude: ['src/**/*.spec.ts', 'src/agent/agent.module.ts'],
      reporter: ['text', 'text-summary'],
    },
  },
});