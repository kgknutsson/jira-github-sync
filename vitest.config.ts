import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // action-e2e and dist.test both run build.mjs; parallel files can race on dist/index.mjs.
    fileParallelism: false,
  },
});
