import type { ExamplesObject } from '@nestjs/swagger';
import { ProblemType } from '../common/problem/problem-type';

/**
 * One problem an operation can return, as its throw site builds it. A typed
 * problem carries the throw site's own title; an untyped one has no `type`
 * and carries its status's title from the table (ADR 11), so its detail is
 * what tells it apart.
 */
type OperationProblem = {
  /** Its name in the served document, the contract's if it has one. */
  name: string;
  type?: ProblemType;
  title: string;
  detail: string;
};

type ProblemsByStatus = Partial<Record<string, readonly OperationProblem[]>>;

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

/**
 * The problems each operation can return, by `operationId` and then by
 * status. Every entry is traced to the code that throws it, so the served
 * document lists no problem the API never sends. The contract shares one set
 * of examples per status, so this is narrower on purpose: POST /promo-codes
 * does not list email-taken. A status with no entry keeps the bare schema.
 *
 * A problem that several operations return is a constant above, so its text
 * is written once, and each operation still names it here, so this map alone
 * says which operation returns what. Every operation that takes a token lists
 * `ACCESS_TOKEN_EXPIRED` at 401.
 */
const OPERATION_PROBLEMS: Partial<Record<string, ProblemsByStatus>> = {
  createSession: {
    // `AuthService.createSession`, for an unknown email or a wrong password.
    '401': [INVALID_CREDENTIALS],
  },
  listSessions: { '401': [ACCESS_TOKEN_EXPIRED] },
  deleteCurrentSession: { '401': [ACCESS_TOKEN_EXPIRED] },
  deleteSession: { '401': [ACCESS_TOKEN_EXPIRED] },
  refreshSession: {
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
  },
  createUser: {
    // `UsersService.emailTaken`, on the pre-read and on the `P2002` race.
    '409': [
      {
        name: 'emailTaken',
        type: ProblemType.EmailTaken,
        title: 'Email already registered',
        detail: 'An account with this email already exists.',
      },
    ],
  },
  changePassword: {
    // `UsersService.changePassword`, for a wrong current password.
    '401': [ACCESS_TOKEN_EXPIRED, INVALID_CREDENTIALS],
  },
  listProducts: { '401': [ACCESS_TOKEN_EXPIRED] },
  createProduct: { '401': [ACCESS_TOKEN_EXPIRED] },
  getProduct: { '401': [ACCESS_TOKEN_EXPIRED] },
  updateProduct: { '401': [ACCESS_TOKEN_EXPIRED] },
  deleteProduct: { '401': [ACCESS_TOKEN_EXPIRED] },
  likeVariant: { '401': [ACCESS_TOKEN_EXPIRED] },
  unlikeVariant: { '401': [ACCESS_TOKEN_EXPIRED] },
  listLikedProducts: { '401': [ACCESS_TOKEN_EXPIRED] },
  uploadProductImage: { '401': [ACCESS_TOKEN_EXPIRED] },
  deleteProductImage: { '401': [ACCESS_TOKEN_EXPIRED] },
  createVariant: { '401': [ACCESS_TOKEN_EXPIRED] },
  updateVariant: { '401': [ACCESS_TOKEN_EXPIRED] },
  deleteVariant: { '401': [ACCESS_TOKEN_EXPIRED] },
  setVariantStock: { '401': [ACCESS_TOKEN_EXPIRED] },
  getCart: { '401': [ACCESS_TOKEN_EXPIRED] },
  clearCart: { '401': [ACCESS_TOKEN_EXPIRED] },
  addCartItem: {
    '401': [ACCESS_TOKEN_EXPIRED],
    // `CartService.addCartItem`, for the line plus the amount above stock.
    '409': [INSUFFICIENT_STOCK],
  },
  setCartItem: {
    '401': [ACCESS_TOKEN_EXPIRED],
    // `CartService.setCartItem`, for a quantity above stock.
    '409': [INSUFFICIENT_STOCK],
  },
  deleteCartItem: { '401': [ACCESS_TOKEN_EXPIRED] },
  createOrder: {
    '401': [ACCESS_TOKEN_EXPIRED],
    // `OrdersService.createOrder`, for a cart line above stock.
    '409': [INSUFFICIENT_STOCK],
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
  listAllOrders: { '401': [ACCESS_TOKEN_EXPIRED] },
  listMyOrders: { '401': [ACCESS_TOKEN_EXPIRED] },
  getOrder: { '401': [ACCESS_TOKEN_EXPIRED] },
  setOrderStatus: {
    '401': [ACCESS_TOKEN_EXPIRED],
    // `OrdersService.setOrderStatus`, for a cancel once the order shipped.
    '409': [
      {
        name: 'notCancellable',
        type: ProblemType.OrderNotCancellable,
        title: 'Order cannot be cancelled',
        detail: 'This order already shipped.',
      },
    ],
  },
  listDeliveries: { '401': [ACCESS_TOKEN_EXPIRED] },
  createPaymentLink: {
    '401': [ACCESS_TOKEN_EXPIRED],
    // `PaymentsService.createPaymentLink`, for a quantity above stock.
    '409': [INSUFFICIENT_STOCK],
  },
  createPaymentIntent: {
    '401': [ACCESS_TOKEN_EXPIRED],
    // `PaymentsService.createPaymentIntent`, for an order line above stock.
    '409': [INSUFFICIENT_STOCK],
  },
  createPromoCode: { '401': [ACCESS_TOKEN_EXPIRED] },
  listPromoCodes: { '401': [ACCESS_TOKEN_EXPIRED] },
  updatePromoCode: { '401': [ACCESS_TOKEN_EXPIRED] },
};

/**
 * The named examples one operation's failure at one status carries, each
 * value in the shape of the contract's own examples, or undefined when the
 * map lists none. The builder reads the map through this alone.
 */
export function problemExamples(
  operationId: string | undefined,
  status: string,
): ExamplesObject | undefined {
  if (operationId === undefined) return undefined;
  const problems = OPERATION_PROBLEMS[operationId]?.[status];
  if (problems === undefined) return undefined;

  const examples: ExamplesObject = {};
  for (const { name, type, title, detail } of problems) {
    examples[name] = {
      value: {
        ...(type === undefined ? {} : { type }),
        title,
        status: Number(status),
        detail,
      },
    };
  }
  return examples;
}
