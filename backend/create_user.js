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
  const password = '12345678@@@@';
  const companyName = 'NearBuy Inc';
  const name = 'Rose Fo';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('User already exists:', existing);
    const newHash = await hashPassword(password);
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash: newHash }
    });
    console.log(`Updated password for ${email} to: ${password}`);
    return;
  }

  const hashedPassword = await hashPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: { name: companyName }
    });

    const user = await tx.user.create({
      data: {
        companyId: company.id,
        name,
        email,
        passwordHash: hashedPassword
      }
    });

    await tx.company.update({
      where: { id: company.id },
      data: { ownerUserId: user.id }
    });

    return { company, user };
  });

  console.log('Successfully created company and owner account:');
  console.log('Company:', result.company.name, '(', result.company.id, ')');
  console.log('User:', result.user.email, '(', result.user.id, ')');
}

main()
  .catch((err) => {
    console.error('Error creating user:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
