import type { ExamplesObject } from '@nestjs/swagger';
import type { ProblemField } from '../common/problem/problem';
import { STATUS_DETAILS, titleFor } from '../common/problem/problem-titles';
import { ProblemType } from '../common/problem/problem-type';

/**
 * One problem an operation can return, as its throw site builds it. A typed
 * problem carries the throw site's own title; an untyped one has no `type`
 * and carries its status's title from the table (ADR 11), the image upload's
 * "Bad request" aside, so its detail is what tells it apart.
 */
type OperationProblem = {
  /** Its name in the served document, the contract's if it has one. */
  name: string;
  type?: ProblemType;
  title: string;
  detail: string;
  /** The rejected fields, which only the validation pipe's 400 carries. */
  errors?: readonly ProblemField[];
};

type ProblemsByStatus = Partial<Record<string, readonly OperationProblem[]>>;

/**
 * A problem whose thrower names neither title nor detail, so `toProblem`
 * fills both from the status table (ADR 11).
 */
function fromTable(name: string, status: number): OperationProblem {
  return { name, title: titleFor(status), detail: STATUS_DETAILS[status] };
}

/**
 * `AccessTokenGuard`, for a bearer token past its expiry. Every operation
 * that takes a token can return it, the two optional-auth reads included
 * when a header is sent; a `@Public()` route never reaches the check.
 */
const ACCESS_TOKEN_EXPIRED: OperationProblem = {
  name: 'expired',
  type: ProblemType.AccessTokenExpired,
  title: 'Access token expired',
  detail: 'Refresh the token and send the request again.',
};

/**
 * `AccessTokenGuard.unauthorized`, for a token that is absent, malformed or
 * badly signed, lacks its claims, or names an ended session, and
 * `PoliciesGuard.needsToken`, for a rule that needs a caller: `listProducts`
 * with `includeInactive` and no token. One detail for every cause.
 */
const NEEDS_TOKEN: OperationProblem = {
  name: 'needsToken',
  title: 'Unauthorized',
  detail: 'This operation needs a bearer token.',
};

/** The two 401s of the token guards. */
const TOKEN_GUARD_401: readonly OperationProblem[] = [
  ACCESS_TOKEN_EXPIRED,
  NEEDS_TOKEN,
];

/** `AuthService.invalidCredentials`, and the same problem in `UsersService`. */
const INVALID_CREDENTIALS: OperationProblem = {
  name: 'credentials',
  type: ProblemType.InvalidCredentials,
  title: 'Invalid credentials',
  detail: 'The server did not accept this email and password.',
};

/** `insufficientStock`, which the cart, checkout and payments share. */
const INSUFFICIENT_STOCK: OperationProblem = {
  name: 'insufficientStock',
  type: ProblemType.InsufficientStock,
  title: 'Not enough stock',
  detail: 'This variant has 3 units on hand and the request asks for 5.',
};

/** `CategoriesService.assertAllExist`, before a product's categories change. */
const MISSING_CATEGORY: OperationProblem = {
  name: 'missingCategory',
  title: 'Unprocessable content',
  detail: 'The request names a category that does not exist.',
};

/** `VariantsService.pairTaken`, on the `P2002` of the size and color index. */
const PAIR_TAKEN: OperationProblem = {
  name: 'pairTaken',
  title: 'Conflict',
  detail: 'This product already has a variant with this size and color.',
};

/** `PromoCodesService.codeTaken`, on the `P2002` of the code index. */
const CODE_TAKEN: OperationProblem = {
  name: 'codeTaken',
  title: 'Conflict',
  detail: 'Another promo code already uses this code.',
};

/**
 * The global `ThrottlerGuard`, past the tier `@SignInTier` or `@PasswordTier`
 * sets, on the six operations that declare a 429. It equals the status
 * default, and is listed so that dropping the switch below keeps it.
 */
const TOO_MANY_REQUESTS = fromTable('tooManyRequests', 429);

/**
 * `ParseIdPipe`, for a path id that is not an integer. Listed where the 400
 * has other causes; where it is the only one, the status default shows the
 * same problem.
 */
const PATH_ID = fromTable('pathId', 400);

/** `NonEmptyBodyPipe`, on the partial updates. No `errors`: no field failed. */
const EMPTY_BODY: OperationProblem = {
  name: 'emptyBody',
  title: 'Validation failed',
  detail: 'Send at least one field.',
};

/**
 * `validationExceptionFactory`, through the global `ValidationPipe`, with
 * one rejected field. Each operation names a field and the message its DTO
 * gives that field, for a value only that constraint refuses.
 */
function invalid(field: string, message: string): OperationProblem {
  return {
    name: 'validation',
    title: 'Validation failed',
    detail: 'One or more fields did not pass validation.',
    errors: [{ field, message }],
  };
}

/**
 * The problems each operation can return, by `operationId` and then by
 * status. Every entry is traced to the code that throws it, so the served
 * document lists no problem the API never sends. The contract shares one set
 * of examples per status, so this is narrower on purpose: POST /promo-codes
 * does not list email-taken. A status with no entry falls to `statusDefault`.
 *
 * A problem that several operations return is a constant above, so its text
 * is written once, and each operation still names it here, so this map alone
 * says which operation returns what. Every operation that takes a token lists
 * `TOKEN_GUARD_401` at 401, and every one that validates a body or a query
 * lists one `invalid` example at 400.
 */
const OPERATION_PROBLEMS: Partial<Record<string, ProblemsByStatus>> = {
  createSession: {
    '400': [invalid('email', 'must be a valid email address')],
    // `AuthService.createSession`, for an unknown email or a wrong password.
    '401': [INVALID_CREDENTIALS],
    '429': [TOO_MANY_REQUESTS],
  },
  listSessions: {
    '400': [invalid('limit', 'must be at most 100')],
    '401': TOKEN_GUARD_401,
  },
  deleteCurrentSession: { '401': TOKEN_GUARD_401 },
  deleteSession: { '401': TOKEN_GUARD_401 },
  refreshSession: {
    '400': [invalid('refreshToken', 'must not be empty')],
    // `AuthService.refreshSession`, for a token no row accepts, or a user
    // who is gone.
    '401': [
      {
        name: 'refresh',
        type: ProblemType.RefreshTokenUnknown,
        title: 'Refresh token unknown',
        detail: 'Sign in again. The server ended every session for this user.',
      },
    ],
    '429': [TOO_MANY_REQUESTS],
  },
  requestPasswordReset: {
    '400': [invalid('email', 'must be a valid email address')],
    '429': [TOO_MANY_REQUESTS],
  },
  resetPassword: {
    '400': [invalid('password', 'must be at least 8 characters')],
    // `AuthService.resetPassword`, for a token no account holds or one past
    // its expiry.
    '422': [
      {
        name: 'resetToken',
        title: 'Unprocessable content',
        detail: 'The reset token is unknown or expired.',
      },
    ],
    '429': [TOO_MANY_REQUESTS],
  },
  createUser: {
    '400': [invalid('email', 'must be a valid email address')],
    // `UsersService.emailTaken`, on the pre-read and on the `P2002` race.
    '409': [
      {
        name: 'emailTaken',
        type: ProblemType.EmailTaken,
        title: 'Email already registered',
        detail: 'An account with this email already exists.',
      },
    ],
    '429': [TOO_MANY_REQUESTS],
  },
  changePassword: {
    '400': [invalid('newPassword', 'must be at least 8 characters')],
    // `UsersService.changePassword`, for a wrong current password.
    '401': [...TOKEN_GUARD_401, INVALID_CREDENTIALS],
    '429': [TOO_MANY_REQUESTS],
  },
  listProducts: {
    '400': [invalid('includeInactive', 'must be a boolean')],
    '401': TOKEN_GUARD_401,
  },
  createProduct: {
    '400': [invalid('name', 'must be at least 1 character')],
    '401': TOKEN_GUARD_401,
    '422': [MISSING_CATEGORY],
  },
  getProduct: { '401': TOKEN_GUARD_401 },
  updateProduct: {
    '400': [invalid('isActive', 'must be a boolean'), EMPTY_BODY, PATH_ID],
    '401': TOKEN_GUARD_401,
    '422': [MISSING_CATEGORY],
  },
  deleteProduct: { '401': TOKEN_GUARD_401 },
  likeVariant: { '401': TOKEN_GUARD_401 },
  unlikeVariant: { '401': TOKEN_GUARD_401 },
  listLikedProducts: {
    '400': [invalid('offset', 'must be at least 0')],
    '401': TOKEN_GUARD_401,
  },
  listCategories: { '400': [invalid('limit', 'must be at least 1')] },
  uploadProductImage: {
    '400': [
      invalid('isPrimary', 'must be a boolean'),
      // `ProductImagesController.uploadProductImage`, for a request with no
      // file. Its title, "Bad request", is not the table's "Validation
      // failed"; it is listed as found.
      {
        name: 'noFile',
        title: 'Bad request',
        detail: 'The request carries no file. Send one in the `file` part.',
      },
      PATH_ID,
    ],
    '401': TOKEN_GUARD_401,
    // `ImagesService.upload`, for bytes that are no image type it knows.
    '415': [
      {
        name: 'notAnImage',
        title: 'Unsupported media type',
        detail: 'The file is not a PNG, JPEG, GIF or WebP image.',
      },
    ],
  },
  deleteProductImage: { '401': TOKEN_GUARD_401 },
  createVariant: {
    '400': [invalid('price', 'must be at least 0'), PATH_ID],
    '401': TOKEN_GUARD_401,
    '409': [PAIR_TAKEN],
  },
  updateVariant: {
    '400': [
      invalid('size', 'must be at most 20 characters'),
      EMPTY_BODY,
      PATH_ID,
    ],
    '401': TOKEN_GUARD_401,
    '409': [PAIR_TAKEN],
  },
  deleteVariant: {
    '401': TOKEN_GUARD_401,
    // `VariantsService.deleteVariant`, while an order line points at it.
    '409': [
      {
        name: 'variantOrdered',
        title: 'Conflict',
        detail:
          'This variant appears in an order. Set its stock to zero instead.',
      },
    ],
  },
  // Its 409 for a count that raced another stock write is undeclared (#33).
  setVariantStock: {
    '400': [invalid('stock', 'must be at least 0'), PATH_ID],
    '401': TOKEN_GUARD_401,
  },
  getCart: { '401': TOKEN_GUARD_401 },
  clearCart: { '401': TOKEN_GUARD_401 },
  addCartItem: {
    '400': [invalid('quantity', 'must be at least 1')],
    '401': TOKEN_GUARD_401,
    // `CartService.addCartItem`, for the line plus the amount above stock.
    '409': [INSUFFICIENT_STOCK],
  },
  setCartItem: {
    '400': [invalid('quantity', 'must be at least 1'), PATH_ID],
    '401': TOKEN_GUARD_401,
    // `CartService.setCartItem`, for a quantity above stock.
    '409': [INSUFFICIENT_STOCK],
  },
  deleteCartItem: { '401': TOKEN_GUARD_401 },
  createOrder: {
    '400': [invalid('promoCode', 'must be at most 40 characters')],
    '401': TOKEN_GUARD_401,
    // `OrdersService.createOrder`, in the order it checks the cart: no line,
    // a line above stock, then a cart another checkout emptied first.
    '409': [
      {
        name: 'cartEmpty',
        title: 'Conflict',
        detail: 'The cart is empty.',
      },
      INSUFFICIENT_STOCK,
      {
        name: 'cartChanged',
        title: 'Conflict',
        detail: 'The cart changed while the order was created. Read it again.',
      },
    ],
    // `OrdersService.applyPromoCode`, in the order it applies the rules.
    '422': [
      {
        name: 'promoUnknown',
        type: ProblemType.PromoCodeUnknown,
        title: 'Promo code unknown',
        detail: 'This promo code does not exist, or it is disabled.',
      },
      {
        name: 'promoExpired',
        type: ProblemType.PromoCodeExpired,
        title: 'Promo code expired',
        detail: 'This promo code expired on 2026-08-31T23:59:59.000Z.',
      },
      {
        name: 'promoMinimum',
        type: ProblemType.PromoCodeMinimum,
        title: 'Order below the promo code minimum',
        detail:
          'This promo code applies to a subtotal of 5000 or more, and this order is 3998.',
      },
      {
        name: 'promoExhausted',
        type: ProblemType.PromoCodeExhausted,
        title: 'Promo code exhausted',
        detail: 'This promo code reached its usage limit.',
      },
    ],
  },
  listAllOrders: {
    '400': [invalid('userId', 'must be at least 1')],
    '401': TOKEN_GUARD_401,
  },
  listMyOrders: {
    '400': [invalid('createdFrom', 'must be an ISO 8601 date-time')],
    '401': TOKEN_GUARD_401,
  },
  getOrder: { '401': TOKEN_GUARD_401 },
  setOrderStatus: {
    '400': [
      invalid(
        'status',
        'must be one of processing, shipped, delivered, cancelled',
      ),
      PATH_ID,
    ],
    '401': TOKEN_GUARD_401,
    // `OrdersService.setOrderStatus`, in the order it checks the move: a
    // cancel once the order shipped, a move the status flow does not allow,
    // then an order another request moved first.
    '409': [
      {
        name: 'notCancellable',
        type: ProblemType.OrderNotCancellable,
        title: 'Order cannot be cancelled',
        detail: 'This order already shipped.',
      },
      {
        name: 'illegalMove',
        title: 'Conflict',
        detail: 'An order in status pending cannot move to processing.',
      },
      {
        name: 'orderChanged',
        title: 'Conflict',
        detail: 'The order changed while this request ran. Read it again.',
      },
    ],
  },
  listDeliveries: {
    '400': [invalid('status', 'must be one of shipped, delivered')],
    '401': TOKEN_GUARD_401,
  },
  createPaymentLink: {
    '400': [invalid('quantity', 'must be at least 1')],
    '401': TOKEN_GUARD_401,
    // `PaymentsService.createPaymentLink`, for a quantity above stock.
    '409': [INSUFFICIENT_STOCK],
  },
  createPaymentIntent: {
    '401': TOKEN_GUARD_401,
    // `PaymentsService.createPaymentIntent`, in the order it checks the
    // order: not pending, a total below the provider's minimum, then a line
    // above stock.
    '409': [
      {
        name: 'notPending',
        title: 'Conflict',
        detail: 'An order in status paid cannot be paid.',
      },
      {
        name: 'belowMinimum',
        title: 'Conflict',
        detail:
          'The total of this order is below the smallest amount the payment provider accepts.',
      },
      INSUFFICIENT_STOCK,
    ],
  },
  receiveStripeEvent: {
    // `StripeGateway.parseEvent`, for a missing body or header, or a
    // signature that does not verify. Nothing validates the fields.
    '400': [
      {
        name: 'signature',
        title: 'Validation failed',
        detail: 'The Stripe-Signature header does not verify against the body.',
      },
    ],
  },
  createPromoCode: {
    // `PercentageAtMost100`, for a percentage discount above 100.
    '400': [
      invalid('discountValue', 'must be at most 100 for a percentage discount'),
    ],
    '401': TOKEN_GUARD_401,
    '409': [CODE_TAKEN],
  },
  listPromoCodes: {
    '400': [invalid('limit', 'must be at most 100')],
    '401': TOKEN_GUARD_401,
  },
  updatePromoCode: {
    '400': [invalid('usageLimit', 'must be at least 1'), EMPTY_BODY, PATH_ID],
    '401': TOKEN_GUARD_401,
    '409': [CODE_TAKEN],
  },
};

/**
 * The generic switch, which awaits the owner's call. 89 declared failures
 * have no traced problem: every 403, 404, 413 and 500, and the 400 of the
 * ten operations whose only 400 is a malformed path id. `createOrder`'s 403
 * is among them, and no role reaches it today.
 *
 * In force: each shows its status's default problem, so every failure names
 * an example. A status the table gives no detail (401, 409, 422) has no
 * default, so a traced entry missing there still leaves its failure bare.
 *
 * The other option: the walk in `test/openapi-problems.e2e-spec.ts` exempts
 * these failures. Taking it is deleting this function and its call in
 * `problemExamples`, and giving the walk the exemption.
 */
function statusDefault(status: string): OperationProblem[] | undefined {
  if (STATUS_DETAILS[Number(status)] === undefined) return undefined;
  return [fromTable('default', Number(status))];
}

/**
 * The named examples one operation's failure at one status carries, each
 * value in the shape of the contract's own examples, or undefined when
 * neither the map nor the status default gives one. The builder reads the
 * map through this alone.
 */
export function problemExamples(
  operationId: string | undefined,
  status: string,
): ExamplesObject | undefined {
  if (operationId === undefined) return undefined;
  const problems =
    OPERATION_PROBLEMS[operationId]?.[status] ?? statusDefault(status);
  if (problems === undefined) return undefined;

  const examples: ExamplesObject = {};
  for (const { name, type, title, detail, errors } of problems) {
    examples[name] = {
      value: {
        ...(type === undefined ? {} : { type }),
        title,
        status: Number(status),
        detail,
        ...(errors === undefined ? {} : { errors }),
      },
    };
  }
  return examples;
}
