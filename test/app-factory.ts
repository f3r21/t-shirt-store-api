import type { INestApplication } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import Stripe from 'stripe';
import { PrismaService } from '../src/prisma/prisma.service';
import type { LowStockMail, Mailer } from '../src/mail/mailer';
import { MAILER } from '../src/mail/mailer';
import type { StripeClient } from '../src/payments/stripe.client';
import { STRIPE_CLIENT } from '../src/payments/stripe.client';
import type { ObjectStore } from '../src/images/object-store';
import { OBJECT_STORE } from '../src/images/object-store';
import {
  STOCK_QUEUE,
  stockQueueProvider,
} from '../src/stock-notifications/stock-queue';

/**
 * Every message the application tried to send during a test.
 *
 * The real adapter swallows a failed send on purpose, so a test that asserted
 * on SMTP would be asserting on Mailpit being up. This captures the call
 * instead, which is the behaviour the contract actually states.
 */
export interface CapturedMail {
  kind: 'reset' | 'changed' | 'low-stock';
  to: string;
  token?: string;
  mail?: LowStockMail;
}

export class MailerSpy implements Mailer {
  readonly sent: CapturedMail[] = [];
  private failures = 0;

  sendPasswordReset(to: string, token: string): Promise<void> {
    this.sent.push({ kind: 'reset', to, token });
    return Promise.resolve();
  }

  sendPasswordChanged(to: string): Promise<void> {
    this.sent.push({ kind: 'changed', to });
    return Promise.resolve();
  }

  /**
   * The one send that rejects the way the real one does, so the queue's retry
   * can be watched: `failNextSends(n)` makes the next `n` calls reject and
   * record nothing.
   */
  sendLowStock(to: string, mail: LowStockMail): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new Error('mail relay down, on purpose'));
    }
    this.sent.push({ kind: 'low-stock', to, mail });
    return Promise.resolve();
  }

  failNextSends(n: number): void {
    this.failures = n;
  }

  clear(): void {
    this.sent.length = 0;
    this.failures = 0;
  }
}

/**
 * The Stripe SDK with its two network calls replaced and its signer kept: a
 * test signs with `generateTestHeaderString` and the same secret, and the
 * server verifies for real.
 */
export class StripeStub implements StripeClient {
  readonly links: Stripe.PaymentLinkCreateParams[] = [];
  readonly intents: Stripe.PaymentIntentCreateParams[] = [];
  readonly webhooks = new Stripe('sk_test_e2e').webhooks;

  readonly paymentLinks = {
    create: (params: Stripe.PaymentLinkCreateParams) => {
      this.links.push(params);
      return Promise.resolve({
        id: 'plink_e2e',
        object: 'payment_link',
        url: 'https://buy.stripe.com/test_e2e',
        metadata: params.metadata ?? {},
      } as unknown as Stripe.Response<Stripe.PaymentLink>);
    },
  };

  readonly paymentIntents = {
    create: (params: Stripe.PaymentIntentCreateParams) => {
      this.intents.push(params);
      return Promise.resolve({
        id: 'pi_e2e',
        object: 'payment_intent',
        client_secret: 'pi_e2e_secret_x',
        amount: params.amount,
        metadata: params.metadata ?? {},
      } as unknown as Stripe.Response<Stripe.PaymentIntent>);
    },
  };

  clear(): void {
    this.links.length = 0;
    this.intents.length = 0;
  }
}

/**
 * The object store in memory: what the image service put, by key, and the
 * type it declared. The real binding is two S3 commands with a unit spec of
 * their own; what the suite proves is everything around them.
 */
export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  clear(): void {
    this.objects.clear();
  }
}

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  mail: MailerSpy;
  stripe: StripeStub;
  objects: MemoryObjectStore;
}

/**
 * A counter that never blocks, because every request arrives from 127.0.0.1.
 * The storage is replaced and not the guard, which `overrideGuard` cannot
 * reach under `APP_GUARD`, so the throttler still emits its headers.
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
 * Boot the real application through `configureApp`, so the suite gets the
 * prefix and the pipe the server runs. The counter is replaced unless
 * `{ throttle: true }`.
 *
 * `redisUrl` points the stock queue somewhere else. The address the
 * application reads is fixed when `ConfigModule.forRoot` runs, which is at
 * import time, so a spec cannot reach it through `process.env`. The production
 * factory is called here with the address the spec asks for, so the queue is
 * the real one and only its address differs.
 */
export async function createTestApp(
  options: { throttle?: boolean; redisUrl?: string } = {},
): Promise<TestApp> {
  const mail = new MailerSpy();
  const stripe = new StripeStub();
  const objects = new MemoryObjectStore();

  let builder: TestingModuleBuilder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MAILER)
    .useValue(mail)
    .overrideProvider(STRIPE_CLIENT)
    .useValue(stripe)
    .overrideProvider(OBJECT_STORE)
    .useValue(objects);

  if (options.throttle !== true) {
    builder = builder
      .overrideProvider(ThrottlerStorage)
      .useValue(new NeverBlocks());
  }

  if (options.redisUrl !== undefined) {
    const url = options.redisUrl;
    builder = builder
      .overrideProvider(STOCK_QUEUE)
      .useValue(stockQueueProvider.useFactory({ getOrThrow: () => url }));
  }

  const moduleRef = await builder.compile();

  // `bufferLogs` for the same reason `main.ts` passes it: the lines written
  // while the modules load wait for the pino logger `configureApp` installs,
  // which the suite runs at `silent`. `rawBody` for the same reason too: the
  // tested app has to keep the bytes the Stripe signature covers.
  const app = configureApp(
    moduleRef.createNestApplication({ bufferLogs: true, rawBody: true }),
  );
  await app.init();

  return { app, prisma: app.get(PrismaService), mail, stripe, objects };
}

/**
 * Empty the rate limiter's counter between tests, the way `truncateAll`
 * empties the tables, so the tier asserted is still the real one.
 */
export function resetThrottleCounter(ctx: TestApp): void {
  const storage = ctx.app.get<ThrottlerStorage>(ThrottlerStorage);
  const service = storage as {
    storage?: Map<string, unknown>;
    onApplicationShutdown?: () => void;
  };

  if (service.storage === undefined) {
    throw new Error(
      'the throttler storage carries no counter to reset, so this app was built without { throttle: true }',
    );
  }

  // The package's own teardown first: it clears the timers that would
  // otherwise fire on a cleared map and throw inside the worker.
  service.onApplicationShutdown?.();
  service.storage.clear();
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
  // Named and not left to CASCADE: `consumed_refresh_tokens`, `product_likes`
  // and `stock_notifications` would be reached only as a side effect, and
  // `stripe_events` has no foreign key at all.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "refresh_tokens", "consumed_refresh_tokens", "users", "products", "product_likes", "stock_notifications", "stripe_events" RESTART IDENTITY CASCADE',
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
    // Written straight to `product_images`, for the reason `seedOrderLineFor`
    // gives: no operation creates one yet, and the read has to be provable
    // before the upload lands. Rows are created in array order, so ids follow
    // it and a test can put the primary last to prove the order is not by id.
    images?: { url: string; isPrimary?: boolean }[];
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
      images: {
        create: (overrides.images ?? []).map((image) => ({
          url: image.url,
          isPrimary: image.isPrimary ?? false,
        })),
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
