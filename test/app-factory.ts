import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
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
