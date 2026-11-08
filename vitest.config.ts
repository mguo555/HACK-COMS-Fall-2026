import { defineConfig } from 'vitest/config';

// Unit tests for shared code (src/app/shared) and the API server (server/).
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'server/**/*.spec.ts'],
    environment: 'node',
  },
});
