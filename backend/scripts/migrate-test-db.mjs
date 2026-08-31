import { config } from 'dotenv';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Brings the test database up to date before the suite runs.
 *
 * Without this, a fresh clone fails: the development database gets migrated by `db:migrate`
 * and the test database never does, so every test dies on a missing table. Making it a
 * `pretest` step means the suite is correct from `npm install` onward rather than only on a
 * machine where someone once ran the migration by hand.
 */
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

config({ path: resolve(backendRoot, '.env'), quiet: true });

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  console.error(
    'TEST_DATABASE_URL is not set. Copy backend/.env.example to backend/.env, then run ' +
      '`npm run db:up` from the repo root to start PostgreSQL.',
  );
  process.exit(1);
}

if (testDatabaseUrl === process.env.DATABASE_URL) {
  console.error(
    'TEST_DATABASE_URL and DATABASE_URL point at the same database. The suite truncates ' +
      'every table between tests, which would destroy your development data.',
  );
  process.exit(1);
}

// `DIRECT_URL` as well as `DATABASE_URL`, and that is not belt-and-braces: the schema
// declares `directUrl`, and Prisma runs migrations through *that* connection when it is set.
// Overriding only `DATABASE_URL` sent every migration to whatever `DIRECT_URL` pointed at —
// the development database — while the test database silently stayed behind, so a new column
// appeared in development and the suite failed on it.
execSync('npx prisma migrate deploy', {
  cwd: backendRoot,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: testDatabaseUrl, DIRECT_URL: testDatabaseUrl },
});
