import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import {
  createTestApp,
  ensureRoles,
  truncateAll,
  TestApp,
} from './app-factory';

/**
 * The authentication flow, end to end, against a real database.
 *
 * The brief names this as the flow every other test depends on, so it goes in
 * first. What it covers that no unit test can: the guard actually running, the
 * global pipe actually validating, the problem filter actually shaping the body,
 * and the rotation being one statement against real Postgres rather than a mock
 * that answers whatever the test told it to.
 */
describe('Authentication (e2e)', () => {
  let ctx: TestApp;

  const CLIENT = {
    email: 'ana@example.com',
    password: 'correct horse battery',
    firstName: 'Ana',
    lastName: 'Ramirez',
  };

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
    ctx.mail.clear();
  });

  /** Register and sign in, returning both tokens and the session id. */
  const signUpAndIn = async () => {
    await http().post('/v1/users').send(CLIENT).expect(201);

    // Only the three fields the session body declares. The pipe runs with
    // `forbidNonWhitelisted`, so spreading the sign-up body here is a 400.
    const res = await http()
      .post('/v1/auth/sessions')
      .send({
        email: CLIENT.email,
        password: CLIENT.password,
        deviceName: 'Ana laptop',
      })
      .expect(201);

    return {
      accessToken: res.body.accessToken as string,
      refreshToken: res.body.refreshToken as string,
      location: res.headers.location,
    };
  };

  describe('sign up', () => {
    it('creates a client account and names it in Location', async () => {
      const res = await http().post('/v1/users').send(CLIENT).expect(201);

      expect(Object.keys(res.body).sort()).toEqual(
        ['createdAt', 'email', 'firstName', 'id', 'lastName', 'role'].sort(),
      );
      expect(res.body.role).toBe('client');
      expect(res.headers.location).toBe(`/v1/users/${res.body.id}`);
    });

    it('rejects a second sign-up on the same address with the email-taken type', async () => {
      await http().post('/v1/users').send(CLIENT).expect(201);

      const res = await http().post('/v1/users').send(CLIENT).expect(409);

      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body.type).toBe('https://tshirt.store/problems/email-taken');
      expect(res.body.title).toBe('Email already registered');
    });

    it('treats two capitalisations of one address as one account', async () => {
      await http().post('/v1/users').send(CLIENT).expect(201);

      await http()
        .post('/v1/users')
        .send({ ...CLIENT, email: 'ANA@Example.COM' })
        .expect(409);
    });

    it('rejects a role in the body rather than granting it', async () => {
      const res = await http()
        .post('/v1/users')
        .send({ ...CLIENT, role: 'manager' })
        .expect(400);

      expect(res.body.title).toBe('Validation failed');
      expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(
        'role',
      );
    });
  });

  describe('sign in and the protected route', () => {
    it('returns both tokens and a Location naming the session', async () => {
      const { accessToken, refreshToken, location } = await signUpAndIn();

      expect(accessToken.split('.')).toHaveLength(3);
      expect(refreshToken).toHaveLength(64);
      expect(location).toMatch(/^\/v1\/auth\/sessions\/\d+$/);
    });

    it('answers the same way for a wrong address and a wrong password', async () => {
      await http().post('/v1/users').send(CLIENT).expect(201);

      const wrongAddress = await http()
        .post('/v1/auth/sessions')
        .send({ email: 'nobody@example.com', password: CLIENT.password })
        .expect(401);

      const wrongPassword = await http()
        .post('/v1/auth/sessions')
        .send({ email: CLIENT.email, password: 'not the one at all' })
        .expect(401);

      expect(wrongAddress.body).toEqual(wrongPassword.body);
      expect(wrongAddress.body.type).toBe(
        'https://tshirt.store/problems/invalid-credentials',
      );
    });

    it('allows a protected route with the token', async () => {
      const { accessToken } = await signUpAndIn();

      const res = await http()
        .get('/v1/auth/sessions')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Object.keys(res.body).sort()).toEqual(['data', 'meta']);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].deviceName).toBe('Ana laptop');
      expect(res.body.data[0]).not.toHaveProperty('tokenHash');
    });

    it('refuses it without a token, and says so without naming a credential', async () => {
      await signUpAndIn();

      const res = await http().get('/v1/auth/sessions').expect(401);

      expect(res.headers['www-authenticate']).toBe('Bearer');
      expect(res.headers['content-type']).toContain('application/problem+json');
      // No credential was sent, so no credential can have been rejected.
      expect(res.body).not.toHaveProperty('type');
    });

    /**
     * The scheme name is case-insensitive, and the server used to disagree.
     *
     * RFC 7235 section 2.1 states it, and the contract selects that scheme by
     * name at `openapi.yaml:1697-1699`. Before this, `bearer <jwt>` answered 401
     * on every protected route with a body that said nothing about why, and the
     * guard's own spec had a row pinning that 401 as correct.
     */
    it.each(['Bearer', 'bearer', 'BEARER', 'BeArEr'])(
      'accepts the %s spelling of the scheme through a real request',
      async (scheme) => {
        const { accessToken } = await signUpAndIn();

        await http()
          .get('/v1/auth/sessions')
          .set('authorization', `${scheme} ${accessToken}`)
          .expect(200);
      },
    );

    it('still refuses a scheme that merely starts with bearer', async () => {
      // The control. Without it the fix could pass by accepting any scheme.
      const { accessToken } = await signUpAndIn();

      await http()
        .get('/v1/auth/sessions')
        .set('authorization', `bearerish ${accessToken}`)
        .expect(401);
    });

    it('refuses a malformed token', async () => {
      await signUpAndIn();

      await http()
        .get('/v1/auth/sessions')
        .set('authorization', 'Bearer not.a.token')
        .expect(401);

      await http()
        .get('/v1/auth/sessions')
        .set('authorization', 'Basic dXNlcjpwYXNz')
        .expect(401);
    });

    /**
     * A token that is structurally perfect and signed with the wrong key.
     *
     * The test above used to claim this in its own name and never do it: it
     * sent `Bearer not.a.token` and a `Basic` header, neither of which reaches
     * the signature check, and no test in this repository minted a foreign
     * token. **Verifying the signature is the guard's entire purpose**, and it
     * was covered only by a unit spec whose `verifyAsync` was a mock
     * programmed to reject, which asserts that the guard handles a rejection
     * rather than that a real forged token produces one.
     *
     * `JwtService` mints it rather than `jsonwebtoken` directly, because
     * `@nestjs/jwt` is a declared dependency of this project and its signing
     * library is not.
     *
     * The second call is the control. The same payload signed with the real
     * secret has to be accepted, or a guard that refused every token would pass
     * the first line.
     */
    it('refuses a token signed with another key, and accepts the same payload signed with the real one', async () => {
      const { accessToken } = await signUpAndIn();

      const payload = { sub: 1, sid: 1, role: 'client' };
      const foreign = new JwtService({
        secret: 'a-different-secret-of-at-least-32-chars',
        signOptions: { expiresIn: 900 },
      });

      await http()
        .get('/v1/auth/sessions')
        .set('authorization', `Bearer ${await foreign.signAsync(payload)}`)
        .expect(401);

      await http()
        .get('/v1/auth/sessions')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(200);
    });
  });

  describe('rotation', () => {
    it('issues new tokens and keeps the session id', async () => {
      const { accessToken, refreshToken } = await signUpAndIn();

      const before = await http()
        .get('/v1/auth/sessions')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(200);

      const res = await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(res.body.refreshToken).not.toBe(refreshToken);

      const after = await http()
        .get('/v1/auth/sessions')
        .set('authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);

      // Rotation updates the row in place, so the id a client holds stays valid.
      expect(after.body.data[0].id).toBe(before.body.data[0].id);
      expect(after.body.meta.total).toBe(1);
    });
    /**
     * **The control for the grace window, and it is worth more than the happy
     * path below it.** A window that never closed would satisfy every two-tab
     * test on this page and would have silently deleted reuse detection, which
     * is the failure this whole design could introduce with nothing saying so.
     *
     * The replay is aged past the window rather than sent immediately, because
     * an immediate replay is now the honest-tab case. `consumed_at` is what the
     * window is measured from, so that is the column moved back, and it is the
     * only way to reach the far side without sleeping the suite for
     * `REFRESH_GRACE_SECONDS`.
     */
    it('ends every session when a token is presented again after the grace window', async () => {
      const { refreshToken } = await signUpAndIn();

      await http().post('/v1/auth/refresh').send({ refreshToken }).expect(200);

      await ctx.prisma.consumedRefreshToken.updateMany({
        data: { consumedAt: new Date(Date.now() - 3600_000) },
      });

      const replay = await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      expect(replay.body.type).toBe(
        'https://tshirt.store/problems/refresh-token-unknown',
      );

      // Both halves. Rejecting without revoking leaves the thief signed in.
      expect(await ctx.prisma.refreshToken.count()).toBe(0);
    });

    /**
     * A token this server never issued is a string, not a replay.
     *
     * The previous version looked the presented hash up in
     * `previous_token_hash` with no liveness filter and no time bound, so
     * anything that happened to sit in that column ended every live session the
     * user had. Nothing may be deleted on the strength of a value the server
     * has no record of ever issuing.
     *
     * The second half is the control: the live session is still usable
     * afterwards, so this is not passing because the account was already empty.
     */
    it('deletes nothing when a token it never issued is presented', async () => {
      const { refreshToken } = await signUpAndIn();
      const before = await ctx.prisma.refreshToken.count();

      await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: 'f'.repeat(64) })
        .expect(401);

      expect(await ctx.prisma.refreshToken.count()).toBe(before);
      await http().post('/v1/auth/refresh').send({ refreshToken }).expect(200);
    });

    /**
     * Two honest tabs, no attacker, and the account survives.
     *
     * Rotation is one conditional write, so exactly one of two concurrent
     * refreshes of the same token can match. That is correct and it was only
     * half the story: the loser went to reuse detection, which found its hash
     * and did what the contract says to do with a stolen token, which is delete
     * every refresh row for that user. **One person with two tabs signed
     * themselves out of every device.** It reproduced on the first attempt, as
     * `200 401` with zero rows left.
     *
     * Two rows and one family is the shape that matters. The first fix kept one
     * row and rotated it for the loser, which passed a test exactly like this
     * one and left the winner holding a token that was about to look stolen.
     */
    it('lets two tabs refresh the same token at once, as one device', async () => {
      const { refreshToken } = await signUpAndIn();

      const [first, second] = await Promise.all([
        http().post('/v1/auth/refresh').send({ refreshToken }),
        http().post('/v1/auth/refresh').send({ refreshToken }),
      ]);

      expect([first.status, second.status]).toEqual([200, 200]);

      const rows = await ctx.prisma.refreshToken.findMany();
      expect(rows).toHaveLength(2);
      // Two rows, one device. `GET /auth/sessions` must say one, or the user is
      // offered two things to sign out of that are the same thing.
      expect(new Set(rows.map((r) => r.familyId ?? r.id)).size).toBe(1);
    });

    /**
     * **The test that would have caught the first fix, and did not exist.**
     *
     * Both tests written for the grace window refreshed again immediately, so
     * both ran inside the window. The winner of a real race does not: it
     * refreshes when its access token expires, fifteen minutes later, long
     * after the window has closed.
     *
     * The first fix rotated the winner's row for the loser and wrote the
     * winner's live token into `previous_token_hash`. At that point the
     * two-tab bug had not gone away, it had moved: instead of ending every
     * session immediately, it ended every session a quarter of an hour later,
     * where it was much harder to attribute to two tabs.
     *
     * A review in a session with none of this context found it. The tests
     * written by the author of the fix could not, because they were written
     * from the same picture of how it worked.
     */
    it('still serves the race winner after the window has closed', async () => {
      const { refreshToken } = await signUpAndIn();

      const [first, second] = await Promise.all([
        http().post('/v1/auth/refresh').send({ refreshToken }),
        http().post('/v1/auth/refresh').send({ refreshToken }),
      ]);
      expect([first.status, second.status]).toEqual([200, 200]);

      // The window closes. Everything spent so far is now old enough to be a
      // replay, which is exactly the state the winner refreshes in.
      await ctx.prisma.consumedRefreshToken.updateMany({
        data: { consumedAt: new Date(Date.now() - 3600_000) },
      });

      // Both tabs hold a token that was issued to them and never used. Both
      // must still work, and neither may end the other's session.
      await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: first.body.refreshToken as string })
        .expect(200);

      await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: second.body.refreshToken as string })
        .expect(200);
    });

    /**
     * **The test that was missing, and the reason it was missing.**
     *
     * Three tests race two tabs and assert statuses, row counts and families.
     * **Not one of them sends the `accessToken` anywhere.** `rg -n accessToken
     * test/auth.e2e-spec.ts` jumps straight over the whole race region, so the
     * token those 200s hand back was never once used.
     *
     * It was worthless: `refreshSession` signed it with `row.id`, and on the
     * grace path that row is a child in an existing family, so the guard's
     * lookup found neither a family with that id nor a founder with it. The
     * loser of an honest race got 200 and a token that answered 401 on every
     * protected route until it expired, and never recovered.
     *
     * The defect needed two commits that were each correct alone: one made a
     * session a family, the other made the guard read the session on every
     * request. **No test crossed that seam**, because each commit's tests
     * covered its own change.
     *
     * Both tokens, because Promise.all preserves position and not completion
     * order, so which one is the grace child is decided by the database.
     */
    it('gives both racing tabs an access token that works', async () => {
      const { refreshToken } = await signUpAndIn();

      const [first, second] = await Promise.all([
        http().post('/v1/auth/refresh').send({ refreshToken }),
        http().post('/v1/auth/refresh').send({ refreshToken }),
      ]);
      expect([first.status, second.status]).toEqual([200, 200]);

      for (const res of [first, second]) {
        await http()
          .get('/v1/auth/sessions')
          .set('authorization', `Bearer ${res.body.accessToken as string}`)
          .expect(200);
      }
    });

    /**
     * The third tab, which the first fix could not serve at all.
     *
     * With one row per device the grace path had exactly one row to rotate, so
     * a third concurrent refresh matched neither the live token, nor the one
     * the grace path had just overwritten, nor anything reuse detection knew
     * about. It got a 401 for being the third honest tab.
     *
     * A family holds as many rows as there are racers.
     */
    it('serves a third tab racing on the same token', async () => {
      const { refreshToken } = await signUpAndIn();

      const results = await Promise.all([
        http().post('/v1/auth/refresh').send({ refreshToken }),
        http().post('/v1/auth/refresh').send({ refreshToken }),
        http().post('/v1/auth/refresh').send({ refreshToken }),
      ]);

      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);

      const rows = await ctx.prisma.refreshToken.findMany();
      expect(new Set(rows.map((r) => r.familyId ?? r.id)).size).toBe(1);
    });
  });

  /**
   * The device list, against rows that have actually died.
   *
   * The unit test asserts the `where` handed to a mocked Prisma client, which
   * proves the service composed a filter and cannot prove the filter filters,
   * because no row ever exists there. This puts an expired row in the table.
   *
   * Nothing deletes a refresh row when its window closes, so before the filter
   * the list returned tokens that no longer work and `meta.total` counted them.
   */
  describe('the device list, with a dead row in the table', () => {
    /**
     * **Two devices, and the dead one is not the one asking.**
     *
     * This used to kill the only session and then list with that session's own
     * token, which stopped working the moment the guard started checking that a
     * session is alive. That is the guard being right: a device whose window
     * closed cannot call a protected route. The behaviour this test is about is
     * a different one, that `listSessions` filters dead rows, and it needs a
     * live caller to ask.
     *
     * The old shape conflated the two. This one separates them, and it is
     * closer to production, where a user with a dead session still has a live
     * one somewhere or they would be signing in again.
     */
    it('hides a session whose expiry has passed', async () => {
      const dead = await signUpAndIn();
      const alive = await http()
        .post('/v1/auth/sessions')
        .send({
          email: CLIENT.email,
          password: CLIENT.password,
          deviceName: 'Ana phone',
        })
        .expect(201);

      const before = await http()
        .get('/v1/auth/sessions')
        .set('authorization', `Bearer ${alive.body.accessToken as string}`)
        .expect(200);
      expect(before.body.meta.total).toBe(2);

      // The row stays, exactly as it would in production. Only its window moves.
      await ctx.prisma.refreshToken.updateMany({
        where: { deviceName: 'Ana laptop' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const after = await http()
        .get('/v1/auth/sessions')
        .set('authorization', `Bearer ${alive.body.accessToken as string}`)
        .expect(200);

      expect(after.body.data).toHaveLength(1);
      // The count has to move with the page, or the envelope reports rows the
      // caller cannot see.
      expect(after.body.meta.total).toBe(1);
      expect(after.body.data[0].deviceName).toBe('Ana phone');
      // And the row is still there, which is why the filter has to exist.
      expect(await ctx.prisma.refreshToken.count()).toBe(2);

      // The other half, now that the guard reads liveness too: the dead
      // device's own token stops working, which is the point of the window.
      await http()
        .get('/v1/auth/sessions')
        .set('authorization', `Bearer ${dead.accessToken}`)
        .expect(401);
    });

    /** Same two-device shape as above, and for the same reason. */
    it('hides a session created before the absolute cap', async () => {
      const dead = await signUpAndIn();
      const alive = await http()
        .post('/v1/auth/sessions')
        .send({
          email: CLIENT.email,
          password: CLIENT.password,
          deviceName: 'Ana phone',
        })
        .expect(201);

      await ctx.prisma.refreshToken.updateMany({
        where: { deviceName: 'Ana laptop' },
        data: { createdAt: new Date(Date.now() - 31 * 86400 * 1000) },
      });

      const res = await http()
        .get('/v1/auth/sessions')
        .set('authorization', `Bearer ${alive.body.accessToken as string}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].deviceName).toBe('Ana phone');

      // A session past the absolute cap cannot act either, which is what the
      // cap is for. Rotation already refused it; now every route does.
      await http()
        .get('/v1/auth/sessions')
        .set('authorization', `Bearer ${dead.accessToken}`)
        .expect(401);
    });
  });

  describe('password reset', () => {
    it('answers 202 for a known and an unknown address, and mails only one', async () => {
      await http().post('/v1/users').send(CLIENT).expect(201);

      await http()
        .post('/v1/auth/forgot-password')
        .send({ email: CLIENT.email })
        .expect(202);
      await http()
        .post('/v1/auth/forgot-password')
        .send({ email: 'nobody@example.com' })
        .expect(202);

      expect(ctx.mail.sent).toHaveLength(1);
      expect(ctx.mail.sent[0].to).toBe(CLIENT.email);
    });

    it('sets the password with the mailed token, once, and ends every session', async () => {
      await signUpAndIn();
      await http()
        .post('/v1/auth/forgot-password')
        .send({ email: CLIENT.email })
        .expect(202);

      const token = ctx.mail.sent[0].token as string;

      await http()
        .post('/v1/auth/reset-password')
        .send({ token, password: 'a different password' })
        .expect(204);

      // The token works one time only.
      await http()
        .post('/v1/auth/reset-password')
        .send({ token, password: 'a third password' })
        .expect(422);

      expect(await ctx.prisma.refreshToken.count()).toBe(0);

      // The new password works and the old one does not.
      await http()
        .post('/v1/auth/sessions')
        .send({ email: CLIENT.email, password: 'a different password' })
        .expect(201);
      await http()
        .post('/v1/auth/sessions')
        .send({ email: CLIENT.email, password: CLIENT.password })
        .expect(401);
    });

    /**
     * **The mail has to be true, and it was not.**
     *
     * `mailer.nodemailer.ts` tells the reader every device was signed out. The
     * reset deleted the refresh rows, and nothing checked the access token
     * against a session, so a token already in a thief's hand kept working for
     * the rest of its fifteen minutes. That sentence is read by somebody who
     * has just decided their account is compromised, which is the worst place
     * in this repository for a false statement.
     *
     * The order is the whole test. The token is proven to work first, so a
     * guard that had started refusing everything would fail here rather than
     * pass the assertion below it.
     */
    it('stops an access token issued before the reset', async () => {
      const { accessToken } = await signUpAndIn();

      // Alive before.
      await http()
        .get('/v1/auth/sessions')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(200);

      await http()
        .post('/v1/auth/forgot-password')
        .send({ email: CLIENT.email })
        .expect(202);
      await http()
        .post('/v1/auth/reset-password')
        .send({
          token: ctx.mail.sent[0].token as string,
          password: 'a different password',
        })
        .expect(204);

      // And dead after, without waiting fifteen minutes for it to expire.
      await http()
        .get('/v1/auth/sessions')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(401);
    });
  });

  describe('sign out', () => {
    it('signs this device out and leaves the others signed in', async () => {
      const first = await signUpAndIn();
      const second = await http()
        .post('/v1/auth/sessions')
        .send({
          email: CLIENT.email,
          password: CLIENT.password,
          deviceName: 'Ana phone',
        })
        .expect(201);

      await http()
        .delete('/v1/auth/sessions/current')
        .set('authorization', `Bearer ${first.accessToken}`)
        .expect(204);

      const left = await http()
        .get('/v1/auth/sessions')
        .set('authorization', `Bearer ${second.body.accessToken}`)
        .expect(200);

      expect(left.body.data).toHaveLength(1);
      expect(left.body.data[0].deviceName).toBe('Ana phone');
    });

    it('answers 404 for a session id that belongs to another user', async () => {
      const ana = await signUpAndIn();

      await http()
        .post('/v1/users')
        .send({ ...CLIENT, email: 'beto@example.com' })
        .expect(201);
      const beto = await http()
        .post('/v1/auth/sessions')
        .send({ email: 'beto@example.com', password: CLIENT.password })
        .expect(201);

      const anasSessionId = Number(ana.location.split('/').pop());

      // 404 and not 403: a 403 would confirm the session exists.
      const res = await http()
        .delete(`/v1/auth/sessions/${anasSessionId}`)
        .set('authorization', `Bearer ${beto.body.accessToken}`)
        .expect(404);

      expect(res.body.title).toBe('Not found');
      expect(res.body).not.toHaveProperty('type');
    });
  });
});
