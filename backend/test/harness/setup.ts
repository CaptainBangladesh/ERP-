/**
 * Runs before every backend test file.
 *
 * Points the process at the TEST database before anything imports PrismaClient, so a test
 * run can never touch development data. Failing loudly here is deliberate: silently falling
 * back to DATABASE_URL would mean the first person to run the suite wipes their own work.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../.env'), quiet: true });

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Copy backend/.env.example to backend/.env and point ' +
      'TEST_DATABASE_URL at a database you are happy to have truncated between tests. ' +
      'It must not be the same database as DATABASE_URL.',
  );
}

if (testDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL and DATABASE_URL point at the same database. The test harness ' +
      'truncates every table between tests, which would destroy your development data.',
  );
}

process.env.DATABASE_URL = testDatabaseUrl;
