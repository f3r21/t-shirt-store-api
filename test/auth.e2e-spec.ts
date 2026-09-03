import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import type { TestApp } from './app-factory';
import { createTestApp, ensureRoles, truncateAll } from './app-factory';

/**
 * The authentication flow against a real database: the guard, the pipe, the
 * filter, and the rotation as one statement against real Postgres.
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

    /**
     * The test above goes through the service, which folds the address before
     * the write. This one writes around the service, the way a seed or a raw
     * statement would, so what it proves is the column itself: `email` is
     * `citext`, and the unique index compares without regard to case. The first
     * create is the control that the direct path works at all.
     */
    it('refuses a second capitalisation of one address written outside the service', async () => {
      await http().post('/v1/users').send(CLIENT).expect(201);

      const outside = (email: string) =>
        ctx.prisma.user.create({
          data: {
            email,
            passwordHash: 'not a real hash',
            firstName: 'Ana',
            lastName: 'Ramirez',
            role: { connect: { name: 'client' } },
          },
        });

      await expect(outside('bob@example.com')).resolves.toMatchObject({
        email: 'bob@example.com',
      });
      await expect(outside('ANA@Example.COM')).rejects.toMatchObject({
        code: 'P2002',
      });
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
     * The scheme name is case-insensitive, per RFC 7235 section 2.1 and the
     * contract's `bearerAuth` scheme.
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
     * A structurally perfect token signed with the wrong key, minted through
     * `JwtService`. The same payload signed with the real secret is the
     * control.
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

    /**
     * An expired token through the real guard: `exp` is an explicit claim, so
     * only the clock is wrong. The same payload fifteen minutes ahead is the
     * control.
     */
    it('refuses an expired token with the access-token-expired type, and accepts the same payload before expiry', async () => {
      const { accessToken } = await signUpAndIn();
      const jwt = new JwtService({ secret: process.env.JWT_SECRET });
      const { sub, sid, role } = jwt.decode<{
        sub: number;
        sid: number;
        role: string;
      }>(accessToken);
      const now = Math.floor(Date.now() / 1000);

      const expired = await http()
        .get('/v1/auth/sessions')
        .set(
          'authorization',
          `Bearer ${await jwt.signAsync({ sub, sid, role, exp: now - 60 })}`,
        )
        .expect(401);
      expect(expired.body.type).toBe(
        'https://tshirt.store/problems/access-token-expired',
      );
      expect(expired.body.detail).toBe(
        'Refresh the token and send the request again.',
      );
      expect(expired.headers['www-authenticate']).toBe('Bearer');

      await http()
        .get('/v1/auth/sessions')
        .set(
          'authorization',
          `Bearer ${await jwt.signAsync({ sub, sid, role, exp: now + 900 })}`,
        )
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
     * The control for the grace window: a replay aged past it, by moving
     * `consumed_at` back, must still end every session. A window that never
     * closed would pass every two-tab test.
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
     * A token this server never issued is a string, not a replay: nothing is
     * deleted, and the live session still works afterwards, which is the
     * control.
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
     * Two honest tabs refresh the same token at once and the account
     * survives: two rows, one family. ADR 2.
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
     * The race winner refreshes after the window has closed, fifteen minutes
     * later in practice, and is still served.
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
     * Both racing tabs get an access token that works: the grace child's
     * token must name the family and not its own row. Both tokens, because
     * `Promise.all` keeps position and not completion order.
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
     * A token spent longer ago than the absolute cap is not a replay, or one
     * stolen token would be a permanent lever. The recent row is the control.
     */
    it.each([
      ['older than the absolute cap', 31 * 86400 * 1000, 1],
      ['spent an hour ago, which is inside the cap', 3600_000, 0],
    ])('a token spent %s', async (_l, ageMs, rowsLeft) => {
      const { refreshToken } = await signUpAndIn();
      await http().post('/v1/auth/refresh').send({ refreshToken }).expect(200);

      await ctx.prisma.consumedRefreshToken.updateMany({
        data: { consumedAt: new Date(Date.now() - ageMs) },
      });

      await http().post('/v1/auth/refresh').send({ refreshToken }).expect(401);

      expect(await ctx.prisma.refreshToken.count()).toBe(rowsLeft);
    });

    /**
     * The same token, sent again after the wipe, deletes nothing: the wipe
     * takes the consumed rows with it. The first round is the control.
     */
    it('a token spent inside the cap ends every session once, and never again', async () => {
      const { refreshToken } = await signUpAndIn();
      await http().post('/v1/auth/refresh').send({ refreshToken }).expect(200);
      await ctx.prisma.consumedRefreshToken.updateMany({
        data: { consumedAt: new Date(Date.now() - 3600_000) },
      });

      await http().post('/v1/auth/refresh').send({ refreshToken }).expect(401);
      expect(await ctx.prisma.refreshToken.count()).toBe(0);
      expect(await ctx.prisma.consumedRefreshToken.count()).toBe(0);

      await http()
        .post('/v1/auth/sessions')
        .send({ email: CLIENT.email, password: CLIENT.password })
        .expect(201);

      await http().post('/v1/auth/refresh').send({ refreshToken }).expect(401);
      expect(await ctx.prisma.refreshToken.count()).toBe(1);
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
     * Two devices, and the dead one is not the one asking: the list filters
     * dead rows, and a live caller has to ask.
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
     * The mail says every device was signed out, so an access token issued
     * before the reset must stop. The token is proven to work first.
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

  /**
   * `PATCH /users/me/password`, which no e2e test had ever requested. The
   * audit found it unit tested and nothing more, on the route that wipes every
   * session and mails the owner. Everything below is what the contract says
   * under `changePassword`, driven through the real guard, the real pipe and
   * the real database.
   */
  describe('change password', () => {
    const NEW_PASSWORD = 'an entirely new password';

    it('changes the password, ends every session, and mails the address', async () => {
      const laptop = await signUpAndIn();
      const phone = await http()
        .post('/v1/auth/sessions')
        .send({
          email: CLIENT.email,
          password: CLIENT.password,
          deviceName: 'Ana phone',
        })
        .expect(201);

      await http()
        .patch('/v1/users/me/password')
        .set('authorization', `Bearer ${laptop.accessToken}`)
        .send({ currentPassword: CLIENT.password, newPassword: NEW_PASSWORD })
        .expect(204);

      // The old password is gone and the new one works.
      await http()
        .post('/v1/auth/sessions')
        .send({ email: CLIENT.email, password: CLIENT.password })
        .expect(401);
      await http()
        .post('/v1/auth/sessions')
        .send({ email: CLIENT.email, password: NEW_PASSWORD })
        .expect(201);

      // Every session ended, the caller's included, and the guard enforces it
      // at once rather than when the tokens expire.
      for (const token of [
        laptop.accessToken,
        phone.body.accessToken as string,
      ]) {
        await http()
          .get('/v1/auth/sessions')
          .set('authorization', `Bearer ${token}`)
          .expect(401);
      }
      // One row, the sign-in with the new password, and no consumed record
      // left behind to wipe it.
      expect(await ctx.prisma.refreshToken.count()).toBe(1);
      expect(await ctx.prisma.consumedRefreshToken.count()).toBe(0);

      expect(ctx.mail.sent).toContainEqual({
        kind: 'changed',
        to: CLIENT.email,
      });
    });

    it('answers 401 with the invalid-credentials type for a wrong current password, and changes nothing', async () => {
      const { accessToken } = await signUpAndIn();

      const res = await http()
        .patch('/v1/users/me/password')
        .set('authorization', `Bearer ${accessToken}`)
        .send({
          currentPassword: 'not the current one',
          newPassword: NEW_PASSWORD,
        })
        .expect(401);
      expect(res.body.type).toBe(
        'https://tshirt.store/problems/invalid-credentials',
      );

      // Nothing changed: the old password signs in, the session that asked is
      // still alive, and no mail went out.
      await http()
        .post('/v1/auth/sessions')
        .send({ email: CLIENT.email, password: CLIENT.password })
        .expect(201);
      await http()
        .get('/v1/auth/sessions')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(ctx.mail.sent.filter((m) => m.kind === 'changed')).toEqual([]);
    });

    it('answers 401 to a caller with no token', async () => {
      await http()
        .patch('/v1/users/me/password')
        .send({ currentPassword: CLIENT.password, newPassword: NEW_PASSWORD })
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

    /**
     * **The signed-out device's own access token stops working at once.**
     *
     * The contract's Tokens paragraph said revocation lags by up to 15 minutes,
     * and the guard has checked the session on every request since `be3ad52`.
     * The two operation descriptions were corrected; the paragraph and this
     * assertion were not, so nothing pinned the sentence the contract now
     * makes. The phone is the control: the same request with a live session
     * still answers 200.
     */
    it("refuses the signed-out device's own access token at once", async () => {
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

      await http()
        .get('/v1/auth/sessions')
        .set('authorization', `Bearer ${first.accessToken}`)
        .expect(401);
      await http()
        .get('/v1/auth/sessions')
        .set('authorization', `Bearer ${second.body.accessToken as string}`)
        .expect(200);
    });

    /**
     * A token spent by a device that signed out ends nothing else, because the
     * family's consumed rows went with it. The phone is the assertion.
     */
    it('a token spent by a device that signed out ends nothing else', async () => {
      const laptop = await signUpAndIn();
      const phone = await http()
        .post('/v1/auth/sessions')
        .send({
          email: CLIENT.email,
          password: CLIENT.password,
          deviceName: 'Ana phone',
        })
        .expect(201);

      // The laptop rotates once, so the token it signed in with is on record
      // as spent, and then signs out.
      const rotated = await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: laptop.refreshToken })
        .expect(200);
      await http()
        .delete('/v1/auth/sessions/current')
        .set('authorization', `Bearer ${rotated.body.accessToken as string}`)
        .expect(204);

      // Past the grace window, so a record that survived would read as theft.
      await ctx.prisma.consumedRefreshToken.updateMany({
        data: { consumedAt: new Date(Date.now() - 3600_000) },
      });

      await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: laptop.refreshToken })
        .expect(401);

      await http()
        .get('/v1/auth/sessions')
        .set('authorization', `Bearer ${phone.body.accessToken as string}`)
        .expect(200);
      expect(await ctx.prisma.refreshToken.count()).toBe(1);
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
