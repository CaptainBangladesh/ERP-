import { PrismaClient } from '@prisma/client';
import { truncateAllTables } from '../test/harness/database.ts';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL || 'postgresql://erp:erp_local_dev@localhost:55432/erp_test?schema=public',
    },
  },
});

async function main() {
  await prisma.$connect();
  const beforeCount = await prisma.user.count();
  console.log('Users before truncate:', beforeCount);
  await truncateAllTables(prisma);
  const afterCount = await prisma.user.count();
  console.log('Users after truncate:', afterCount);
  await prisma.$disconnect();
}

main().catch(console.error);
