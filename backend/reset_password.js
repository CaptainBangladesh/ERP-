const { PrismaClient } = require('@prisma/client');
const { randomBytes, scrypt } = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(scrypt);
const prisma = new PrismaClient();

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function main() {
  const newPassword = 'Password123!';
  const hashedPassword = await hashPassword(newPassword);

  const updated = await prisma.user.updateMany({
    data: { passwordHash: hashedPassword }
  });

  console.log(`Successfully updated password for ${updated.count} users to: ${newPassword}`);
}

main().finally(() => prisma.$disconnect());
