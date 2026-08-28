import { BadRequestException, ValidationError } from '@nestjs/common';
import { ProblemField } from './problem';

/**
 * Turn the pipe's errors into the `errors` member the contract declares.
 *
 * One entry per rejected field, not one per failed constraint. A password that
 * fails `@IsString`, `@MinLength` and `@MaxLength` is one rejected field, and the
 * contract says the member "carries one entry per rejected field". Emitting three
 * entries all named `password` would let a caller count decorators.
 *
 * A nested object reports through `children` and carries no `constraints` of its
 * own, so the walk recurses and names the field by its path. Without that, a body
 * with a nested DTO would answer 400 with an empty `errors` array.
 */
function collect(errors: ValidationError[], prefix = ''): ProblemField[] {
  return errors.flatMap((error) => {
    const field =
      prefix === '' ? error.property : `${prefix}.${error.property}`;
    const messages = Object.values(error.constraints ?? {});

    if (messages.length > 0) {
      return [{ field, message: messages[0] }];
    }
    return collect(error.children ?? [], field);
  });
}

export function validationExceptionFactory(errors: ValidationError[]) {
  return new BadRequestException({
    title: 'Validation failed',
    status: 400,
    detail: 'One or more fields did not pass validation.',
    errors: collect(errors),
  });
}
