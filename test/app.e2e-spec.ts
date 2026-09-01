import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { parse as parseYaml } from 'yaml';
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
   * **Every header the contract promises has to be readable by a browser.**
   *
   * This is the gate, and it is here because supertest is not a browser.
   * `Access-Control-Expose-Headers` is enforced on the client, so the server
   * sends `Location`, `WWW-Authenticate` and `Retry-After` whether or not they
   * are exposed, and every existing assertion in this suite reads them either
   * way. The defect was invisible to the harness rather than untested in it.
   *
   * So the assertion changes shape: instead of reading a header, it reads the
   * **set the server permits a browser to read** and requires the contract's
   * declared headers to be inside it. Declaring a new header in the contract
   * without exposing it turns this red, which is what makes it a gate rather
   * than three hard-coded names.
   *
   * The contract's names are collected by following `$ref` into
   * `components.responses`, the same hop `openapi-contract.e2e-spec.ts` needed
   * and did not have for a while.
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
