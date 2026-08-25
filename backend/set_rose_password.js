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
  const email = 'rose.fo@thenearbuy.com';
  const newPassword = '12345678@@@@';
  const hashedPassword = await hashPassword(newPassword);

  const updated = await prisma.user.updateMany({
    where: { email },
    data: { passwordHash: hashedPassword }
  });

  console.log(`Updated ${updated.count} user(s) for ${email} with new password: ${newPassword}`);
}

main()
  .catch((err) => {
    console.error('Error resetting password:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
