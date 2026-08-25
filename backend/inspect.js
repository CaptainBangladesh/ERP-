const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  try {
    const companies = await prisma.company.findMany({ select: { id: true, name: true } });
    const users = await prisma.user.findMany({ select: { id: true, email: true, name: true } });
    const leads = await prisma.lead.findMany({ select: { id: true, name: true, email: true, customValues: true } });
    const sources = await prisma.captureSource.findMany({ select: { id: true, name: true, kind: true, token: true } });
    const sessions = await prisma.session.findMany({ select: { id: true, userId: true, expiresAt: true, revokedAt: true } });

    console.log("=== DB DATA FOUND ===");
    console.log("Companies:", companies);
    console.log("Users:", users);
    console.log("Leads count:", leads.length);
    console.log("Leads:", leads);
    console.log("Capture Sources:", sources);
    console.log("Sessions count:", sessions.length);
  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

check();
