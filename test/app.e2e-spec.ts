import request from 'supertest';
import { createTestApp, TestApp } from './app-factory';

describe('AppController (e2e)', () => {
  let ctx: TestApp;

  // `beforeAll`, not `beforeEach`. Booting the application once per test costs
  // a connection per test and proves nothing extra.
  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('serves the root route under the v1 prefix, without a token', async () => {
    await request(ctx.app.getHttpServer()).get('/v1').expect(200);
  });

  it('answers an unknown route with a problem document, not an echo of the path', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/v1/no-such-thing')
      .expect(404);

    expect(res.headers['content-type']).toContain('application/problem+json');
    // Nest puts "Cannot GET /v1/no-such-thing" in the message. A title must not
    // change between occurrences, so the path must not reach it.
    expect(res.body.title).toBe('Not found');
    expect(res.body.title).not.toContain('no-such-thing');
    expect(res.body.detail).toBe('The server did not find this resource.');
    // `instance` is the one member that identifies this occurrence, so the path
    // belongs there and only there.
    expect(res.body.instance).toBe('/v1/no-such-thing');
  });

  /**
   * A body larger than the parser accepts.
   *
   * `express.json()` defaults to a 100 KB limit and rejects a larger body before
   * any guard, pipe or handler runs. What it throws is a plain `Error` carrying
   * `status: 413` and `type: 'entity.too.large'`, and not an `HttpException`, so
   * it misses every branch of `toProblem` and lands on the unmapped 500.
   *
   * The status is the visible half. The other half is that the filter logs a 500
   * at error level, so a caller can fill the log with stack traces by posting a
   * large body to a route that needs no token.
   */
  it('answers 413 for a body over the parser limit, not 500', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/v1/users')
      .set('content-type', 'application/json')
      .send({ email: 'a@example.com', password: 'x'.repeat(200_000) })
      .expect(413);

    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.title).toBe('Content too large');
  });

  /**
   * The neighbouring case, which turned out not to be broken.
   *
   * A body the parser cannot read looked like the same hole one status down, and
   * it is not: Nest's adapter wraps that one into a `BadRequestException` before
   * the filter sees it, so the `HttpException` branch has always answered it.
   * Measured, by reading what reached the filter:
   *
   *     body over 100 KB   PayloadTooLargeError, raw
   *     body `{"email": `  BadRequestException, already wrapped
   *
   * It is pinned anyway, because the fix above added a branch that runs before
   * Prisma and could have captured this one by accident.
   */
  it('answers 400 for a body that is not valid JSON, and names no field', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/v1/users')
      .set('content-type', 'application/json')
      .send('{"email": ')
      .expect(400);

    expect(res.headers['content-type']).toContain('application/problem+json');
    // No `errors`. The parser never read a field, so there is none to name.
    expect(res.body.errors).toBeUndefined();
    // And no echo of the body or of V8's parse message in the title.
    expect(res.body.title).toBe('Validation failed');
  });

  it('still answers 400 with errors[] for a readable body, which is the control', async () => {
    // Without this the fix could pass by answering 400 to everything, and it
    // pins the difference: a body the parser read names its rejected fields.
    const res = await request(ctx.app.getHttpServer())
      .post('/v1/users')
      .set('content-type', 'application/json')
      .send({ email: 'not-an-email', password: 'short' })
      .expect(400);

    expect(res.body.detail).toBe('One or more fields did not pass validation.');
    expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(
      'email',
    );
  });
});
