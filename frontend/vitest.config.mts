import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
      'server-only': path.resolve(import.meta.dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      include: ['lib/**', 'hooks/**', 'components/**', 'app/**', 'instrumentation.ts'],
      exclude: ['lib/types/**', '**/*.d.ts'],
      reporter: ['text-summary', 'text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 70 },
    },
  },
});
