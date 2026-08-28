import request from 'supertest';
import {
  createTestApp,
  ensureRoles,
  truncateAll,
  TestApp,
} from './app-factory';

/**
 * Authorization, end to end, against the real guards.
 *
 * `RolesGuard` denies by default, and that is only worth anything if something
 * proves it. The guard is bound as an `APP_GUARD` beside `AccessTokenGuard`, so
 * two separate things need asserting and a unit test can reach neither: that the
 * two guards run in the right order, and that a manager still gets through.
 *
 * The third test is the positive control and the reason the other two mean
 * anything. A guard that refused every caller would satisfy the 401 and the 403
 * and be completely broken.
 */
describe('Authorization (e2e)', () => {
  let ctx: TestApp;

  const http = () => request(ctx.app.getHttpServer());

  const CLIENT = {
    email: 'client@example.com',
    password: 'correct horse battery',
    firstName: 'Cli',
    lastName: 'Ent',
  };

  /** Sign up, then sign in, and return the access token. */
  async function signIn(email: string, role?: 'manager'): Promise<string> {
    await http()
      .post('/v1/users')
      .send({ ...CLIENT, email })
      .expect(201);

    // A role cannot be requested at sign-up, and `auth.e2e-spec.ts` asserts the
    // 400 that proves it. A real manager is promoted out of band, so the test
    // does the same thing directly against the database.
    if (role) {
      await ctx.prisma.user.update({
        where: { email },
        data: { role: { connect: { name: role } } },
      });
    }

    const res = await http()
      .post('/v1/auth/sessions')
      .send({ email, password: CLIENT.password })
      .expect(201);
    return res.body.accessToken as string;
  }

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
   * deleting `@Roles('manager')` from `createProduct` left this route open to
   * every signed-in customer and no test noticed.
   */
  it('refuses a signed-in client a manager-only write', async () => {
    const token = await signIn('client@example.com');

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
    const token = await signIn('manager@example.com', 'manager');

    const res = await http()
      .post('/v1/products')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'Tee' })
      .expect(201);

    expect(res.body.name).toBe('Tee');
    expect(res.headers.location).toMatch(/^\/v1\/products\/\d+$/);
  });
});
