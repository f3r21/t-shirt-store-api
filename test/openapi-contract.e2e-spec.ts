import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenAPIObject } from '@nestjs/swagger';
import { buildOpenApiDocument } from '../src/openapi/document';
import type { TestApp } from './app-factory';
import { createTestApp } from './app-factory';
import type { Operation } from './openapi-documents';
import {
  EMAIL_TAKEN,
  fetchServedDocument,
  loadContract,
  operationAt,
  operationsOf,
} from './openapi-documents';

/**
 * The generated document against the hand-written contract, which wins.
 * Compared: the operations, their names, who may call them, the status codes,
 * whether every failure and success describes its body, request body
 * properties and required names, required query parameters, response headers,
 * every bound, the servers, and that no number is typed `number`. Problem
 * examples are compared by type, on the document `/docs-json` serves: the
 * types one operation lists at a status must be among the contract's types
 * for that status, a subset because the contract shares its examples across
 * every operation with that status. ADR 38. Not compared: other types,
 * formats, the titles and details of examples, and descriptions, apart from
 * the two reset operations, which `openapi-reset-descriptions.e2e-spec.ts`
 * compares.
 */
describe('OpenAPI document against the contract (e2e)', () => {
  let ctx: TestApp;
  let generated: OpenAPIObject;
  /** The same document as a client reads it, from `/docs-json`. */
  let served: OpenAPIObject;
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
     * Bounds the server enforces that the contract does not state: the `int4`
     * ceilings, the minimums no row could carry, and `uniqueItems` on
     * `categoryIds`. Only this side may be non-empty; a bound the contract
     * states and the server does not is never signed off.
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
      // The liked products page through the same `PageQueryDto`, so it
      // carries the same `offset` ceiling and nothing else.
      'GET /users/me/likes q.offset.maximum=2147483647',
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
      // The two order lists, twelve entries, the same decision. `total_cents`
      // and `user_id` are `int4`, an id below one names no row, and `offset`
      // is the ceiling the three older lists carry. The two `minimum=0` on
      // the price filters are what the contract's `Money` states, reached
      // through an `allOf` this check does not follow, so they are served-only
      // by the check's spelling and not by the server's promise.
      'GET /orders q.maxTotal.maximum=2147483647',
      'GET /orders q.maxTotal.minimum=0',
      'GET /orders q.minTotal.maximum=2147483647',
      'GET /orders q.minTotal.minimum=0',
      'GET /orders q.offset.maximum=2147483647',
      'GET /orders q.userId.maximum=2147483647',
      'GET /orders q.userId.minimum=1',
      'GET /users/me/orders q.maxTotal.maximum=2147483647',
      'GET /users/me/orders q.maxTotal.minimum=0',
      'GET /users/me/orders q.minTotal.maximum=2147483647',
      'GET /users/me/orders q.minTotal.minimum=0',
      'GET /users/me/orders q.offset.maximum=2147483647',
      // The delivery list pages through the same `PageQueryDto`, so it carries
      // the same `offset` ceiling and nothing else: its `status` is an enum of
      // two and its other two parameters are the shared page pair.
      'GET /deliveries q.offset.maximum=2147483647',
      // The payment link's body, the cart's decision again: two `int4`
      // columns and an id below one. The contract states `quantity.minimum=1`.
      'POST /payment-links body.quantity.maximum=2147483647',
      'POST /payment-links body.variantId.maximum=2147483647',
      'POST /payment-links body.variantId.minimum=1',
      'PATCH /variants/{id} body.price.maximum=2147483647',
      'PATCH /variants/{id} body.price.minimum=0',
      'PATCH /variants/{id}/stock body.stock.maximum=2147483647',
      'POST /products body.categoryIds.items.maximum=2147483647',
      'POST /products body.categoryIds.items.minimum=1',
      'POST /products body.categoryIds.uniqueItems=true',
      'POST /products/{id}/variants body.price.maximum=2147483647',
      'POST /products/{id}/variants body.price.minimum=0',
      'POST /products/{id}/variants body.stock.maximum=2147483647',
      // The promo codes, nine entries, the same three decisions. The `int4`
      // ceilings on the two amounts and the limit, the `offset` ceiling the
      // other lists carry, and `minPurchase.minimum=0`, which is what the
      // contract's `Money` states through an `allOf` this check does not
      // follow. `discountValue` has no ceiling here beyond `int4`: the
      // percentage stops at 100 and the fixed amount does not, so the bound
      // depends on `discountType` and lives in `PercentageAtMost100` rather
      // than in a `@Max` the document could carry.
      'GET /promo-codes q.offset.maximum=2147483647',
      'PATCH /promo-codes/{id} body.discountValue.maximum=2147483647',
      'PATCH /promo-codes/{id} body.minPurchase.maximum=2147483647',
      'PATCH /promo-codes/{id} body.minPurchase.minimum=0',
      'PATCH /promo-codes/{id} body.usageLimit.maximum=2147483647',
      'POST /promo-codes body.discountValue.maximum=2147483647',
      'POST /promo-codes body.minPurchase.maximum=2147483647',
      'POST /promo-codes body.minPurchase.minimum=0',
      'POST /promo-codes body.usageLimit.maximum=2147483647',
    ],
  };

  /** A media type's examples, as either document spells them. */
  type MediaExamples = {
    example?: { type?: unknown };
    examples?: Record<string, { value?: { type?: unknown } }>;
  };

  /** The parts of one response these checks read. */
  type ResponseParts = {
    $ref?: string;
    headers?: Record<string, unknown>;
    content?: Record<string, MediaExamples>;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    generated = buildOpenApiDocument(ctx.app);
    served = await fetchServedDocument(ctx);
    contract = loadContract();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

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
   * One response of an operation, with its `$ref` followed, because every
   * error response in the contract is a `$ref` into `components.responses`.
   */
  function responseAt(
    doc: OpenAPIObject,
    op: string,
    code: string,
  ): ResponseParts {
    const response = ((operationAt(doc, op)?.responses ?? {})[code] ??
      {}) as ResponseParts;
    if (typeof response.$ref !== 'string') return response;

    const name = response.$ref.split('/').pop() ?? '';
    const components: Record<string, unknown> =
      (doc.components as { responses?: Record<string, unknown> })?.responses ??
      {};
    return components[name] ?? {};
  }

  /** The header names one response declares. */
  function responseHeaders(
    doc: OpenAPIObject,
    op: string,
    code: string,
  ): string[] {
    return Object.keys(responseAt(doc, op, code).headers ?? {}).sort();
  }

  /**
   * The problem types one response lists, from its `examples` or a single
   * `example`, which is how the contract spells six of its failures. An
   * untyped problem has no type to compare, so it adds nothing.
   */
  function problemTypes(
    doc: OpenAPIObject,
    op: string,
    code: string,
  ): string[] {
    const content = responseAt(doc, op, code).content;
    const media = content?.['application/problem+json'];
    const values = [
      media?.example,
      ...Object.values(media?.examples ?? {}).map((e) => e.value),
    ];
    return values
      .map((value) => value?.type)
      .filter((type): type is string => typeof type === 'string');
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

  /**
   * Swagger UI sends "Try it out" to the first server. The deployed page
   * listed only `http://localhost:3000/v1`, so it called the reader's own
   * machine, and the page's `default-src 'self'` policy blocked even that. A
   * relative `/v1` is the host that serves the page, and it is same-origin.
   */
  it('lists the servers the contract lists, this host first', () => {
    const urls = (doc: OpenAPIObject) => (doc.servers ?? []).map((s) => s.url);

    expect(urls(generated)).toEqual(urls(contract));
    expect(urls(generated)[0]).toBe('/v1');
  });

  /** Every place a document says `type: number`, as a JSON pointer. */
  function numberTypes(node: unknown, at = '#'): string[] {
    if (Array.isArray(node)) {
      return node.flatMap((value, i) => numberTypes(value, `${at}/${i}`));
    }
    if (node === null || typeof node !== 'object') return [];

    const record = node as Record<string, unknown>;
    return [
      ...(record.type === 'number' ? [at] : []),
      ...Object.entries(record).flatMap(([key, value]) =>
        numberTypes(value, `${at}/${key}`),
      ),
    ];
  }

  /**
   * The contract types every id, count and amount `integer`. The plugin reads
   * a TypeScript `number` as `type: number`, so Swagger typed `variantId` as
   * any number and the 400 then said "must be an integer". The first assertion
   * is the tripwire: the day the contract types a field `number`, the served
   * document can no longer call every number an integer.
   */
  it('types every number as an integer, as the contract does', () => {
    expect(numberTypes(contract)).toEqual([]);
    expect(numberTypes(generated)).toEqual([]);
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

    // Every declared operation is served. The counts stay pinned, so an
    // operation added to the contract without a handler, or a handler deleted
    // by accident, shows up here as a number that moved.
    expect(implemented).toHaveLength(41);
    expect(missing).toHaveLength(0);
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
   * Whether a caller needs a token, which the contract spells three ways: the
   * root `security`, `security: []`, and `[{}, {bearerAuth: []}]` for
   * optional. Both sides reduce to one answer, so ordering cannot fail it.
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
   * A required parameter is a different API from an optional one. The
   * contract declares `limit` and `offset` once and references them, so the
   * `$ref` is followed.
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
   * A header the contract promises and the code sends must be documented:
   * `Location` inline on the 201s, `WWW-Authenticate` and `Retry-After`
   * behind a `$ref` on every 401 and 429.
   */
  it('declares the response headers the contract declares', () => {
    const wrong: string[] = [];
    for (const op of implementedOperations()) {
      for (const code of Object.keys(
        operationAt(contract, op)?.responses ?? {},
      )) {
        const expected = responseHeaders(contract, op, code);
        if (expected.length === 0) continue;
        const headers = responseHeaders(generated, op, code);
        if (headers.join(' ') !== expected.join(' ')) {
          wrong.push(
            `${op} ${code}: contract [${expected.join(' ')}] served [${headers.join(' ')}]`,
          );
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  /**
   * Each failure in the served document lists the problems its own operation
   * returns, and the contract shares one response per status: its 409 lists
   * email-taken, insufficient-stock and order-not-cancellable on every 409.
   * So the served types at a status are a subset of the contract's, not
   * equal to them. The two `toContain` lines are the control: both sides
   * yield a type, so an empty list below is a finding and not a reader that
   * reads nothing.
   */
  it('lists only problem types the contract gives each status', () => {
    const signUp = 'POST /users';
    expect(problemTypes(contract, signUp, '409')).toContain(EMAIL_TAKEN);
    expect(problemTypes(served, signUp, '409')).toContain(EMAIL_TAKEN);

    const wrong: string[] = [];
    for (const op of operationsOf(served)) {
      const codes = Object.keys(operationAt(served, op)?.responses ?? {});
      for (const code of codes) {
        const allowed = problemTypes(contract, op, code);
        for (const type of problemTypes(served, op, code)) {
          if (!allowed.includes(type)) wrong.push(`${op} ${code}: ${type}`);
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
   * The bounds in both directions. Serving a bound the contract does not
   * state is a signed decision in `DECLARED_DIFFERENCES.boundsNotInContract`;
   * failing to serve one it does state always fails.
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
