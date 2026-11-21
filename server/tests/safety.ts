/**
 * The test run executes `prisma db push --force-reset`, which DROPS every table.
 * These checks make it impossible to run that against the application's real database.
 */
export function assertSafeTestDb(testUrl: string | undefined, realUrls: (string | undefined)[]): string {
  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Create a separate Neon branch/database for tests (its name must contain "test") and put its connection string in server/.env as TEST_DATABASE_URL.',
    );
  }
  const dbName = (u: string) => {
    try {
      return new URL(u).pathname.replace(/^\//, '');
    } catch {
      return '';
    }
  };
  if (!/^postgres(ql)?:\/\//.test(testUrl)) throw new Error('TEST_DATABASE_URL must be a postgresql:// URL');
  if (!/test/i.test(dbName(testUrl))) {
    throw new Error(`Refusing to run tests: database name "${dbName(testUrl)}" must contain "test" because the test run wipes it.`);
  }
  const strip = (u: string) => {
    const x = new URL(u);
    return `${x.hostname.replace('-pooler', '')}${x.pathname}`;
  };
  for (const r of realUrls) {
    if (r && strip(r) === strip(testUrl)) {
      throw new Error('Refusing to run tests: TEST_DATABASE_URL points at the same database as DATABASE_URL.');
    }
  }
  return testUrl;
}
