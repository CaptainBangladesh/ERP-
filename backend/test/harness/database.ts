import type { PrismaClient } from '@prisma/client';

/**
 * Truncates every application table.
 *
 * Discovered from the catalogue rather than listed by hand, so that a module added in ticket
 * 08 does not silently leak rows into the next test because someone forgot to extend a list.
 * With forty-plus modules coming, a hand-maintained list is a guaranteed future bug.
 */
export async function truncateAllTables(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE '_prisma%'
  `;

  if (tables.length === 0) {
    // Silence here would be the worst outcome: the suite would proceed and every test would
    // die on a missing table, with nothing pointing at the real cause.
    throw new Error(
      'The test database has no tables. Migrations have not been applied to it. Run ' +
        '`npm run db:up` from the repo root, then `npm test`, which migrates the test ' +
        'database before running.',
    );
  }

  const quoted = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  // RESTART IDENTITY so sequences do not drift across tests; CASCADE so foreign keys
  // between modules do not dictate truncation order.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
}
