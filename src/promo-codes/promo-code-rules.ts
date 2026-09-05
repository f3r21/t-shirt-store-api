import { HttpStatus } from '@nestjs/common';
import type { PromoCode as PromoCodeRow } from '../generated/prisma/client';
import { ProblemException } from '../common/problem/problem.exception';
import { ProblemType } from '../common/problem/problem-type';

/**
 * What a code takes off a subtotal, in minor units.
 *
 * A percentage rounds down, so a discount is never a fraction of a minor
 * unit and never more than the share the code names. A fixed amount stops at
 * the subtotal, so the total floors at 0 and no order is ever negative.
 * ADR 37.
 */
export function discountOf(code: PromoCodeRow, subtotalCents: number): number {
  return code.discountType === 'percentage'
    ? Math.floor((subtotalCents * code.discountValue) / 100)
    : Math.min(code.discountValue, subtotalCents);
}

/**
 * What the three read-only rules make of a code: `ok`, or the one rule that
 * refuses it. The fourth rule, the usage limit, is not here: it is a guarded
 * increment and it needs the write, so checkout keeps it. ADR 37.
 */
export type PromoVerdict = 'ok' | 'unknown' | 'expired' | 'below-minimum';

/**
 * The three rules a code meets before anything is written, in the order
 * checkout has applied them since ADR 37.
 *
 * A disabled code answers as an unknown one, so the refusal confirms nothing
 * to a caller who guesses codes. Expiry is "at or before", so a code stops at
 * the instant it names. The clock is a parameter, which keeps this pure and
 * lets a case state the boundary as two literals.
 */
export function promoCodeVerdict(
  row: PromoCodeRow | null,
  subtotalCents: number,
  now: Date,
): PromoVerdict {
  if (row === null || !row.isActive) {
    return 'unknown';
  }
  if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  if (row.minPurchaseCents !== null && subtotalCents < row.minPurchaseCents) {
    return 'below-minimum';
  }
  return 'ok';
}

/**
 * The four refusals a promo code can meet, one per rule the brief lists.
 *
 * All four are 422 and not 400: the body is well formed and the server
 * refuses it on its content, which is the reading `assertAllExist` already
 * makes for a category id that names no row. Each carries its own type,
 * because a client shows a different message for each. ADR 37.
 */
export function promoUnknown(): ProblemException {
  return new ProblemException(
    ProblemType.PromoCodeUnknown,
    'Promo code unknown',
    HttpStatus.UNPROCESSABLE_ENTITY,
    'This promo code does not exist, or it is disabled.',
  );
}

export function promoExpired(expiresAt: Date): ProblemException {
  return new ProblemException(
    ProblemType.PromoCodeExpired,
    'Promo code expired',
    HttpStatus.UNPROCESSABLE_ENTITY,
    `This promo code expired on ${expiresAt.toISOString()}.`,
  );
}

/**
 * One detail for both ways a code runs out, because the caller acts the same
 * on either: the count was already at the limit, or another checkout took
 * the last use while this one ran.
 */
export function promoExhausted(): ProblemException {
  return new ProblemException(
    ProblemType.PromoCodeExhausted,
    'Promo code exhausted',
    HttpStatus.UNPROCESSABLE_ENTITY,
    'This promo code reached its usage limit.',
  );
}

export function promoBelowMinimum(
  minimum: number,
  subtotal: number,
): ProblemException {
  return new ProblemException(
    ProblemType.PromoCodeMinimum,
    'Order below the promo code minimum',
    HttpStatus.UNPROCESSABLE_ENTITY,
    `This promo code applies to a subtotal of ${minimum} or more, and this order is ${subtotal}.`,
  );
}
