import { HttpStatus } from '@nestjs/common';
import { ProblemException } from './problem.exception';
import { ProblemType } from './problem-type';

/**
 * The 409 the cart and the checkout share, so the two paths cannot describe
 * it differently. Title and detail follow the contract's `insufficient-stock`
 * example.
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
