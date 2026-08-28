import request from 'supertest';
import {
  createTestApp,
  ensureRoles,
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
  });

  /**
   * Sign-in is capped at ten a minute, so the eleventh is refused. The address is
   * varied per test through `X-Forwarded-For` because the counter is keyed on the
   * source address and the suite shares one process.
   */
  it('refuses the eleventh sign-in from one address', async () => {
    const body = { email: 'nobody@example.com', password: 'wrong password' };
    const ip = '203.0.113.10';

    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await http()
        .post('/v1/auth/sessions')
        .set('X-Forwarded-For', ip)
        .send(body);
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
    const ip = '203.0.113.11';
    let res = await http().post('/v1/auth/sessions').set('X-Forwarded-For', ip);
    for (let i = 0; i < 11; i++) {
      res = await http()
        .post('/v1/auth/sessions')
        .set('X-Forwarded-For', ip)
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
    const ip = '203.0.113.12';

    const codes: number[] = [];
    for (let i = 0; i < 20; i++) {
      const res = await http().get('/v1/products').set('X-Forwarded-For', ip);
      codes.push(res.status);
    }

    expect(codes).toEqual(Array(20).fill(200));
  });
});
