import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { OpenAPIObject } from '@nestjs/swagger';
import { buildOpenApiDocument } from '../src/openapi/document';
import { createTestApp, TestApp } from './app-factory';

/**
 * The generated document against the hand written contract.
 *
 * The contract is authoritative. This suite is the thing that notices when the
 * code stops matching it, and it is the only reason generating a second
 * description of the same API is worth anything.
 *
 * **What it compares:** the set of operations, the name each one is served
 * under, who may call it, the status codes it declares, whether every failure
 * and every documented success describes its body, the property and required
 * names of each request body, which query parameters are required, which
 * response headers are declared, and every bound on a body property or query
 * parameter.
 *
 * **What it does not:** types, formats, examples and descriptions. Every integer
 * in the contract is served as `number` rather than `integer`, which is
 * imprecise and not wrong, and comparing descriptions would fail on wording.
 * That limit is stated here rather than left for a reader to find out.
 *
 * The first four of those checks were added on 2026-08-31, after an audit found
 * that the served document renamed all 19 operations, showed seven of them with
 * the wrong authentication, described 75 failures with no body at all, and
 * pointed readers at a file in another repository. Every one of those was green
 * here, because comparing status code keys says nothing about what sits under
 * them.
 *
 * The last four were added on 2026-09-01, after a second pass found fourteen
 * more differences that the first four were green on: three list operations
 * served a 200 with no body schema, which kept `ProductSummary`, `Session` and
 * `PageMeta` out of the document entirely; seven query parameters said
 * `required: true` against a contract that marks them optional; and four
 * `Location` headers the code sends were undocumented.
 *
 * That pass also retired a limit this file used to declare. It said bounds would
 * not be compared because "the contract expresses bounds the generated document
 * spells differently". Measured rather than inherited: fourteen bounds appear
 * only in the served document and zero appear only in the contract, so there was
 * no spelling noise, and the fourteen are one signed decision. A drift test is
 * only worth what it compares, and a stated limit is worth re-measuring.
 */
describe('OpenAPI document against the contract (e2e)', () => {
  let ctx: TestApp;
  let generated: OpenAPIObject;
  let contract: OpenAPIObject;

  /**
   * Differences that are correct, each with the reason.
   *
   * The list is the point of the suite. A diff with no exceptions would be red
   * on day one and get skipped. A diff that swallowed differences quietly would
   * be green and prove nothing. Every entry here is a difference somebody looked
   * at and signed off, and anything not on the list fails.
   */
  const DECLARED_DIFFERENCES = {
    /** Not an API operation. A liveness route the contract has no reason to describe. */
    operationsNotInContract: ['GET /'],

    /**
     * Bounds the server enforces that the contract does not state.
     *
     * One decision, fourteen entries, and the decision is that the server is
     * deliberately stricter than the contract wherever the storage layer or
     * the domain already refuses a value the contract admits. Refusing at the
     * edge turns a 500 into a 400.
     *
     * The seven `maximum` entries are the `int4` ceiling of the column behind
     * the field. Measured: a value above it made Postgres answer `P2020`, which
     * nothing mapped, which left a 500 on two routes reachable with no token.
     * `src/common/int4.ts` carries the measurement.
     *
     * The `minimum` entries refuse an id or a price no row could carry, and
     * `uniqueItems` refuses a `categoryIds` that names the same category twice,
     * which would otherwise be two identical join rows and a unique violation.
     *
     * **The comparison runs in both directions and only this side is allowed to
     * be non-empty.** A bound the contract states and the server does not is
     * never signed off here, because that is the server being looser than its
     * own promise. Measured when this list was written: fourteen served-only and
     * zero contract-only.
     */
    boundsNotInContract: [
      // The three `offset` ceilings are the newest entries and they arrived the
      // same way the seven before them did. `limit` has carried a `@Max` since
      // it was written and `offset` did not, so an integer the contract admits
      // reached Prisma's `skip`, which refuses it with a validation error that
      // nothing maps, and `GET /products` answered 500 with no token.
      'GET /auth/sessions q.offset.maximum=2147483647',
      'GET /categories q.offset.maximum=2147483647',
      'GET /products q.offset.maximum=2147483647',
      'GET /products q.categoryId.maximum=2147483647',
      'GET /products q.categoryId.minimum=1',
      'PATCH /products/{id} body.categoryIds.items.maximum=2147483647',
      'PATCH /products/{id} body.categoryIds.items.minimum=1',
      'PATCH /products/{id} body.categoryIds.uniqueItems=true',
      // The cart's four, the same decision: `product_variant_id` and
      // `quantity` are `int4`, and an id below one names no row. The contract
      // states `quantity.minimum=1` itself, so that one is absent here.
      'POST /users/me/cart/items body.quantity.maximum=2147483647',
      'POST /users/me/cart/items body.variantId.maximum=2147483647',
      'POST /users/me/cart/items body.variantId.minimum=1',
      'PUT /users/me/cart/items/{variantId} body.quantity.maximum=2147483647',
      'PATCH /variants/{id} body.price.maximum=2147483647',
      'PATCH /variants/{id} body.price.minimum=0',
      'PATCH /variants/{id}/stock body.stock.maximum=2147483647',
      'POST /products body.categoryIds.items.maximum=2147483647',
      'POST /products body.categoryIds.items.minimum=1',
      'POST /products body.categoryIds.uniqueItems=true',
      'POST /products/{id}/variants body.price.maximum=2147483647',
      'POST /products/{id}/variants body.price.minimum=0',
      'POST /products/{id}/variants body.stock.maximum=2147483647',
    ],
  };

  type Operation = {
    operationId?: string;
    security?: Record<string, unknown>[];
    responses?: Record<string, unknown>;
    requestBody?: { content?: Record<string, { schema?: unknown }> };
  };

  const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

  beforeAll(async () => {
    ctx = await createTestApp();
    generated = buildOpenApiDocument(ctx.app);
    contract = parseYaml(
      readFileSync(join(__dirname, '../contract/openapi.yaml'), 'utf8'),
    ) as OpenAPIObject;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  /** "POST /products", for both documents, so they compare as sets. */
  function operationsOf(doc: OpenAPIObject): string[] {
    return Object.entries(doc.paths)
      .flatMap(([path, item]) => {
        const record = item as Record<string, unknown>;
        return METHODS.filter((m) => record[m]).map(
          (m) => `${m.toUpperCase()} ${path}`,
        );
      })
      .sort();
  }

  /** The operation object behind "POST /products", or undefined. */
  function operationAt(doc: OpenAPIObject, op: string): Operation | undefined {
    const [method, path] = op.split(' ');
    const item = doc.paths[path] as Record<string, unknown> | undefined;
    return item?.[method.toLowerCase()] as Operation | undefined;
  }

  /** Follow a `$ref` one hop, inside the document it came from. */
  function deref(doc: OpenAPIObject, schema: unknown): Record<string, unknown> {
    const s = schema as Record<string, unknown> | undefined;
    if (!s) return {};
    if (typeof s.$ref !== 'string') return s;
    const name = s.$ref.split('/').pop() ?? '';
    const schemas: Record<string, unknown> = doc.components?.schemas ?? {};
    return (schemas[name] ?? {}) as Record<string, unknown>;
  }

  /**
   * The header names one response declares, with its `$ref` followed.
   *
   * **This hop is why the header check measured nothing.** The check read
   * `.headers` off the raw response object. Every error response in the
   * contract is a `$ref` into `components.responses`, so `.headers` was
   * `undefined` on all 36 of them and the loop skipped every one. The seven
   * inline `Location` headers were the only sites it ever compared, which is
   * exactly why it looked like it worked.
   *
   * `queryParams` below follows the same hop, and its docstring already names
   * it as the reason that check went unseen. The lesson was written down two
   * functions above this one and not applied here.
   */
  function responseHeaders(
    doc: OpenAPIObject,
    op: string,
    code: string,
  ): string[] {
    let response = ((operationAt(doc, op)?.responses ?? {})[code] ??
      {}) as Record<string, unknown>;

    if (typeof response.$ref === 'string') {
      const name = response.$ref.split('/').pop() ?? '';
      const components: Record<string, unknown> =
        (doc.components as { responses?: Record<string, unknown> })
          ?.responses ?? {};
      response = (components[name] ?? {}) as Record<string, unknown>;
    }

    return Object.keys(
      (response.headers as Record<string, unknown> | undefined) ?? {},
    ).sort();
  }

  /** Property names and required names, which is what actually drifts. */
  function requestShape(doc: OpenAPIObject, op: string): string {
    const content = operationAt(doc, op)?.requestBody?.content;
    const schema = deref(doc, content?.['application/json']?.schema);
    const props = Object.keys(schema.properties ?? {}).sort();
    const required = [
      ...((schema.required as string[] | undefined) ?? []),
    ].sort();
    return `props=[${props.join(' ')}] required=[${required.join(' ')}]`;
  }

  function statusCodesOf(doc: OpenAPIObject, op: string): string {
    return Object.keys(operationAt(doc, op)?.responses ?? {})
      .sort()
      .join(' ');
  }

  /** The 19 routes this service serves that the contract also declares. */
  function implementedOperations(): string[] {
    return operationsOf(generated).filter(
      (op) => !DECLARED_DIFFERENCES.operationsNotInContract.includes(op),
    );
  }

  /**
   * The served document points a reader at a file that exists here.
   *
   * It named `5-api-design/openapi.yaml`, which is the sibling repository this
   * copy came from and is not a path in this checkout. Two commits, `43b7995`
   * and `f96b834`, both claim to have repointed every contract reference, and
   * both missed this one because nothing read it. A reviewer who follows the
   * pointer and finds nothing trusts the rest of the document less.
   */
  it('points at a contract file this repository actually has', () => {
    const described = generated.info.description ?? '';
    const cited = described.match(/[\w/.-]+openapi\.yaml/)?.[0];

    expect(cited).toBeDefined();
    expect(existsSync(join(__dirname, '..', cited as string))).toBe(true);
  });

  it('describes only operations the contract declares', () => {
    const declared = operationsOf(contract);
    const extra = implementedOperations().filter(
      (op) => !declared.includes(op),
    );

    expect(extra).toEqual([]);
  });

  it('implements a strict subset, and pins how much is left', () => {
    const implemented = implementedOperations();
    const missing = operationsOf(contract).filter(
      (op) => !implemented.includes(op),
    );

    // Not an assertion that nothing is missing: 18 operations are Week 4 work.
    // It pins the counts, so finishing one without updating the contract, or
    // deleting one by accident, shows up here as a number that moved.
    expect(implemented).toHaveLength(24);
    expect(missing).toHaveLength(13);
    expect(implemented.length + missing.length).toBe(
      operationsOf(contract).length,
    );
  });

  it('declares the same status codes the contract declares', () => {
    const wrong = implementedOperations()
      .filter(
        (op) => statusCodesOf(generated, op) !== statusCodesOf(contract, op),
      )
      .map(
        (op) =>
          `${op}: generated [${statusCodesOf(generated, op)}] contract [${statusCodesOf(contract, op)}]`,
      );

    expect(wrong).toEqual([]);
  });

  /**
   * The name a generated client calls the method.
   *
   * Nest's default is `${controllerKey}_${methodKey}`, so without an
   * `operationIdFactory` every one of the 19 operations was served under a name
   * the contract does not use. Two clients generated from the two documents
   * would not compile against each other, and nothing here noticed.
   */
  it('names each operation the way the contract names it', () => {
    const wrong = implementedOperations()
      .filter(
        (op) =>
          operationAt(generated, op)?.operationId !==
          operationAt(contract, op)?.operationId,
      )
      .map(
        (op) =>
          `${op}: generated ${operationAt(generated, op)?.operationId} contract ${operationAt(contract, op)?.operationId}`,
      );

    expect(wrong).toEqual([]);
  });

  /**
   * Whether a caller needs a token, which the contract spells three ways.
   *
   * The root `security` is the default and means required. An operation's own
   * `security: []` means public. `[{}, {bearerAuth: []}]` is the 3.0.3 spelling
   * for optional, a token allowed and not required, and `listProducts` and
   * `getProduct` are the two that carry it.
   *
   * Comparing the arrays literally would fail on ordering, so both sides are
   * reduced to the answer a reader of the document actually wants: may I call
   * this without signing in.
   */
  function authOf(doc: OpenAPIObject, op: string): string {
    const requirements = operationAt(doc, op)?.security ?? doc.security ?? [];
    if (requirements.length === 0) return 'public';
    return requirements.some((r) => Object.keys(r).length === 0)
      ? 'optional'
      : 'required';
  }

  it('agrees with the contract on who may call each operation', () => {
    const wrong = implementedOperations()
      .filter((op) => authOf(generated, op) !== authOf(contract, op))
      .map(
        (op) =>
          `${op}: generated ${authOf(generated, op)} contract ${authOf(contract, op)}`,
      );

    expect(wrong).toEqual([]);
  });

  /**
   * Every failure the document describes has to say what the body looks like.
   *
   * RFC 9457 problem documents are this API's headline choice and the contract
   * gives all 94 error responses a `Problem` schema. A generated document that
   * describes them with a description and nothing else tells a client the
   * request can fail and not how to read the failure, which is the half that
   * matters: `type` is what a client branches on.
   */
  function untypedFailures(op: string): string[] {
    const responses = operationAt(generated, op)?.responses ?? {};
    return Object.entries(responses)
      .filter(([status]) => Number(status) >= 400)
      .filter(([, response]) => {
        const content = (response as { content?: Record<string, unknown> })
          .content;
        return content === undefined || Object.keys(content).length === 0;
      })
      .map(([status]) => `${op} ${status}`);
  }

  it('gives every failure a body schema', () => {
    const untyped = implementedOperations().flatMap(untypedFailures);

    expect(untyped).toEqual([]);
  });

  it('agrees with the contract on request body shapes', () => {
    const wrong = implementedOperations()
      .filter((op) => {
        const g = requestShape(generated, op);
        const c = requestShape(contract, op);
        const empty = 'props=[] required=[]';
        if (g === empty && c === empty) return false;
        return g !== c;
      })
      .map(
        (op) =>
          `${op}: generated ${requestShape(generated, op)} contract ${requestShape(contract, op)}`,
      );

    expect(wrong).toEqual([]);
  });

  /**
   * The three checks below were added on 2026-09-01, after a second pass found
   * fourteen more differences that everything above was green on.
   *
   * The pattern is the same one this file already records: comparing the keys of
   * a thing says nothing about what sits under them. The status codes matched
   * and the bodies were absent; the parameter names matched and their
   * requiredness was inverted; the operations matched and four declared headers
   * were missing.
   */

  /** Every success response the contract gives a body must carry one here. */
  function successWithoutBody(op: string): string[] {
    const cop = operationAt(contract, op);
    const gop = operationAt(generated, op);
    return ['200', '201']
      .filter((code) => {
        const c = (cop?.responses ?? {})[code] as { content?: unknown };
        const g = (gop?.responses ?? {})[code] as { content?: unknown };
        return c?.content !== undefined && g?.content === undefined;
      })
      .map((code) => `${op} ${code}`);
  }

  /**
   * The three list operations served a 200 with a description and nothing else.
   *
   * That is not a cosmetic gap. A schema reaches `components.schemas` only when
   * something references it, so the three missing payloads took `ProductSummary`,
   * `Session` and `PageMeta` with them and a client generated from the document
   * could not type any collection in the API.
   */
  it('gives every documented success a body schema', () => {
    const missing = implementedOperations().flatMap(successWithoutBody);

    expect(missing).toEqual([]);
  });

  /** A query parameter, with its `$ref` followed, from either document. */
  function queryParams(
    doc: OpenAPIObject,
    op: string,
  ): Map<string, { required: boolean }> {
    const raw = (operationAt(doc, op) as { parameters?: unknown[] } | undefined)
      ?.parameters;
    const out = new Map<string, { required: boolean }>();
    for (const entry of raw ?? []) {
      let p = entry as Record<string, unknown>;
      if (typeof p.$ref === 'string') {
        const name = p.$ref.split('/').pop() ?? '';
        const params: Record<string, unknown> =
          (doc.components as { parameters?: Record<string, unknown> })
            ?.parameters ?? {};
        p = (params[name] ?? {}) as Record<string, unknown>;
      }
      if (p.in !== 'query') continue;
      out.set(String(p.name), { required: p.required === true });
    }
    return out;
  }

  /**
   * A required parameter is a different API from an optional one.
   *
   * Seven entries across the three collections said `required: true` against a
   * contract that marks all seven optional and a server that defaults them. A
   * client generated from that document refuses to call `GET /products` without
   * a `limit`, for an API that has always accepted the call.
   *
   * The `$ref` hop is why this went unseen for so long: the contract declares
   * `limit` and `offset` once and references them, so a comparison that does not
   * follow the reference sees no parameters at all and passes.
   */
  it('agrees with the contract on which query parameters are required', () => {
    const wrong: string[] = [];
    for (const op of implementedOperations()) {
      const c = queryParams(contract, op);
      const g = queryParams(generated, op);
      for (const [name, spec] of c) {
        const mine = g.get(name);
        if (mine === undefined) {
          wrong.push(`${op} ${name}: served does not declare it`);
        } else if (mine.required !== spec.required) {
          wrong.push(
            `${op} ${name}: contract required=${spec.required} served required=${mine.required}`,
          );
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  /**
   * A header the contract promises and the code sends must be documented.
   *
   * Two kinds of header, and the second kind is the one this check could not
   * see until `responseHeaders` learned to follow a `$ref`.
   *
   * **Inline, on four 201s.** `Location`, set by `res.setHeader` in the
   * controllers. A client following the document has no reason to read the one
   * header that tells it where the thing it just created now lives.
   *
   * **Behind a `$ref`, on every 401 and every 429.**
   * `components/responses/Unauthorized` declares `WWW-Authenticate` as
   * "Required on every 401" and `TooManyRequests` declares `Retry-After`. The
   * runtime sends both, and `auth.e2e-spec.ts` and `rate-limit.e2e-spec.ts`
   * assert them. The document promised neither, on 36 sites, and this check
   * was green the whole time.
   */
  it('declares the response headers the contract declares', () => {
    const wrong: string[] = [];
    for (const op of implementedOperations()) {
      for (const code of Object.keys(
        operationAt(contract, op)?.responses ?? {},
      )) {
        const expected = responseHeaders(contract, op, code);
        if (expected.length === 0) continue;
        const served = responseHeaders(generated, op, code);
        if (served.join(' ') !== expected.join(' ')) {
          wrong.push(
            `${op} ${code}: contract [${expected.join(' ')}] served [${served.join(' ')}]`,
          );
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  const BOUND_KEYS = [
    'maximum',
    'minimum',
    'maxLength',
    'minLength',
    'uniqueItems',
  ];

  /** Every bound under a schema, flattened to `path.key=value` strings. */
  function boundsUnder(schema: unknown, prefix: string): string[] {
    const s = (schema ?? {}) as Record<string, unknown>;
    const out = BOUND_KEYS.filter((k) => s[k] !== undefined).map(
      (k) => `${prefix}.${k}=${String(s[k])}`,
    );
    if (s.items !== undefined) {
      out.push(...boundsUnder(s.items, `${prefix}.items`));
    }
    for (const [name, sub] of Object.entries(
      (s.properties ?? {}) as Record<string, unknown>,
    )) {
      out.push(...boundsUnder(sub, `${prefix}.${name}`));
    }
    return out;
  }

  /** Body and query bounds of one operation, in one document. */
  function boundsOf(doc: OpenAPIObject, op: string): string[] {
    const operation = operationAt(doc, op) as Operation & {
      parameters?: unknown[];
    };
    const body = deref(
      doc,
      operation?.requestBody?.content?.['application/json']?.schema,
    );
    const out = boundsUnder(body, 'body');

    for (const entry of operation?.parameters ?? []) {
      let p = entry as Record<string, unknown>;
      if (typeof p.$ref === 'string') {
        const name = p.$ref.split('/').pop() ?? '';
        const params: Record<string, unknown> =
          (doc.components as { parameters?: Record<string, unknown> })
            ?.parameters ?? {};
        p = (params[name] ?? {}) as Record<string, unknown>;
      }
      if (p.in !== 'query') continue;
      out.push(...boundsUnder(p.schema, `q.${String(p.name)}`));
    }
    return out;
  }

  /**
   * The bounds, in both directions, which this file used to say it would not do.
   *
   * The reason it gave was that "the contract expresses bounds the generated
   * document spells differently, and asserting on those would fail on spelling
   * rather than on substance". That was worth checking rather than inheriting.
   * Measured: fourteen bounds appear only in the served document and **zero**
   * appear only in the contract, so there is no spelling noise to drown the
   * signal. The fourteen are a single deliberate decision, listed and reasoned
   * in `DECLARED_DIFFERENCES.boundsNotInContract`.
   *
   * The two directions are not symmetric and the test treats them differently.
   * Serving a bound the contract does not state is the server being stricter
   * than its promise, which is a decision somebody can sign. Failing to serve a
   * bound the contract does state is the server being looser than its promise,
   * which is never signed off and always fails.
   */
  it('serves every bound the contract states, and no unsigned extras', () => {
    const servedOnly: string[] = [];
    const contractOnly: string[] = [];

    for (const op of implementedOperations()) {
      const c = new Set(boundsOf(contract, op));
      const g = new Set(boundsOf(generated, op));
      for (const b of g) if (!c.has(b)) servedOnly.push(`${op} ${b}`);
      for (const b of c) if (!g.has(b)) contractOnly.push(`${op} ${b}`);
    }

    expect(contractOnly).toEqual([]);
    expect(servedOnly.sort()).toEqual(
      [...DECLARED_DIFFERENCES.boundsNotInContract].sort(),
    );
  });
});
