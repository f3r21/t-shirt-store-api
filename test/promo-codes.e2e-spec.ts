import request from 'supertest';
import type { TestApp } from './app-factory';
import {
  createTestApp,
  ensureRoles,
  signInAs,
  truncateAll,
} from './app-factory';

/**
 * Promo codes, the manager's half of Optional Feature 13: the three
 * operations, who may call them, and the two rules the table enforces.
 *
 * The case-insensitive conflict is the case this suite exists for. The column
 * is `citext`, so `SAVE10` and `save10` are one code, and nothing but a real
 * database can prove that: a service spec sees the unique violation the mock
 * was told to raise, and a comparison written in TypeScript would pass this
 * suite while a plain `text` column let both rows in.
 */
describe('Promo codes (e2e)', () => {
  let ctx: TestApp;
  let manager: string;
  let client: string;

  const http = () => request(ctx.app.getHttpServer());
  const bearer = (t: string) => `Bearer ${t}`;

  const create = (t: string, body: Record<string, unknown>) =>
    http().post('/v1/promo-codes').set('Authorization', bearer(t)).send(body);

  const list = (t: string, query = '') =>
    http().get(`/v1/promo-codes${query}`).set('Authorization', bearer(t));

  const update = (t: string, id: number, body: Record<string, unknown>) =>
    http()
      .patch(`/v1/promo-codes/${id}`)
      .set('Authorization', bearer(t))
      .send(body);

  /** The smallest body the operation accepts, and the one most cases send. */
  const SAVE10 = {
    code: 'SAVE10',
    discountType: 'percentage',
    discountValue: 10,
  };

  const codeRow = (id: number) =>
    ctx.prisma.promoCode.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    ctx = await createTestApp();
    await ensureRoles(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    client = await signInAs(ctx, 'ana@example.com');
    manager = await signInAs(ctx, 'manager@example.com', 'manager');
  });

  describe('createPromoCode', () => {
    it('answers 401 when nobody is signed in', async () => {
      await http().post('/v1/promo-codes').send(SAVE10).expect(401);
    });

    it('answers 403 to a signed-in client', async () => {
      const res = await create(client, SAVE10).expect(403);

      expect(res.type).toBe('application/problem+json');
      expect(res.body).toMatchObject({ status: 403 });
    });

    /** The positive control for the two refusals above. */
    it('creates the code for a manager, and points at it with Location', async () => {
      const res = await create(manager, SAVE10).expect(201);

      expect(res.body).toEqual({
        id: expect.any(Number),
        code: 'SAVE10',
        discountType: 'percentage',
        discountValue: 10,
        usedCount: 0,
        isActive: true,
        createdAt: expect.any(String),
      });
      expect(res.headers.location).toBe(`/v1/promo-codes/${res.body.id}`);
    });

    it('carries the three optional rules back when the body names them', async () => {
      const res = await create(manager, {
        code: 'BIGSPEND',
        discountType: 'fixed',
        discountValue: 500,
        expiresAt: '2026-12-31T23:59:59.000Z',
        usageLimit: 100,
        minPurchase: 5000,
      }).expect(201);

      expect(res.body).toEqual({
        id: expect.any(Number),
        code: 'BIGSPEND',
        discountType: 'fixed',
        discountValue: 500,
        expiresAt: '2026-12-31T23:59:59.000Z',
        usageLimit: 100,
        usedCount: 0,
        minPurchase: 5000,
        isActive: true,
        createdAt: expect.any(String),
      });
    });

    it('answers 409 when the same code arrives twice', async () => {
      await create(manager, SAVE10).expect(201);

      const res = await create(manager, SAVE10).expect(409);

      expect(res.type).toBe('application/problem+json');
      expect(res.body).toMatchObject({ status: 409 });
      expect(await ctx.prisma.promoCode.count()).toBe(1);
    });

    it('answers 409 when the same code arrives in another case', async () => {
      await create(manager, SAVE10).expect(201);

      // The whole point of the `citext` column. With `text` this second
      // request would be a 201 and the store would hold two codes a buyer
      // cannot tell apart.
      await create(manager, { ...SAVE10, code: 'save10' }).expect(409);

      expect(await ctx.prisma.promoCode.count()).toBe(1);
    });

    it('keeps the case the manager typed', async () => {
      const res = await create(manager, { ...SAVE10, code: 'sAvE10' }).expect(
        201,
      );

      // Compared without case, stored as typed. A manager reads back what
      // they wrote.
      expect(res.body.code).toBe('sAvE10');
      expect((await codeRow(res.body.id)).code).toBe('sAvE10');
    });

    it('answers 400 to a percentage above 100', async () => {
      const res = await create(manager, {
        ...SAVE10,
        discountValue: 101,
      }).expect(400);

      expect(res.body.errors).toEqual([
        { field: 'discountValue', message: expect.any(String) },
      ]);
    });

    it('accepts a percentage of exactly 100, which is the control', async () => {
      await create(manager, { ...SAVE10, discountValue: 100 }).expect(201);
    });
  });

  describe('listPromoCodes', () => {
    it('answers 401 when nobody is signed in', async () => {
      await http().get('/v1/promo-codes').expect(401);
    });

    it('answers 403 to a signed-in client', async () => {
      await list(client).expect(403);
    });

    it('pages the codes newest first, with usedCount', async () => {
      const first = (await create(manager, SAVE10).expect(201)).body.id;
      const second = (
        await create(manager, { ...SAVE10, code: 'SAVE20' }).expect(201)
      ).body.id;

      // Written straight to the column: checkout is its only writer and that
      // is U3b, so a list that hard-coded zero would pass without this.
      await ctx.prisma.promoCode.update({
        where: { id: first },
        data: { usedCount: 3 },
      });

      const res = await list(manager).expect(200);

      expect(res.body.data.map((row: { id: number }) => row.id)).toEqual([
        second,
        first,
      ]);
      expect(res.body.meta).toEqual({ total: 2, limit: 20, offset: 0 });
      expect(res.body.data[1].usedCount).toBe(3);
      expect(res.body.data[0].usedCount).toBe(0);
    });

    it('honours limit and offset', async () => {
      await create(manager, SAVE10).expect(201);
      const second = (
        await create(manager, { ...SAVE10, code: 'SAVE20' }).expect(201)
      ).body.id;

      const res = await list(manager, '?limit=1&offset=0').expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(second);
      expect(res.body.meta).toEqual({ total: 2, limit: 1, offset: 0 });
    });

    it('lists a disabled code too, because a manager reads this list to find it', async () => {
      const id = (await create(manager, SAVE10).expect(201)).body.id;
      await update(manager, id, { isActive: false }).expect(200);

      const res = await list(manager).expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].isActive).toBe(false);
    });
  });

  describe('updatePromoCode', () => {
    let id: number;

    beforeEach(async () => {
      id = (await create(manager, SAVE10).expect(201)).body.id;
    });

    it('answers 401 when nobody is signed in', async () => {
      await http()
        .patch(`/v1/promo-codes/${id}`)
        .send({ isActive: false })
        .expect(401);
    });

    it('answers 403 to a signed-in client', async () => {
      await update(client, id, { isActive: false }).expect(403);
    });

    it('disables a code and enables it again', async () => {
      const disabled = await update(manager, id, { isActive: false }).expect(
        200,
      );
      expect(disabled.body.isActive).toBe(false);
      expect((await codeRow(id)).isActive).toBe(false);

      const enabled = await update(manager, id, { isActive: true }).expect(200);
      expect(enabled.body.isActive).toBe(true);
      expect((await codeRow(id)).isActive).toBe(true);
    });

    it('changes the discount and leaves the rest alone', async () => {
      const res = await update(manager, id, {
        discountType: 'fixed',
        discountValue: 250,
      }).expect(200);

      expect(res.body).toMatchObject({
        id,
        code: 'SAVE10',
        discountType: 'fixed',
        discountValue: 250,
        isActive: true,
      });
    });

    it('answers 404 on an unknown id', async () => {
      const res = await update(manager, id + 1000, {
        isActive: false,
      }).expect(404);

      expect(res.type).toBe('application/problem+json');
      expect(res.body).toMatchObject({ status: 404 });
    });

    it('answers 409 when the new code is one another row holds, in any case', async () => {
      await create(manager, { ...SAVE10, code: 'SAVE20' }).expect(201);

      await update(manager, id, { code: 'save20' }).expect(409);

      expect((await codeRow(id)).code).toBe('SAVE10');
    });

    it('answers 400 to a body that names no field', async () => {
      await update(manager, id, {}).expect(400);
    });

    it('does not accept usedCount, which checkout alone writes', async () => {
      const res = await update(manager, id, { usedCount: 9 }).expect(400);

      expect(res.body.errors).toEqual([
        { field: 'usedCount', message: expect.any(String) },
      ]);
    });
  });
});
