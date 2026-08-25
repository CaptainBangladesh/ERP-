const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({ where: { email: 'rose.fo@thenearbuy.com' } });
  if (!user) {
    console.log('User rose.fo@thenearbuy.com not found!');
    return;
  }
  const company = await prisma.company.update({
    where: { id: user.companyId },
    data: { ownerUserId: user.id }
  });
  console.log(`Set company owner of ${company.name} (${company.id}) to user ${user.email} (${user.id}).`);
}

main().finally(() => prisma.$disconnect());
