import type { ValidationError } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import type { ProblemField } from './problem';

/**
 * The `errors` member: one entry per rejected field, as the contract says, so
 * a caller cannot count decorators. A nested object reports through
 * `children`, so the walk recurses and names the field by its path.
 */
function collect(errors: ValidationError[], prefix = ''): ProblemField[] {
  return errors.flatMap((error) => {
    const field =
      prefix === '' ? error.property : `${prefix}.${error.property}`;
    const messages = Object.values(error.constraints ?? {});

    if (messages.length > 0) {
      // The last entry: class-validator keys `constraints` in reverse
      // declaration order, and every DTO declares the type first, so the last
      // entry names the failure a caller has to fix first.
      // `request-validation.spec.ts` asserts the message, not the position.
      return [{ field, message: messages[messages.length - 1] }];
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
