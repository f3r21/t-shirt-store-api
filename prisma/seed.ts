import 'dotenv/config';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { databaseSsl } from '../src/prisma/database-ssl';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSsl(process.env.DATABASE_SSL_CA),
});
const prisma = new PrismaClient({ adapter });

/**
 * The demo accounts exist so a reviewer can sign in as a manager without
 * promoting a row by hand. They carry a password that is published in this file
 * and in the README, so they must never reach a deployed database. The roles
 * themselves are a different matter: sign-up fails without them, so they are
 * created in every environment.
 */
const DEMO_PASSWORD = 'Password123!';

async function main() {
  for (const name of ['manager', 'client', 'delivery_person']) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

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

  // One existing account can be made a manager by name, in any environment,
  // so a deployed store has a manager without the demo accounts below ever
  // reaching it. Idempotent: promoting a manager again changes nothing.
  const promote = process.env.SEED_MANAGER_EMAIL;
  if (promote !== undefined && promote !== '') {
    const manager = await prisma.role.findUniqueOrThrow({
      where: { name: 'manager' },
    });
    const promoted = await prisma.user.updateMany({
      where: { email: promote },
      data: { roleId: manager.id },
    });
    console.log(
      promoted.count === 1
        ? `promoted ${promote} to manager`
        : `no account ${promote} to promote`,
    );
  }

  if (process.env.NODE_ENV === 'production') {
    console.log('seeded roles and categories only, NODE_ENV is production');
    return;
  }

  const passwordHash = await argon2.hash(DEMO_PASSWORD);

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

  await prisma.user.upsert({
    where: { email: 'delivery@tshirt.store' },
    update: {},
    create: {
      email: 'delivery@tshirt.store',
      passwordHash,
      firstName: 'Deli',
      lastName: 'Very',
      role: { connect: { name: 'delivery_person' } },
    },
  });
}

main()
  .then(() => console.log('seeded'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
