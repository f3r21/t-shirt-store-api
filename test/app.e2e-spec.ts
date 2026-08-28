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
});
