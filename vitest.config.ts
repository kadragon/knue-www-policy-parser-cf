import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000, // 30 seconds for integration tests
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'test/', 'vitest.config.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 75,
        statements: 90
      }
    }
  }
});
