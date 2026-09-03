import request from 'supertest';
import type { TestApp } from './app-factory';
import {
  createTestApp,
  ensureRoles,
  resetThrottleCounter,
  truncateAll,
} from './app-factory';

/**
 * The rate limit against the real counter, which every other suite replaces.
 * A misspelled `@Throttle` key compiles and is ignored, so only a 429 proves
 * a tier is wired. Three tiers, three different numbers.
 */
describe('Rate limiting (e2e)', () => {
  let ctx: TestApp;

  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp({ throttle: true });
    await ensureRoles(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    // The counter is state this suite writes, exactly like the tables, so it is
    // emptied the same way and at the same moment. Without this the five tests
    // share one bucket per handler and pass only in the order they are written:
    // `--randomize --seed=3` put this file in red.
    resetThrottleCounter(ctx);
  });

  /**
   * Sign-in is capped at ten a minute, so the eleventh is refused.
   *
   * Every request in this file arrives from 127.0.0.1 and shares one bucket per
   * handler. `beforeEach` empties that bucket, which is why each test can count
   * from zero. An earlier version varied `X-Forwarded-For` instead, which the
   * tracker never reads.
   */
  it('refuses the eleventh sign-in from one address', async () => {
    const body = { email: 'nobody@example.com', password: 'wrong password' };

    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await http().post('/v1/auth/sessions').send(body);
      codes.push(res.status);
    }

    // The first ten reach the handler and fail on credentials, not on the limit.
    expect(codes.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(codes[10]).toBe(429);
  });

  /**
   * `refreshSession` carries the sign-in tier. Every request sends a token
   * that was never issued, so the first ten are refused on the token and the
   * eleventh on the limit.
   */
  it('refuses the eleventh refresh from one address', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: `${i}`.padStart(64, 'f') });
      codes.push(res.status);
    }

    expect(codes.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(codes[10]).toBe(429);
  });

  /**
   * Sign-up is an enumeration oracle, so it carries the sign-in tier. Every
   * request uses a fresh address, so the eleventh is refused by the limit and
   * not by the conflict.
   */
  it('refuses the eleventh sign-up from one address', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await http()
        .post('/v1/users')
        .send({
          email: `probe-${i}@example.com`,
          password: 'correct horse battery',
          firstName: 'Probe',
          lastName: 'Account',
        });
      codes.push(res.status);
    }

    expect(codes.slice(0, 10)).toEqual(Array(10).fill(201));
    expect(codes[10]).toBe(429);
  });

  /**
   * The 429 has to be a problem document with a plain `Retry-After`. The header
   * name is the part worth asserting: `ThrottlerGuard` appends the throttler's
   * name to it, so a throttler keyed anything but `default` would answer
   * `Retry-After-<name>` and satisfy no client reading the contract.
   */
  it('answers 429 as a problem document with a plain Retry-After', async () => {
    let res = await http().post('/v1/auth/sessions');
    for (let i = 0; i < 11; i++) {
      res = await http()
        .post('/v1/auth/sessions')
        .send({ email: 'nobody@example.com', password: 'wrong password' });
    }

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.headers).not.toHaveProperty('retry-after-default');
    expect(res.type).toBe('application/problem+json');
    expect(res.body).toMatchObject({
      status: 429,
      title: 'Too many requests',
    });
  });

  /**
   * Browsing is the reason the global default is not the sign-in number. Twenty
   * catalog reads is an ordinary session and must not be refused, which fails if
   * the global limit is ever set at or below twenty.
   */
  it('lets twenty catalog reads through from one address', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 20; i++) {
      const res = await http().get('/v1/products');
      codes.push(res.status);
    }

    expect(codes).toEqual(Array(20).fill(200));
  });

  /**
   * The password tier: six passes under both other tiers, so a 429 here can
   * only come from the tightest one. The first five are 422, the contract's
   * answer to an unknown token, which keeps the test free of a user row.
   */
  it('refuses the sixth reset-password from one address', async () => {
    const body = { token: 'not-a-real-reset-token', password: 'Password123!' };

    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await http().post('/v1/auth/reset-password').send(body);
      codes.push(res.status);
    }

    // The first five reach the handler and fail on the token, not on the limit.
    expect(codes.slice(0, 5)).toEqual(Array(5).fill(422));
    expect(codes[5]).toBe(429);
  });

  /**
   * The password tier emits the same header shape as the sign-in tier.
   *
   * `PASSWORD_THROTTLE` overrides the entry named `default` for this reason
   * alone, because `ThrottlerGuard` suffixes its headers with the throttler name
   * and any other key would answer `Retry-After-<name>`. That key is a plain
   * record with no compile-time check, so only a 429 read off this tier shows it.
   */
  it('answers the password-tier 429 with a plain Retry-After', async () => {
    const body = { token: 'not-a-real-reset-token', password: 'Password123!' };

    let res = await http().post('/v1/auth/reset-password').send(body);
    for (let i = 0; i < 5; i++) {
      res = await http().post('/v1/auth/reset-password').send(body);
    }

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.headers).not.toHaveProperty('retry-after-default');
    expect(res.type).toBe('application/problem+json');
    expect(res.body).toMatchObject({
      status: 429,
      title: 'Too many requests',
    });
  });
});
