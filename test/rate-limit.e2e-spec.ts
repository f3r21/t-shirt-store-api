import request from 'supertest';
import {
  createTestApp,
  ensureRoles,
  resetThrottleCounter,
  truncateAll,
  TestApp,
} from './app-factory';

/**
 * The rate limit, against the real counter.
 *
 * Every other suite replaces the throttler's storage, so nothing else in the
 * project proves a limit fires. That matters more here than usual: `@Throttle`
 * takes a plain record, so a misspelled key compiles, type checks, and is
 * silently ignored at run time. Only a request that comes back 429 shows the
 * decorator is wired to the throttler the guard reads.
 *
 * Three tiers, and the point of the suite is that they are different numbers:
 * browsing is loose, sign-in is tight, and the password operations are tighter
 * still. A single global limit cannot be all three.
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
   * The password tier, which is the one the challenge names by name.
   *
   * Five in fifteen minutes, so the sixth is refused. Six is the number that
   * matters: it passes under both other tiers, since browsing allows a hundred
   * and sign-in allows ten, so a 429 here can only come from a limit that is
   * tighter than either. A `@Throttle` whose key were misspelled, or an operation
   * that had silently fallen back to the global default, would answer 422 six
   * times and this assertion is the only thing in the project that would notice.
   *
   * The first five are 422 rather than 204 because the token is not a real one:
   * the body is well formed, so the pipe passes it, and the service rejects it on
   * its content. That is the contract's answer at `openapi.yaml:346-359`, and it
   * keeps the test free of any user row.
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
