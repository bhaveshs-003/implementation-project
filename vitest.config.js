import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    testTimeout: 30000,
    hookTimeout: 30000,
    globals: true,
    environment: 'node',
    reporters: ['verbose'],
    sequence: { sequential: true },
  },
});
