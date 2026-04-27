import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: {
      // Satisfy the FUNDING_DESTINATION_ATXP guard in src/globals.ts so tests
      // that transitively import it can load.
      FUNDING_DESTINATION_ATXP: 'test-funding-destination',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'dist/**/*'],
    },
  },
});
