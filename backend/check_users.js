const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      companyId: true,
      company: { select: { name: true } },
      sessions: {
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { id: true, createdAt: true, expiresAt: true, revokedAt: true }
      }
    }
  });

  console.log("=== USERS IN DATABASE ===");
  console.dir(users, { depth: null });
}

main().finally(() => prisma.$disconnect());
