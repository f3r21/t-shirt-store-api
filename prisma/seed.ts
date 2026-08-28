import 'dotenv/config';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  for (const name of ['manager', 'client', 'delivery_person']) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  const passwordHash = await argon2.hash('Password123!');

  await prisma.user.upsert({
    where: { email: 'manager@tshirt.store' },
    update: {},
    create: {
      email: 'manager@tshirt.store',
      passwordHash,
      firstName: 'Mana',
      lastName: 'Ger',
      role: { connect: { name: 'manager' } },
    },
  });

  await prisma.user.upsert({
    where: { email: 'client@tshirt.store' },
    update: {},
    create: {
      email: 'client@tshirt.store',
      passwordHash,
      firstName: 'Clie',
      lastName: 'Nt',
      role: { connect: { name: 'client' } },
    },
  });

  // Categories, so a manager can create a product against a real id straight
  // after seeding. Upserted on the name for the same reason the roles are: the
  // seed has to be safe to run twice.
  for (const name of ['T-shirts', 'Hoodies', 'Accessories']) {
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
}

main()
  .then(() => console.log('seeded'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
