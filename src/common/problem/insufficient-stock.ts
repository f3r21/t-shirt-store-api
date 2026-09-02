import { HttpStatus } from '@nestjs/common';
import { ProblemException } from './problem.exception';
import { ProblemType } from './problem-type';

/**
 * A quantity above the units on hand: the 409 the cart and the checkout share.
 *
 * One function rather than one per service, so the two paths that refuse the
 * same thing cannot describe it differently. Title and detail follow the
 * contract's own example at `openapi.yaml:2561-2567`.
 */
export function insufficientStock(
  stock: number,
  asked: number,
): ProblemException {
  return new ProblemException(
    ProblemType.InsufficientStock,
    'Not enough stock',
    HttpStatus.CONFLICT,
    `This variant has ${stock} units on hand and the request asks for ${asked}.`,
  );
}
