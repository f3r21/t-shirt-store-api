import request from 'supertest';
import {
  createTestApp,
  ensureRoles,
  signInAs,
  truncateAll,
  TestApp,
} from './app-factory';

/**
 * Authorization, end to end, against the real guards.
 *
 * `PoliciesGuard` denies by default, and that is only worth anything if
 * something proves it. The guard is bound as an `APP_GUARD` beside
 * `AccessTokenGuard`, so two separate things need asserting and a unit test can
 * reach neither: that the two guards run in the right order, and that a manager
 * still gets through. The abilities behind the verdicts are CASL's, built per
 * caller by `AbilityFactory`; the fourth test is the one route whose policy
 * reads the request and answers 401 or 403 by who asked.
 *
 * The third test is the positive control and the reason the other two mean
 * anything. A guard that refused every caller would satisfy the 401 and the 403
 * and be completely broken.
 */
describe('Authorization (e2e)', () => {
  let ctx: TestApp;

  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await ensureRoles(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
  });

  /**
   * The order assertion. `RolesGuard` and `AccessTokenGuard` are both
   * `APP_GUARD` providers, and Nest runs them in registration order. If the
   * roles guard ran first it would find no `request.user` on an anonymous call
   * and this would still not be 403, but the 401 it returns would come from the
   * wrong guard for the wrong reason. Pairing it with the 403 below pins the
   * order: only a token guard running first can produce both.
   */
  it('answers 401, not 403, when nobody is signed in', async () => {
    await http().post('/v1/products').send({ name: 'Tee' }).expect(401);
  });

  /**
   * The regression `ARCHITECTURE.md` names. Before the guard denied by default,
   * deleting the policy marker from `createProduct` left this route open to
   * every signed-in customer and no test noticed.
   */
  it('refuses a signed-in client a manager-only write', async () => {
    const token = await signInAs(ctx, 'client@example.com');

    const res = await http()
      .post('/v1/products')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'Tee' })
      .expect(403);

    expect(res.type).toBe('application/problem+json');
    expect(res.body).toMatchObject({ status: 403 });
  });

  /**
   * The positive control. Without this, a guard that refused everyone would pass
   * both tests above and look correct.
   */
  it('lets a manager through the same route', async () => {
    const token = await signInAs(ctx, 'manager@example.com', 'manager');

    const res = await http()
      .post('/v1/products')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'Tee' })
      .expect(201);

    expect(res.body.name).toBe('Tee');
    expect(res.headers.location).toMatch(/^\/v1\/products\/\d+$/);
  });

  /**
   * The one policy that reads the request. The contract answers a request for
   * the inactive products with 401 for nobody and 403 for a client, and the
   * decision used to live in the service; it is the guard's now, so the pair
   * is asserted against the guard.
   */
  it('answers 401 to nobody and 403 to a client who asks for the inactive products', async () => {
    await http()
      .get('/v1/products')
      .query({ includeInactive: true })
      .expect(401);

    const token = await signInAs(ctx, 'client@example.com');
    const res = await http()
      .get('/v1/products')
      .query({ includeInactive: true })
      .set('authorization', `Bearer ${token}`)
      .expect(403);

    expect(res.type).toBe('application/problem+json');
  });
});
