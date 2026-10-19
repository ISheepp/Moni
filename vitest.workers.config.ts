import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      main: './tests/worker/entry.ts',
      remoteBindings: false,
      miniflare: {
        compatibilityDate: '2026-08-11',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB', 'DB_UPGRADE'],
        durableObjects: {
          CONVERSATIONS: { className: 'Conversation', useSQLite: true },
          WECHAT: { className: 'WechatBot', useSQLite: true },
        },
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
          AI_API_KEY: 'test-placeholder-not-a-secret',
          AI_BASE_URL: 'https://model.invalid/v1',
          AI_MODEL: 'synthetic-model',
          ACCESS_ISSUER: 'https://moni-test.cloudflareaccess.com',
          ACCESS_AUDIENCE: 'synthetic-audience',
          OWNER_SUBJECT: 'synthetic-owner',
          WECHAT_SECRET: '0123456789abcdef'.repeat(4),
        },
      },
    }),
  ],
  test: {
    // Each suite boots real D1/DO; avoid starving multi-message tests.
    maxWorkers: 1,
    include: ['tests/worker/**/*.test.ts'],
    setupFiles: ['./tests/worker/setup.ts'],
  },
}));
