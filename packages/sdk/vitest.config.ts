import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'https://weartstudio.io/onboarding-3' } },
    include: ['test/**/*.test.ts'],
  },
});
