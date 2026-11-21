import { execSync } from 'node:child_process';
import { assertSafeTestDb } from './safety';

/** Recreates the schema in the (guarded) test database before the suite runs. */
export default function setup() {
  // Re-check here too: this is the step that wipes the database.
  const url = assertSafeTestDb(process.env.TEST_DATABASE_URL, [process.env.DATABASE_URL]);
  execSync('npx prisma db push --skip-generate --force-reset --accept-data-loss', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
}
