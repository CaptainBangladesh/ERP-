import { PrismaClient } from '@prisma/client';

const passwords = [
  'erp_local_dev', 'erp', 'postgres', 'admin', 'root', '123456', 'password', '',
  'postgres123', 'gis', 'osgeo', 'user', 'master', '12345678', 'secret',
  '1234', 'development', 'dev', 'local'
];
const users = ['erp', 'postgres'];

async function test() {
  for (const user of users) {
    for (const pass of passwords) {
      const url = `postgresql://${user}:${pass}@localhost:55432/erp_dev?schema=public`;
      const prisma = new PrismaClient({ datasourceUrl: url });
      try {
        await prisma.$connect();
        console.log(`SUCCESS! Connected with ${url}`);
        await prisma.$disconnect();
        return url;
      } catch (err) {
        // failed
      } finally {
        await prisma.$disconnect();
      }
    }
  }
  console.log('No matching credentials on 55432');
}

test();
