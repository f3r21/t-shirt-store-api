import request from 'supertest';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { TestApp } from './app-factory';
import { createTestApp } from './app-factory';

/**
 * The problems each failure lists in the served document, read over HTTP the
 * way a client reads `/docs-json`.
 *
 * Every failure pointed at the bare `Problem` schema, and the contract lists
 * its examples per status, so a reader could not tell which problems one
 * operation returns (issue 34). The served document lists, per operation,
 * what that operation throws, typed or not (issue 40). Whether each listed
 * type is one the contract allows at that status is the contract test's
 * check.
 */
describe('Problems each operation lists in the served document (e2e)', () => {
  let ctx: TestApp;
  let served: OpenAPIObject;

  type ProblemContent = {
    schema?: unknown;
    examples?: Record<string, { value?: Record<string, unknown> }>;
  };
  type Operation = {
    security?: Record<string, unknown>[];
    requestBody?: unknown;
    parameters?: { in?: string }[];
    responses?: Record<string, { content?: Record<string, ProblemContent> }>;
  };
  /** A typed problem as a client tells it apart: by type, shown by title. */
  type Typed = { type: string; title: string };

  const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

  const PROBLEM_BASE = 'https://tshirt.store/problems';
  const EMAIL_TAKEN = `${PROBLEM_BASE}/email-taken`;

  const typed = (name: string, title: string): Typed => ({
    type: `${PROBLEM_BASE}/${name}`,
    title,
  });
  const EXPIRED = typed('access-token-expired', 'Access token expired');
  const CREDENTIALS = typed('invalid-credentials', 'Invalid credentials');
  const REFRESH = typed('refresh-token-unknown', 'Refresh token unknown');
  const STOCK = typed('insufficient-stock', 'Not enough stock');
  const NOT_CANCELLABLE = typed(
    'order-not-cancellable',
    'Order cannot be cancelled',
  );
  const PROMO_UNKNOWN = typed('promo-code-unknown', 'Promo code unknown');
  const PROMO_EXPIRED = typed('promo-code-expired', 'Promo code expired');
  const PROMO_MINIMUM = typed(
    'promo-code-minimum',
    'Order below the promo code minimum',
  );
  const PROMO_EXHAUSTED = typed('promo-code-exhausted', 'Promo code exhausted');
  const PROMO = [PROMO_UNKNOWN, PROMO_EXPIRED, PROMO_MINIMUM, PROMO_EXHAUSTED];

  const NEEDS_TOKEN_DETAIL = 'This operation needs a bearer token.';

  // The details the code fills from the request, matched by shape.
  const STOCK_DETAIL =
    /^This variant has \d+ units on hand and the request asks for \d+\.$/;
  const EXPIRED_DETAIL =
    /^This promo code expired on \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\.$/;
  const MINIMUM_DETAIL =
    /^This promo code applies to a subtotal of \d+ or more, and this order is \d+\.$/;

  beforeAll(async () => {
    ctx = await createTestApp();
    const res = await request(ctx.app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    served = res.body as OpenAPIObject;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  /** The operation behind "POST /users" in the served document. */
  function operationAt(op: string): Operation | undefined {
    const [method, path] = op.split(' ');
    const item = served.paths[path] as Record<string, unknown> | undefined;
    return item?.[method.toLowerCase()] as Operation | undefined;
  }

  /** Every operation the served document lists, as "POST /users". */
  function operations(): string[] {
    return Object.entries(served.paths)
      .flatMap(([path, item]) => {
        const record = item as Record<string, unknown>;
        return METHODS.filter((m) => record[m]).map(
          (m) => `${m.toUpperCase()} ${path}`,
        );
      })
      .sort();
  }

  /** Whether the operation takes a token: its `security` names `bearerAuth`. */
  function takesToken(op: string): boolean {
    return (operationAt(op)?.security ?? []).some((r) => 'bearerAuth' in r);
  }

  /** Whether the operation takes a request body or a query parameter. */
  function takesInput(op: string): boolean {
    const operation = operationAt(op);
    return (
      operation?.requestBody !== undefined ||
      (operation?.parameters ?? []).some((p) => p.in === 'query')
    );
  }

  /** The problem body of "POST /users" at one status, or undefined. */
  function problemContent(
    op: string,
    status: string,
  ): ProblemContent | undefined {
    const content = operationAt(op)?.responses?.[status]?.content;
    return content?.['application/problem+json'];
  }

  /** The example values one failure lists, in the order it lists them. */
  function problemsAt(op: string, status: string): Record<string, unknown>[] {
    return Object.values(problemContent(op, status)?.examples ?? {}).map(
      (example) => example.value ?? {},
    );
  }

  function byType(a: Typed, b: Typed): number {
    return a.type.localeCompare(b.type);
  }

  /** The typed problems one failure lists, sorted by type, as a set. */
  function typedAt(op: string, status: string): Typed[] {
    return problemsAt(op, status)
      .filter((p) => typeof p.type === 'string')
      .map((p) => ({ type: p.type as string, title: p.title as string }))
      .sort(byType);
  }

  /** An expected list in the order `typedAt` returns. */
  function sorted(problems: Typed[]): Typed[] {
    return [...problems].sort(byType);
  }

  /** `typedAt` at every failure status one operation declares. */
  function typedByStatus(op: string): Record<string, Typed[]> {
    const statuses = Object.keys(operationAt(op)?.responses ?? {});
    return Object.fromEntries(
      statuses
        .filter((status) => Number(status) >= 400)
        .map((status): [string, Typed[]] => [status, typedAt(op, status)]),
    );
  }

  /** The problems with no type one failure lists, by title and detail. */
  function untypedAt(op: string, status: string): Record<string, unknown>[] {
    return problemsAt(op, status)
      .filter((p) => p.type === undefined)
      .map((p) => ({ title: p.title, detail: p.detail }));
  }

  /** The example detail of each typed problem one failure lists, by type. */
  function detailsAt(op: string, status: string): Record<string, unknown> {
    return Object.fromEntries(
      problemsAt(op, status)
        .filter((p) => typeof p.type === 'string')
        .map((p): [string, unknown] => [p.type as string, p.detail]),
    );
  }

  /**
   * Sign-up is the one operation that answers email-taken, and a client that
   * reads its type can offer sign-in instead. The title and detail are the
   * throw site's in `UsersService`.
   */
  it('lists email-taken on the sign-up 409, with its title and detail', () => {
    expect(problemsAt('POST /users', '409')).toEqual([
      {
        type: EMAIL_TAKEN,
        title: 'Email already registered',
        status: 409,
        detail: 'An account with this email already exists.',
      },
    ]);
  });

  /**
   * The contract's 409 lists email-taken for every operation, so a reader of
   * the contract sees it on POST /promo-codes, where it cannot happen. The
   * served document lists it on sign-up only. The sign-up line is the
   * control: a lookup that read nothing would pass the second.
   */
  it('lists no email-taken on the promo-code 409', () => {
    const types = (op: string) => problemsAt(op, '409').map((p) => p.type);

    expect(types('POST /users')).toContain(EMAIL_TAKEN);
    expect(types('POST /promo-codes')).not.toContain(EMAIL_TAKEN);
  });

  /**
   * A failure with no traced problem shows its status's default, the title
   * and detail of the contract's own 404 example, while the owner decides
   * between that and exempting it (the switch in `operation-problems.ts`).
   * One example on the schema it always had: not another operation's
   * problems, which one shared object would leak, and not an empty
   * `examples`.
   */
  it('shows the status default where no problem is traced', () => {
    expect(problemContent('DELETE /products/{id}', '404')).toEqual({
      schema: { $ref: '#/components/schemas/Problem' },
      examples: {
        default: {
          value: {
            title: 'Not found',
            status: 404,
            detail: 'The server did not find this resource.',
          },
        },
      },
    });
  });

  /**
   * Checkout refuses a promo code for one of four reasons, and a client shows
   * a different message for each, so the 422 lists all four, each with the
   * title and an example detail that `promo-code-rules.ts` builds.
   */
  it('lists the four promo-code problems on the checkout 422', () => {
    expect(typedAt('POST /orders', '422')).toEqual(sorted(PROMO));
    expect(detailsAt('POST /orders', '422')).toEqual({
      [PROMO_UNKNOWN.type]:
        'This promo code does not exist, or it is disabled.',
      [PROMO_EXPIRED.type]: expect.stringMatching(EXPIRED_DETAIL),
      [PROMO_MINIMUM.type]: expect.stringMatching(MINIMUM_DETAIL),
      [PROMO_EXHAUSTED.type]: 'This promo code reached its usage limit.',
    });
  });

  /**
   * Checkout also refuses a cart line above the stock on hand. A client
   * matches on the type, so this reads the typed problems only: an empty or
   * a changed cart is a 409 with no type.
   */
  it('lists insufficient-stock on the checkout 409', () => {
    expect(typedAt('POST /orders', '409')).toEqual([STOCK]);
    expect(detailsAt('POST /orders', '409')).toEqual({
      [STOCK.type]: expect.stringMatching(STOCK_DETAIL),
    });
  });

  /**
   * Checkout also refuses an empty cart, and a cart another checkout emptied
   * first. Neither has a type, so a client tells them apart by the detail
   * `OrdersService` sends, and they sit next to insufficient-stock: the
   * three answers a checkout screen maps to a message.
   */
  it('lists the empty and changed cart conflicts on the checkout 409', () => {
    const untyped = untypedAt('POST /orders', '409');

    expect(untyped).toHaveLength(2);
    expect(untyped).toEqual(
      expect.arrayContaining([
        { title: 'Conflict', detail: 'The cart is empty.' },
        {
          title: 'Conflict',
          detail:
            'The cart changed while the order was created. Read it again.',
        },
      ]),
    );
    expect(typedAt('POST /orders', '409')).toEqual([STOCK]);
  });

  /**
   * An unknown or expired reset token is the one 422 of reset-password, and
   * a client answers it by asking for a new link. The detail is the
   * contract's `resetToken` example, which `AuthService` sends as it is.
   */
  it('lists the reset-token problem on the reset-password 422', () => {
    expect(problemsAt('POST /auth/reset-password', '422')).toEqual([
      {
        title: 'Unprocessable content',
        status: 422,
        detail: 'The reset token is unknown or expired.',
      },
    ]);
  });

  /**
   * Exactly the typed problems at each status, because a type listed at the
   * wrong status misleads as much as a missing one. The cart add and checkout
   * are where a client needs the stock and promo-code messages.
   */
  it('lists exactly the typed problems of a cart add at each status', () => {
    expect(typedByStatus('POST /users/me/cart/items')).toEqual({
      '400': [],
      '401': [EXPIRED],
      '404': [],
      '409': [STOCK],
      '500': [],
    });
  });

  it('lists exactly the typed problems of checkout at each status', () => {
    expect(typedByStatus('POST /orders')).toEqual({
      '400': [],
      '401': [EXPIRED],
      '403': [],
      '409': [STOCK],
      '422': sorted(PROMO),
      '500': [],
    });
  });

  /**
   * An expired token is the one 401 a client answers by refreshing, so every
   * operation that takes a token lists it, the two reads where the token is
   * optional included, and no operation that takes none does: a public 401
   * is never about the access token.
   */
  it('lists access-token-expired at 401 wherever a token is taken', () => {
    const takingToken = operations().filter(takesToken);
    // The control: the `security` reader finds both optional reads and a
    // required operation, and leaves out sign-in, which is public.
    expect(takingToken).toEqual(
      expect.arrayContaining([
        'GET /products',
        'GET /products/{id}',
        'POST /orders',
      ]),
    );
    expect(takingToken).not.toContain('POST /auth/sessions');

    const listing = operations().filter((op) =>
      typedAt(op, '401').some((p) => p.type === EXPIRED.type),
    );
    expect(listing).toEqual(takingToken);
  });

  /**
   * The other 401 of the token guards has no type and one detail, for a
   * token that is absent, malformed or revoked, so the same operations list
   * it. The test above is the `security` reader's control.
   */
  it('lists the missing-token 401 wherever a token is taken', () => {
    const listing = operations().filter((op) =>
      untypedAt(op, '401').some((p) => p.detail === NEEDS_TOKEN_DETAIL),
    );
    expect(listing).toEqual(operations().filter(takesToken));
  });

  /**
   * The other typed problems, each at the operation that throws it. Sign-in
   * and refresh are public, so their 401 lists their own problem alone.
   */
  it.each([
    ['POST /auth/sessions', '401', [CREDENTIALS]],
    ['POST /auth/refresh', '401', [REFRESH]],
    ['PATCH /users/me/password', '401', [EXPIRED, CREDENTIALS]],
    ['PUT /users/me/cart/items/{variantId}', '409', [STOCK]],
    ['POST /payment-links', '409', [STOCK]],
    ['POST /orders/{id}/payments', '409', [STOCK]],
    ['PATCH /orders/{id}/status', '409', [NOT_CANCELLABLE]],
  ])('lists the typed problems of %s at %s', (op, status, expected) => {
    expect(typedAt(op, status)).toEqual(sorted(expected));
  });

  /**
   * Every failure of every operation names at least one example, so no
   * status leaves a reader with the bare schema (issue 40). The two
   * `toContainEqual` lines are the control: the walk reaches a failure with
   * traced problems and one that shows its status default.
   */
  it('names an example at every failure of every operation', () => {
    const failures = operations().flatMap((op) =>
      Object.keys(operationAt(op)?.responses ?? {})
        .filter((status) => Number(status) >= 400)
        .map((status): [string, string] => [op, status]),
    );
    expect(failures).toContainEqual(['POST /orders', '409']);
    expect(failures).toContainEqual(['DELETE /products/{id}', '404']);

    const bare = failures
      .filter(([op, status]) => problemsAt(op, status).length === 0)
      .map(([op, status]) => `${op} ${status}`);
    expect(bare).toEqual([]);
  });

  /**
   * An operation that validates a body or a query shows a 400 with `errors`,
   * the shape a client maps onto its form. The 400 default has no `errors`,
   * so the walk above cannot tell the two apart. The Stripe webhook is the
   * one body left out: the signature check reads its raw bytes, and nothing
   * validates its fields. Sign-up's 400 is the contract's own example.
   */
  it('shows a validation 400 wherever a body or a query is validated', () => {
    const validated = operations().filter(
      (op) => op !== 'POST /webhooks/stripe' && takesInput(op),
    );
    // The control: the input reader finds a body and a query.
    expect(validated).toEqual(
      expect.arrayContaining(['POST /users', 'GET /products']),
    );

    const missing = validated.filter(
      (op) => !problemsAt(op, '400').some((p) => Array.isArray(p.errors)),
    );
    expect(missing).toEqual([]);
    expect(problemsAt('POST /users', '400')).toEqual([
      {
        title: 'Validation failed',
        status: 400,
        detail: 'One or more fields did not pass validation.',
        errors: [{ field: 'email', message: 'must be a valid email address' }],
      },
    ]);
  });

  /**
   * The problems with no type, each at an operation that throws it. A client
   * tells them apart by the detail, so each row holds the whole example. A
   * detail the code fills from the order's status is matched by shape.
   */
  it.each([
    [
      'illegal move',
      'PATCH /orders/{id}/status',
      '409',
      'Conflict',
      expect.stringMatching(/^An order in status \w+ cannot move to \w+\.$/),
    ],
    [
      'order changed',
      'PATCH /orders/{id}/status',
      '409',
      'Conflict',
      'The order changed while this request ran. Read it again.',
    ],
    [
      'not pending',
      'POST /orders/{id}/payments',
      '409',
      'Conflict',
      expect.stringMatching(/^An order in status \w+ cannot be paid\.$/),
    ],
    [
      'below the minimum',
      'POST /orders/{id}/payments',
      '409',
      'Conflict',
      'The total of this order is below the smallest amount the payment provider accepts.',
    ],
    [
      'unknown category',
      'POST /products',
      '422',
      'Unprocessable content',
      'The request names a category that does not exist.',
    ],
    [
      'variant taken',
      'POST /products/{id}/variants',
      '409',
      'Conflict',
      'This product already has a variant with this size and color.',
    ],
    [
      'variant ordered',
      'DELETE /variants/{id}',
      '409',
      'Conflict',
      'This variant appears in an order. Set its stock to zero instead.',
    ],
    [
      'code taken',
      'POST /promo-codes',
      '409',
      'Conflict',
      'Another promo code already uses this code.',
    ],
    [
      'empty body',
      'PATCH /products/{id}',
      '400',
      'Validation failed',
      'Send at least one field.',
    ],
    // With no `errors`, so the validation example beside it does not match.
    [
      'malformed path id',
      'PATCH /products/{id}',
      '400',
      'Validation failed',
      'One or more fields did not pass validation.',
    ],
    // Its title is the handler's own, not the table's "Validation failed".
    [
      'missing file',
      'POST /products/{id}/images',
      '400',
      'Bad request',
      'The request carries no file. Send one in the `file` part.',
    ],
    [
      'unknown image type',
      'POST /products/{id}/images',
      '415',
      'Unsupported media type',
      'The file is not a PNG, JPEG, GIF or WebP image.',
    ],
    [
      'bad signature',
      'POST /webhooks/stripe',
      '400',
      'Validation failed',
      'The Stripe-Signature header does not verify against the body.',
    ],
  ])('lists the %s on %s at %s', (_kind, op, status, title, detail) => {
    expect(problemsAt(op, status)).toContainEqual({
      title,
      status: Number(status),
      detail,
    });
  });
});
