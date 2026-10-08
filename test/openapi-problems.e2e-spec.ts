import type { OpenAPIObject } from '@nestjs/swagger';
import type { TestApp } from './app-factory';
import { createTestApp } from './app-factory';
import {
  EMAIL_TAKEN,
  failureStatusesOf,
  fetchServedDocument,
  operationAt,
  operationsOf,
} from './openapi-documents';

/**
 * The problems each failure lists in the served document, read over HTTP the
 * way a client reads `/docs-json`.
 *
 * Every failure pointed at the bare `Problem` schema, and the contract lists
 * its examples per status, so a reader could not tell which problems one
 * operation returns. The served document lists, per operation, what that
 * operation throws, typed or not. ADR 38. Whether each listed type is one
 * the contract allows at that status is the contract test's check.
 */
describe('Problems each operation lists in the served document (e2e)', () => {
  let ctx: TestApp;
  let served: OpenAPIObject;

  type ProblemContent = {
    schema?: unknown;
    examples?: Record<string, { value?: Record<string, unknown> }>;
  };
  type ProblemResponse = { content?: Record<string, ProblemContent> };
  /** The parts of an operation that say whether it takes input. */
  type Inputs = { requestBody?: unknown; parameters?: { in?: string }[] };
  /** A typed problem as a client tells it apart: by type, shown by title. */
  type Typed = { type: string; title: string };

  const PROBLEM_BASE = 'https://tshirt.store/problems';

  const typed = (name: string, title: string): Typed => ({
    type: `${PROBLEM_BASE}/${name}`,
    title,
  });
  const EMAIL_TAKEN_PROBLEM = typed('email-taken', 'Email already registered');
  const TOKEN_EXPIRED = typed('access-token-expired', 'Access token expired');
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
  const PROMO_EXPIRED_DETAIL =
    /^This promo code expired on \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\.$/;
  const MINIMUM_DETAIL =
    /^This promo code applies to a subtotal of \d+ or more, and this order is \d+\.$/;

  beforeAll(async () => {
    ctx = await createTestApp();
    served = await fetchServedDocument(ctx);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  /** Whether the operation takes a token: its `security` names `bearerAuth`. */
  function takesToken(op: string): boolean {
    const security = operationAt(served, op)?.security ?? [];
    return security.some((r) => 'bearerAuth' in r);
  }

  /** Whether the operation takes a request body or a query parameter. */
  function takesInput(op: string): boolean {
    const operation = operationAt(served, op) as Inputs | undefined;
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
    const responses = operationAt(served, op)?.responses ?? {};
    const response = responses[status] as ProblemResponse | undefined;
    return response?.content?.['application/problem+json'];
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
    return Object.fromEntries(
      failureStatusesOf(served, op).map((status): [string, Typed[]] => [
        status,
        typedAt(op, status),
      ]),
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
   * A failure the code reaches only with its status's default title and
   * detail shows that default, here the contract's own 404 example. ADR 38.
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
   * A path id that is not an integer gets the 400 default, no specific
   * detail, so the map does not list it: it shows only through the status
   * default, where the 400 has no specific problem. ADR 38. The delete is
   * the control: its only 400 is the path id, so the default shows there.
   */
  it('shows the path-id 400 only where no specific 400 is listed', () => {
    const pathId = {
      title: 'Validation failed',
      status: 400,
      detail: 'One or more fields did not pass validation.',
    };

    const onDelete = problemsAt('DELETE /products/{id}', '400');
    const onUpdate = problemsAt('PATCH /products/{id}', '400');

    expect(onDelete).toEqual([pathId]);
    // The validation example and the empty body, so the check below reads a
    // list that is not empty.
    expect(onUpdate).toHaveLength(2);
    expect(onUpdate).not.toContainEqual(pathId);
  });

  /**
   * Checkout refuses a promo code for one of four reasons, and a client shows
   * a different message for each, so the 422 lists all four, each with the
   * title and an example detail that `promo-code-rules.ts` builds. The length
   * counts the problems with no type too, so a fifth 422 of any kind fails.
   */
  it('lists the four promo-code problems on the checkout 422', () => {
    expect(problemsAt('POST /orders', '422')).toHaveLength(4);
    expect(typedAt('POST /orders', '422')).toEqual(sorted(PROMO));
    expect(detailsAt('POST /orders', '422')).toEqual({
      [PROMO_UNKNOWN.type]:
        'This promo code does not exist, or it is disabled.',
      [PROMO_EXPIRED.type]: expect.stringMatching(PROMO_EXPIRED_DETAIL),
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
   * wrong status misleads as much as a missing one. Sign-up, the cart add and
   * checkout are where a client needs the email-taken, stock and promo-code
   * messages.
   */
  it('lists exactly the typed problems of sign-up at each status', () => {
    expect(typedByStatus('POST /users')).toEqual({
      '400': [],
      '409': [EMAIL_TAKEN_PROBLEM],
      '429': [],
      '500': [],
    });
  });

  it('lists exactly the typed problems of a cart add at each status', () => {
    expect(typedByStatus('POST /users/me/cart/items')).toEqual({
      '400': [],
      '401': [TOKEN_EXPIRED],
      '404': [],
      '409': [STOCK],
      '500': [],
    });
  });

  it('lists exactly the typed problems of checkout at each status', () => {
    expect(typedByStatus('POST /orders')).toEqual({
      '400': [],
      '401': [TOKEN_EXPIRED],
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
    const takingToken = operationsOf(served).filter(takesToken);
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

    const listing = operationsOf(served).filter((op) =>
      typedAt(op, '401').some((p) => p.type === TOKEN_EXPIRED.type),
    );
    expect(listing).toEqual(takingToken);
  });

  /**
   * The other 401 of the token guards has no type and one detail, for a
   * token that is absent, malformed or revoked, so the same operations list
   * it.
   */
  it('lists the missing-token 401 wherever a token is taken', () => {
    const takingToken = operationsOf(served).filter(takesToken);
    // The control: two empty lists compare equal, so the `security` reader
    // must find an operation that takes a token.
    expect(takingToken).toContain('POST /orders');

    const listing = operationsOf(served).filter((op) =>
      untypedAt(op, '401').some((p) => p.detail === NEEDS_TOKEN_DETAIL),
    );
    expect(listing).toEqual(takingToken);
  });

  /**
   * The other typed problems, each at the operation that throws it. Sign-in
   * and refresh are public, so their 401 lists their own problem alone.
   */
  it.each([
    ['POST /auth/sessions', '401', [CREDENTIALS]],
    ['POST /auth/refresh', '401', [REFRESH]],
    ['PATCH /users/me/password', '401', [TOKEN_EXPIRED, CREDENTIALS]],
    ['PUT /users/me/cart/items/{variantId}', '409', [STOCK]],
    ['POST /payment-links', '409', [STOCK]],
    ['POST /orders/{id}/payments', '409', [STOCK]],
    ['PATCH /orders/{id}/status', '409', [NOT_CANCELLABLE]],
  ])('lists the typed problems of %s at %s', (op, status, expected) => {
    expect(typedAt(op, status)).toEqual(sorted(expected));
  });

  /**
   * Every failure of every operation names at least one example, so no
   * status leaves a reader with the bare schema. ADR 38. About half the
   * failures show their status default, so the walk mostly checks that rule.
   * It still fails on a 401, 409 or 422 the map does not list, because those
   * statuses have no default. The two `toContainEqual` lines are the
   * control: the walk reaches a failure with traced problems and one that
   * shows its status default.
   *
   * Checkout's 403 is the one failure exempted, and it must stay bare: the
   * policy guard can refuse checkout, but every signed-in role may place an
   * order and apply a promo code, so no caller reaches it today. A default
   * there would name a problem the API never sends.
   */
  it('names an example at every failure of every operation', () => {
    const failures = operationsOf(served).flatMap((op) =>
      failureStatusesOf(served, op).map((status): [string, string] => [
        op,
        status,
      ]),
    );
    expect(failures).toContainEqual(['POST /orders', '409']);
    expect(failures).toContainEqual(['DELETE /products/{id}', '404']);

    const bare = failures
      .filter(([op, status]) => problemsAt(op, status).length === 0)
      .map(([op, status]) => `${op} ${status}`);
    expect(bare).toEqual(['POST /orders 403']);
  });

  /**
   * An operation that validates a body or a query shows a 400 with `errors`,
   * the shape a client maps onto its form. The 400 default has no `errors`,
   * so the walk above cannot tell the two apart. The Stripe webhook is the
   * one body left out: the signature check reads its raw bytes, and nothing
   * validates its fields. Sign-up's 400 is the contract's own example.
   */
  it('shows a validation 400 wherever a body or a query is validated', () => {
    const validated = operationsOf(served).filter(
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
    // Its title is the handler's own, not the contract's "Validation
    // failed": a defect, so this row changes with its fix (#43).
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
