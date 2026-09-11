import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Each suite builds its own app from createApp(), so nothing is shared
    // between files and they can run in parallel without a lock.
    restoreMocks: true,
  },
});
