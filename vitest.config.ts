import { defineConfig } from 'vitest/config';

// Unit tests for the framework-free poker engine (src/app/poker).
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
