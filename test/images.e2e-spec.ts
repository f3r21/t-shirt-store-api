import request from 'supertest';
import type { CatalogFixture, TestApp } from './app-factory';
import {
  createTestApp,
  ensureRoles,
  seedProductWithVariant,
  signInAs,
  truncateAll,
} from './app-factory';

/** A real 1 by 1 PNG, 67 bytes, so the sniff sees a signature and not a name. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const BASE = 'https://images.e2e.example';
const MIB = 1024 * 1024;

/**
 * The two image operations, end to end, with the object store in memory.
 *
 * What it covers that the unit spec cannot: multer's size limit answering
 * 413 before a byte is stored, the multipart field arriving as a string and
 * becoming the primary flag, the transaction keeping one primary per product,
 * the detail read listing the primary first, and the guard's 401, 403 on
 * these two routes. Every write is asserted on the row and on the store.
 */
describe('Product images (e2e)', () => {
  let ctx: TestApp;
  let manager: string;
  let client: string;
  let fixture: CatalogFixture;

  const http = () => request(ctx.app.getHttpServer());
  const bearer = (t: string) => `Bearer ${t}`;

  const upload = (
    t: string,
    productId: number,
    body: Buffer,
    options: { contentType?: string; isPrimary?: string } = {},
  ) => {
    let req = http()
      .post(`/v1/products/${productId}/images`)
      .set('Authorization', bearer(t))
      .attach('file', body, {
        filename: 'front.png',
        contentType: options.contentType ?? 'image/png',
      });
    if (options.isPrimary !== undefined) {
      req = req.field('isPrimary', options.isPrimary);
    }
    return req;
  };

  const remove = (t: string, id: number) =>
    http().delete(`/v1/images/${id}`).set('Authorization', bearer(t));

  const detail = () => http().get(`/v1/products/${fixture.productId}`);

  const rows = () =>
    ctx.prisma.productImage.findMany({
      where: { productId: fixture.productId },
      orderBy: { id: 'asc' },
    });

  const keyOf = (url: string) => url.slice(BASE.length + 1);

  beforeAll(async () => {
    ctx = await createTestApp();
    await ensureRoles(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    ctx.objects.clear();
    fixture = await seedProductWithVariant(ctx.prisma);
    manager = await signInAs(ctx, 'boss@example.com', 'manager');
    client = await signInAs(ctx, 'ana@example.com');
  });

  describe('the upload', () => {
    it('answers 201 with the Location and the image, and stores the object under a uuid key', async () => {
      const res = await upload(manager, fixture.productId, PNG).expect(201);

      const body = res.body as { id: number; url: string; isPrimary: boolean };
      expect(res.headers.location).toBe(`/v1/images/${body.id}`);
      expect(body).toEqual({
        id: expect.any(Number) as number,
        url: expect.stringMatching(
          new RegExp(
            `^${BASE}/images/products/${fixture.productId}/[0-9a-f-]{36}\\.png$`,
          ),
        ) as string,
        isPrimary: false,
      });
      expect(ctx.objects.objects.get(keyOf(body.url))).toEqual({
        body: PNG,
        contentType: 'image/png',
      });
      expect(await rows()).toEqual([
        expect.objectContaining({
          id: body.id,
          url: body.url,
          isPrimary: false,
        }),
      ]);
    });

    it('keeps one primary per product, and the detail lists it first', async () => {
      const first = await upload(manager, fixture.productId, PNG).expect(201);
      const second = await upload(manager, fixture.productId, PNG, {
        isPrimary: 'true',
      }).expect(201);
      const third = await upload(manager, fixture.productId, PNG, {
        isPrimary: 'true',
      }).expect(201);

      expect((second.body as { isPrimary: boolean }).isPrimary).toBe(true);
      expect((third.body as { isPrimary: boolean }).isPrimary).toBe(true);
      expect((await rows()).map((row) => row.isPrimary)).toEqual([
        false,
        false,
        true,
      ]);

      const res = await detail().expect(200);
      const images = (
        res.body as { images: { id: number; isPrimary: boolean }[] }
      ).images;
      expect(images.map((image) => image.id)).toEqual([
        (third.body as { id: number }).id,
        (first.body as { id: number }).id,
        (second.body as { id: number }).id,
      ]);
      expect(images.map((image) => image.isPrimary)).toEqual([
        true,
        false,
        false,
      ]);
    });

    // Written by hand against the service, 2026-09-03. Two primary uploads in
    // the same moment must still leave one primary: the second waits on the
    // product row and demotes the first once it can see it.
    it('keeps one primary when two primary uploads land in the same moment', async () => {
      const [first, second] = await Promise.all([
        upload(manager, fixture.productId, PNG, { isPrimary: 'true' }),
        upload(manager, fixture.productId, PNG, { isPrimary: 'true' }),
      ]);

      expect([first.status, second.status]).toEqual([201, 201]);
      const stored = await rows();
      expect(stored).toHaveLength(2);
      expect(stored.filter((row) => row.isPrimary)).toHaveLength(1);
      const res = await detail().expect(200);
      const images = (res.body as { images: { isPrimary: boolean }[] }).images;
      expect(images.map((image) => image.isPrimary)).toEqual([true, false]);
    });

    it('answers 415 for a text file declared as an image, and stores nothing', async () => {
      const res = await upload(
        manager,
        fixture.productId,
        Buffer.from('plain text, not an image', 'utf8'),
      ).expect(415);

      expect(res.body).toMatchObject({ status: 415 });
      expect(ctx.objects.objects.size).toBe(0);
      expect(await rows()).toEqual([]);
    });

    it('answers 413 above five mebibytes, and stores nothing', async () => {
      const big = Buffer.alloc(5 * MIB + 1);
      PNG.copy(big);

      const res = await upload(manager, fixture.productId, big).expect(413);

      expect(res.body).toMatchObject({ status: 413 });
      expect(ctx.objects.objects.size).toBe(0);
      expect(await rows()).toEqual([]);
    });

    it('answers 400 with no file, 404 for an unknown product, 403 for a client, 401 anonymous', async () => {
      await http()
        .post(`/v1/products/${fixture.productId}/images`)
        .set('Authorization', bearer(manager))
        .field('isPrimary', 'true')
        .expect(400);
      await upload(manager, 999999, PNG).expect(404);
      await upload(client, fixture.productId, PNG).expect(403);
      await http()
        .post(`/v1/products/${fixture.productId}/images`)
        .attach('file', PNG, {
          filename: 'front.png',
          contentType: 'image/png',
        })
        .expect(401);

      expect(ctx.objects.objects.size).toBe(0);
    });
  });

  describe('the delete', () => {
    it('answers 204, removes the row and the object, and leaves the product with no primary', async () => {
      const res = await upload(manager, fixture.productId, PNG, {
        isPrimary: 'true',
      }).expect(201);
      const body = res.body as { id: number; url: string };

      await remove(manager, body.id).expect(204);

      expect(await rows()).toEqual([]);
      expect(ctx.objects.objects.has(keyOf(body.url))).toBe(false);
      const product = await detail().expect(200);
      expect((product.body as { images: unknown[] }).images).toEqual([]);
    });

    it('answers 404 for an image that does not exist, and 403 for a client', async () => {
      await remove(manager, 999999).expect(404);

      const res = await upload(manager, fixture.productId, PNG).expect(201);
      const id = (res.body as { id: number }).id;
      await remove(client, id).expect(403);
      expect(await rows()).toHaveLength(1);
    });
  });
});
