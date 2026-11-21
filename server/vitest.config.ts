import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { assertSafeTestDb } from './tests/safety';

// Tests reset their database on every run, so they must NEVER point at the app's real database.
const testDb = assertSafeTestDb(process.env.TEST_DATABASE_URL, [process.env.DATABASE_URL]);

export default defineConfig({
  test: {
    globalSetup: ['./tests/globalSetup.ts'],
    fileParallelism: false, // tests share one database
    testTimeout: 30000,
    hookTimeout: 120000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDb,
      TEST_DATABASE_URL: testDb,
      JWT_SECRET: 'test-secret-test-secret-test-secret-123456',
      CLIENT_ORIGIN: 'http://localhost:5173',
      RAZORPAY_KEY_ID: '',
      RAZORPAY_KEY_SECRET: '',
      // Force local-disk image storage even if B2 credentials exist in .env.
      B2_KEY_ID: '',
      B2_APPLICATION_KEY: '',
      B2_BUCKET: '',
      B2_REGION: '',
      B2_PUBLIC_URL: '',
      ALLOW_LAN_ORIGINS: '0',
      // Tests write (and sweep) uploads here, never in the real server/uploads folder.
      UPLOAD_DIR: path.join(os.tmpdir(), 'shop-test-uploads'),
    },
  },
});
