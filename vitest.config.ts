import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 25,
        branches: 40,
        functions: 45,
        statements: 25,
      },
      exclude: [
        'node_modules/**',
        'dist/**',
        'website/**',
        'extensions/**',
        'tests/**',
        '**/*.d.ts',
      ],
    },
  },
});
