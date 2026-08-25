const http = require('http');

async function testSignInAndLeads() {
  // 1. Sign in or check existing sessions for user
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  const user = await prisma.user.findFirst({
    where: { email: 'rose.fo@thenearbuy.com' },
    include: { company: true }
  });

  console.log("Found User:", user ? { id: user.id, email: user.email, company: user.company.name } : "NONE");

  if (!user) {
    console.log("Users in DB:", await prisma.user.findMany({ select: { email: true } }));
  }

  await prisma.$disconnect();
}

testSignInAndLeads();
