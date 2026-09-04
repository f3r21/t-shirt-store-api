import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import request from 'supertest';
import { parse as parseYaml } from 'yaml';
import type { TestApp } from './app-factory';
import { createTestApp } from './app-factory';

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

  /**
   * The two properties of the address `createTestApp` binds, because one case
   * in the suite failed at random with `socket hang up` without them: the
   * server listens, and it listens on 127.0.0.1 and not on every address. The
   * comment on the `listen` call in `app-factory.ts` holds the reason.
   *
   * A test that only made a request would pass either way, because supertest
   * binds a port itself for a server that carries no address. What it cannot
   * do is keep that address, so the address is what this asserts.
   */
  it('listens on 127.0.0.1, and a request leaves that address alone', async () => {
    const server = ctx.app.getHttpServer() as Server;
    expect(server.listening).toBe(true);

    const address = server.address() as AddressInfo;
    expect(address.address).toBe('127.0.0.1');

    await request(server).get('/v1').expect(200);

    // supertest closes only a server it opened itself, so the address holds.
    expect(server.listening).toBe(true);
    expect((server.address() as AddressInfo).port).toBe(address.port);
  });

  /**
   * `helmet()` and `enableCors()` sat side by side in `configure-app.ts` and
   * neither was asserted anywhere: `rg -in 'helmet|cors' test` exited 1.
   *
   * That is how CORS stayed on Nest's default for as long as it did. The
   * default is `Access-Control-Allow-Origin: *`, on every route including the
   * six manager-only catalog mutations, one line below the middleware whose
   * whole purpose is the opposite. Both reviews of this branch named it.
   */
  it('sends the helmet headers on an ordinary response', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/v1').expect(200);

    // One header from each of the two things helmet is usually kept for.
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    // And the one it removes, which is a header Express adds on its own.
    expect(res.headers).not.toHaveProperty('x-powered-by');
  });

  /**
   * The request id: echoed when well formed, generated when absent or
   * malformed (the control that the header is validated and not echoed), and
   * exposed to a browser.
   */
  it('echoes a well-formed X-Request-Id, and generates one for a missing or a malformed header', async () => {
    const UUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    const echoed = await request(ctx.app.getHttpServer())
      .get('/v1')
      .set('x-request-id', 'trace-42.a_b')
      .expect(200);
    expect(echoed.headers['x-request-id']).toBe('trace-42.a_b');

    const generated = await request(ctx.app.getHttpServer())
      .get('/v1')
      .expect(200);
    expect(generated.headers['x-request-id']).toMatch(UUID);

    const malformed = 'not ok: ' + 'x'.repeat(100);
    const replaced = await request(ctx.app.getHttpServer())
      .get('/v1')
      .set('x-request-id', malformed)
      .set('origin', 'https://shop.example')
      .expect(200);
    expect(replaced.headers['x-request-id']).toMatch(UUID);
    expect(replaced.headers['x-request-id']).not.toBe(malformed);
    expect(
      (replaced.headers['access-control-expose-headers'] ?? '').toLowerCase(),
    ).toContain('x-request-id');
  });

  /**
   * Both halves, and the second is the one that used to fail.
   *
   * A test that only asserted the echo for an allowed origin would pass just as
   * happily against the wildcard this replaced, because a wildcard allows the
   * allowed origin too. The refusal is what distinguishes a configured list
   * from no configuration at all.
   */
  it('echoes an allowed origin and stays silent for any other', async () => {
    const allowed = await request(ctx.app.getHttpServer())
      .get('/v1')
      .set('origin', 'https://shop.example')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://shop.example',
    );

    const refused = await request(ctx.app.getHttpServer())
      .get('/v1')
      .set('origin', 'https://evil.example')
      .expect(200);
    expect(refused.headers).not.toHaveProperty('access-control-allow-origin');
  });

  /**
   * Every header the contract promises is in the set a browser may read.
   * supertest reads them either way, so this is the gate; the names come from
   * following `$ref` into `components.responses`.
   */
  it('exposes every response header the contract declares', async () => {
    // The set a browser is told it may read, taken off a real response from an
    // allowed origin rather than out of the configuration object.
    const res = await request(ctx.app.getHttpServer())
      .get('/v1')
      .set('origin', 'https://shop.example')
      .expect(200);
    const exposed = new Set(
      (res.headers['access-control-expose-headers'] ?? '')
        .split(',')
        .map((h: string) => h.trim().toLowerCase())
        .filter((h: string) => h !== ''),
    );

    const contract = parseYaml(
      readFileSync(join(__dirname, '../contract/openapi.yaml'), 'utf8'),
    ) as {
      paths: Record<
        string,
        Record<string, { responses?: Record<string, unknown> }>
      >;
      components?: {
        responses?: Record<string, { headers?: Record<string, unknown> }>;
      };
    };

    const shared = contract.components?.responses ?? {};
    const declared = new Set<string>();
    for (const item of Object.values(contract.paths)) {
      for (const op of Object.values(item)) {
        for (const response of Object.values(op.responses ?? {})) {
          const r = response as {
            $ref?: string;
            headers?: Record<string, unknown>;
          };
          const target =
            typeof r.$ref === 'string'
              ? (shared[r.$ref.split('/').pop() ?? ''] ?? {})
              : r;
          Object.keys(target.headers ?? {}).forEach((h) => declared.add(h));
        }
      }
    }

    // The contract declares some. Without this the subset check below is
    // satisfied by an empty set, which is the failure mode of every
    // discovery-driven assertion in this repository.
    expect(declared.size).toBeGreaterThan(0);

    const unreadable = [...declared].filter(
      (h) => !exposed.has(h.toLowerCase()),
    );
    expect(unreadable).toEqual([]);
  });

  /**
   * The preflight, which is the request a browser actually sends first.
   *
   * A wildcard answers this one too, so the disallowed origin below is again
   * the half that carries the assertion.
   */
  it('answers a preflight for an allowed origin and not for another', async () => {
    const allowed = await request(ctx.app.getHttpServer())
      .options('/v1/products')
      .set('origin', 'https://shop.example')
      .set('access-control-request-method', 'GET');
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://shop.example',
    );

    const refused = await request(ctx.app.getHttpServer())
      .options('/v1/products')
      .set('origin', 'https://evil.example')
      .set('access-control-request-method', 'GET');
    expect(refused.headers).not.toHaveProperty('access-control-allow-origin');
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
   * A body over the parser limit is a plain `Error` with `status: 413`, not
   * an `HttpException`; without its branch it lands on the 500.
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
   * A body the parser cannot read arrives already wrapped by Nest, pinned so
   * the 413 branch cannot capture it by accident.
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

  /**
   * Where the documentation actually is.
   *
   * `configure-app.ts` carried a comment saying /v1/docs for as long as the line
   * existed, and that path answers 404. `SwaggerModule.setup` mounts on the
   * Express instance and ignores `setGlobalPrefix` unless told otherwise, so the
   * prefix never applied. The comment was the repository's only pointer to its
   * own documentation, which is the worst thing for it to be wrong about.
   */
  it.each([
    ['/docs', 200],
    ['/docs-json', 200],
    ['/v1/docs', 404],
  ])('serves %s with %i', async (path, status) => {
    await request(ctx.app.getHttpServer()).get(path).expect(status);
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
