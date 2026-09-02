import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import Stripe from 'stripe';
import { PrismaService } from '../src/prisma/prisma.service';
import { LowStockMail, MAILER, Mailer } from '../src/mail/mailer';
import { STRIPE_CLIENT, StripeClient } from '../src/payments/stripe.client';

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
 * The Stripe SDK with its two network calls replaced and its signer kept.
 *
 * The Week 3 & 4 page names the Stripe API as the honest thing a test cannot
 * run, and says to stub it. This records what the service asked Stripe for,
 * so a test can assert the order id rode along, and answers the shapes the
 * service reads. `webhooks` is the real SDK's, because `constructEvent` is
 * pure HMAC over the body and the signature check is the production code
 * path: a test signs with `webhooks.generateTestHeaderString` and the same
 * secret `setup-e2e.ts` sets, and the server verifies for real.
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

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  mail: MailerSpy;
  stripe: StripeStub;
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
  const stripe = new StripeStub();

  let builder: TestingModuleBuilder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MAILER)
    .useValue(mail)
    .overrideProvider(STRIPE_CLIENT)
    .useValue(stripe);

  if (options.throttle !== true) {
    builder = builder
      .overrideProvider(ThrottlerStorage)
      .useValue(new NeverBlocks());
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

  return { app, prisma: app.get(PrismaService), mail, stripe };
}

/**
 * Empty the rate limiter's counter, the way `truncateAll` empties the tables.
 *
 * The throttler holds state across tests exactly as the database does, and the
 * suite that uses the real counter had no way to reset it. It varied
 * `X-Forwarded-For` per test instead, under a comment saying the counter is
 * keyed on the source address. It is, and the header never reaches it: the
 * tracker reads `req.ip`, Express does not populate that from the header unless
 * `trust proxy` is set, and `rg -n 'trust proxy|trustProxy' src test` exits 1.
 * The comment on `NeverBlocks` above had the truth written down the whole time.
 *
 * What that cost, measured:
 *
 *     jest --config ./test/jest-e2e.json test/rate-limit.e2e-spec.ts
 *       -> 5 passed
 *     the same, --randomize --seed=3
 *       -> 1 failed: "refuses the sixth reset-password from one address"
 *
 * Five tests shared one bucket per handler and passed only in the order they
 * were written. This resets the real counter instead of pretending to isolate
 * it, so the tier being asserted is still the real one.
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

  // **The timers go before the map, and that order is the whole fix.**
  //
  // `increment` schedules a `setTimeout` per record that decrements the entry
  // when its window closes. Clearing the map on its own leaves those timers
  // alive holding a key that is no longer there, and the callback destructures
  // the missing record. Reproduced against the installed package:
  //
  //     new ThrottlerStorageService()
  //       .increment('k', 50, 5, 0, 'default')
  //       .then(() => s.storage.clear())
  //     -> Cannot destructure property 'totalHits' of 'this.storage.get(...)'
  //        as it is undefined
  //
  // It threw inside a timer, so it is an uncaught exception in the worker
  // rather than a failed assertion. This suite survived on timing alone: every
  // window is 60 seconds or more and the run finished first. A slower machine
  // turns a green suite into a dead worker with nothing explaining why.
  //
  // `onApplicationShutdown` is the package's own teardown and clears both the
  // timeouts and the records, so this stops reaching past its API into a field
  // whose invariants it does not know.
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
  // Products join the list because the authorization suite creates one to prove
  // a manager is allowed through. CASCADE reaches variants and the join rows.
  // `consumed_refresh_tokens` is named rather than left to CASCADE. It would be
  // reached anyway through its user foreign key, and a table that is emptied
  // only as a side effect of another one is a table nobody remembers when the
  // foreign key changes.
  // `stripe_events` has no foreign key at all, so CASCADE would never reach
  // it, and a replay test in one spec would see an event id another spec
  // applied.
  // `product_likes` and `stock_notifications` are named for the reason
  // `consumed_refresh_tokens` is: both hang off users and variants and would
  // be reached, and both have a writer now.
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
