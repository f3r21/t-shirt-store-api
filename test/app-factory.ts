import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { MAILER, Mailer } from '../src/mail/mailer';

/**
 * Every message the application tried to send during a test.
 *
 * The real adapter swallows a failed send on purpose, so a test that asserted
 * on SMTP would be asserting on Mailpit being up. This captures the call
 * instead, which is the behaviour the contract actually states.
 */
export interface CapturedMail {
  kind: 'reset' | 'changed';
  to: string;
  token?: string;
}

export class MailerSpy implements Mailer {
  readonly sent: CapturedMail[] = [];

  sendPasswordReset(to: string, token: string): Promise<void> {
    this.sent.push({ kind: 'reset', to, token });
    return Promise.resolve();
  }

  sendPasswordChanged(to: string): Promise<void> {
    this.sent.push({ kind: 'changed', to });
    return Promise.resolve();
  }

  clear(): void {
    this.sent.length = 0;
  }
}

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  mail: MailerSpy;
}

/**
 * A counter that never blocks.
 *
 * Every supertest request arrives from 127.0.0.1, so the whole suite shares one
 * bucket, and the password routes carry a fifteen minute window that does not
 * reset between tests. Without this, an assertion twenty requests into an
 * unrelated spec starts answering 429.
 *
 * The storage is replaced rather than the guard, because the guard is provided
 * under the `APP_GUARD` token rather than by its own class, and `overrideGuard`
 * does not reach it there. This leaves the real guard running, so the throttler
 * is still wired and still emits its headers, and only the counting is neutral.
 */
class NeverBlocks implements ThrottlerStorage {
  increment(): Promise<{
    totalHits: number;
    timeToExpire: number;
    isBlocked: boolean;
    timeToBlockExpire: number;
  }> {
    return Promise.resolve({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  }
}

/**
 * Boot the real application, configured the way `main.ts` configures it.
 *
 * `configureApp` is shared with `main.ts` on purpose. A suite that built
 * `AppModule` on its own would get no global prefix and no validation pipe, so
 * every assertion about a 400 would pass for the wrong reason.
 *
 * The throttler's counter is replaced by default, for the reason on
 * `NeverBlocks` above. A rate limit spec passes `{ throttle: true }` to keep the
 * real one.
 */
export async function createTestApp(
  options: { throttle?: boolean } = {},
): Promise<TestApp> {
  const mail = new MailerSpy();

  let builder: TestingModuleBuilder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MAILER)
    .useValue(mail);

  if (options.throttle !== true) {
    builder = builder
      .overrideProvider(ThrottlerStorage)
      .useValue(new NeverBlocks());
  }

  const moduleRef = await builder.compile();

  const app = configureApp(moduleRef.createNestApplication());
  await app.init();

  return { app, prisma: app.get(PrismaService), mail };
}

/**
 * Empty every table the tests write to, and leave `roles` alone.
 *
 * `roles` is a hard prerequisite rather than test data: `users.role_id` is not
 * null and the sign-up path reads the row by name, so truncating it makes every
 * later test fail with "Run the seed."
 *
 * `RESTART IDENTITY` keeps ids small and predictable across runs, and `CASCADE`
 * saves naming the child tables in dependency order.
 */
export async function truncateAll(prisma: PrismaService): Promise<void> {
  // Products join the list because the authorization suite creates one to prove
  // a manager is allowed through. CASCADE reaches variants and the join rows.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "refresh_tokens", "users", "products" RESTART IDENTITY CASCADE',
  );
}

/** The role rows the sign-up path requires, created without the full seed. */
export async function ensureRoles(prisma: PrismaService): Promise<void> {
  for (const name of ['manager', 'client', 'delivery_person']) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  }
}

/** The password every fixture account is created with. */
export const FIXTURE_PASSWORD = 'correct horse battery';

/**
 * Sign up an account, optionally promote it, and return its access token.
 *
 * A role cannot be asked for at sign-up, and `auth.e2e-spec.ts` asserts the 400
 * that proves it, so a manager is promoted directly against the database the way
 * a real one would be promoted out of band.
 *
 * This lives here rather than in one spec because two suites need the same
 * account and a second copy would drift from the first.
 */
export async function signInAs(
  ctx: TestApp,
  email: string,
  role?: 'manager' | 'client' | 'delivery_person',
): Promise<string> {
  const http = () => request(ctx.app.getHttpServer());

  await http()
    .post('/v1/users')
    .send({
      email,
      password: FIXTURE_PASSWORD,
      firstName: 'Test',
      lastName: 'Account',
    })
    .expect(201);

  if (role) {
    await ctx.prisma.user.update({
      where: { email },
      data: { role: { connect: { name: role } } },
    });
  }

  const res = await http()
    .post('/v1/auth/sessions')
    .send({ email, password: FIXTURE_PASSWORD })
    .expect(201);

  return (res.body as { accessToken: string }).accessToken;
}

/** A product with one variant, and the two ids a test needs to address them. */
export interface CatalogFixture {
  productId: number;
  variantId: number;
}

/**
 * One active product carrying one variant, written straight to the database.
 *
 * Prisma rather than HTTP on purpose: the anonymous and client cases need the
 * rows to exist without a manager token in play, and seeding through the API
 * would make those tests depend on the very authorization they are testing.
 */
export async function seedProductWithVariant(
  prisma: PrismaService,
  overrides: {
    name?: string;
    size?: string;
    color?: string;
    stock?: number;
    isActive?: boolean;
    categoryIds?: number[];
  } = {},
): Promise<CatalogFixture> {
  const product = await prisma.product.create({
    data: {
      name: overrides.name ?? 'Fixture Tee',
      isActive: overrides.isActive ?? true,
      variants: {
        create: {
          size: overrides.size ?? 'M',
          color: overrides.color ?? 'black',
          priceCents: 1999,
          stock: overrides.stock ?? 7,
        },
      },
      categories: {
        create: (overrides.categoryIds ?? []).map((categoryId) => ({
          categoryId,
        })),
      },
    },
    include: { variants: true },
  });

  return { productId: product.id, variantId: product.variants[0].id };
}

/**
 * One paid order carrying one line for this variant.
 *
 * Written straight to the database because no operation creates an order yet.
 * That is the point: `deleteVariant` promises a 409 for a variant an order
 * points at, and without these rows that branch could only be written, never
 * run. Every column here is required by the schema, and the four snapshots are
 * copied the way `createOrder` will copy them, so this fixture does not encode a
 * shape the real writer will contradict.
 */
export async function seedOrderLineFor(
  prisma: PrismaService,
  fixture: CatalogFixture,
  email: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const variant = await prisma.productVariant.findUniqueOrThrow({
    where: { id: fixture.variantId },
  });

  await prisma.order.create({
    data: {
      userId: user.id,
      status: 'paid',
      subtotalCents: variant.priceCents,
      totalCents: variant.priceCents,
      items: {
        create: {
          variantId: variant.id,
          productId: fixture.productId,
          productName: 'Fixture Tee',
          size: variant.size,
          color: variant.color,
          unitPriceCents: variant.priceCents,
          quantity: 1,
        },
      },
    },
  });
}

/**
 * A category row, by name, created once and reused.
 *
 * Upserted rather than created because `truncateAll` deliberately leaves
 * `categories` alone, the same way it leaves `roles` alone, so a second run of
 * the suite would collide on the unique name.
 */
export async function ensureCategory(
  prisma: PrismaService,
  name: string,
): Promise<number> {
  const row = await prisma.category.upsert({
    where: { name },
    update: {},
    create: { name },
  });
  return row.id;
}
