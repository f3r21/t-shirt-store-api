import type { PromoCode as PromoCodeRow } from '../generated/prisma/client';
import type { ProblemException } from '../common/problem/problem.exception';
import { ProblemType } from '../common/problem/problem-type';
import { aPromoCode } from './promo-codes.fixtures';
import type { PromoVerdict } from './promo-code-rules';
import {
  discountOf,
  promoBelowMinimum,
  promoCodeVerdict,
  promoExhausted,
  promoExpired,
  promoUnknown,
} from './promo-code-rules';

/** One fixed instant, so every expiry case reads as two literals. */
const NOW = new Date('2026-09-04T12:00:00.000Z');

/** One fixed subtotal, so every minimum case reads the same way. */
const SUBTOTAL = 1999;

/**
 * The three read-only rules as a table: the row, and the verdict it earns.
 * Each rule brings its control, the eighth row fixes the order the rules run
 * in, and the last row is the control for all three, so a change to the flow
 * shows up as a row and not as a surprise in the checkout's spec. The fourth rule, the usage limit, is the guarded
 * increment and belongs to the transaction that writes it. ADR 37.
 */
describe('promoCodeVerdict', () => {
  const TABLE: [string, PromoVerdict, PromoCodeRow | null][] = [
    ['a code no row holds', 'unknown', null],
    ['a code a manager disabled', 'unknown', aPromoCode({ isActive: false })],
    [
      'a code that expired one second ago',
      'expired',
      aPromoCode({ expiresAt: new Date('2026-09-04T11:59:59.000Z') }),
    ],
    [
      'a code that expires one second from now',
      'ok',
      aPromoCode({ expiresAt: new Date('2026-09-04T12:00:01.000Z') }),
    ],
    [
      'a code that expires at this very instant',
      'expired',
      aPromoCode({ expiresAt: new Date('2026-09-04T12:00:00.000Z') }),
    ],
    [
      'a minimum one unit above the subtotal',
      'below-minimum',
      aPromoCode({ minPurchaseCents: 2000 }),
    ],
    [
      'a minimum equal to the subtotal',
      'ok',
      aPromoCode({ minPurchaseCents: 1999 }),
    ],
    [
      'a disabled code that also expired',
      'unknown',
      aPromoCode({
        isActive: false,
        expiresAt: new Date('2026-09-04T11:59:59.000Z'),
      }),
    ],
    ['a plain active code', 'ok', aPromoCode()],
  ];

  it.each(TABLE)('%s is %s', (_case, verdict, row) => {
    expect(promoCodeVerdict(row, SUBTOTAL, NOW)).toBe(verdict);
  });
});

/**
 * The arithmetic as a table, in minor units. A percentage rounds down and a
 * fixed amount stops at the subtotal, so no discount is a fraction of a unit
 * and no total is negative. ADR 37.
 */
describe('discountOf', () => {
  const TABLE: [string, number, PromoCodeRow, number][] = [
    [
      '10 percent of 1999',
      199,
      aPromoCode({ discountType: 'percentage', discountValue: 10 }),
      1999,
    ],
    [
      '100 percent of 1999',
      1999,
      aPromoCode({ discountType: 'percentage', discountValue: 100 }),
      1999,
    ],
    [
      '50 percent of 1',
      0,
      aPromoCode({ discountType: 'percentage', discountValue: 50 }),
      1,
    ],
    [
      'a fixed 5000 against a subtotal of 1999',
      1999,
      aPromoCode({ discountType: 'fixed', discountValue: 5000 }),
      1999,
    ],
    [
      'a fixed 500 against a subtotal of 1999',
      500,
      aPromoCode({ discountType: 'fixed', discountValue: 500 }),
      1999,
    ],
  ];

  it.each(TABLE)('%s is %s', (_case, expected, code, subtotalCents) => {
    expect(discountOf(code, subtotalCents)).toBe(expected);
  });
});

/**
 * The four refusals, each with the status, the type and the detail a client
 * reads. All four are 422, and the type is what tells them apart.
 */
describe('the promo code refusals', () => {
  const TABLE: [string, ProblemException, string, string][] = [
    [
      'promoUnknown',
      promoUnknown(),
      ProblemType.PromoCodeUnknown,
      'This promo code does not exist, or it is disabled.',
    ],
    [
      'promoExpired',
      promoExpired(new Date('2026-08-31T23:59:59.000Z')),
      ProblemType.PromoCodeExpired,
      'This promo code expired on 2026-08-31T23:59:59.000Z.',
    ],
    [
      'promoExhausted',
      promoExhausted(),
      ProblemType.PromoCodeExhausted,
      'This promo code reached its usage limit.',
    ],
    [
      'promoBelowMinimum',
      promoBelowMinimum(2000, 1999),
      ProblemType.PromoCodeMinimum,
      'This promo code applies to a subtotal of 2000 or more, and this order is 1999.',
    ],
  ];

  it.each(TABLE)(
    '%s is 422 with its own type and detail',
    (_case, error, type, detail) => {
      expect(error.getStatus()).toBe(422);
      expect(error.type).toBe(type);
      expect(error.detail).toBe(detail);
    },
  );
});
