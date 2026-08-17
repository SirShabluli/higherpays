import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/business/**', 'src/lib/**', 'src/rbac/**'],
      reporter: ['text', 'html'],
    },
  },
});
