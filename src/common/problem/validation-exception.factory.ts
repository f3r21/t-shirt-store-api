import type { ValidationError } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import type { ProblemField } from './problem';

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
      // **The last entry, not the first, and it is measured rather than
      // guessed.** class-validator keys `constraints` in reverse declaration
      // order, so `[0]` is the constraint declared last and the final entry is
      // the one declared first. Every DTO here declares the type first, so the
      // last entry is the type constraint, and a value of the wrong type fails
      // every length or range check as a consequence of that.
      //
      // Measured against the real DTOs, first entry against last:
      //
      //     CreateUserDto.password    "at most 128 characters" | "must be a string"
      //     CreateProductDto.name     "at most 200 characters" | "must be a string"
      //     CreateVariantDto.size     "at most 20 characters"  | "must be a string"
      //     CreateVariantDto.stock    "at most 2147483647"     | "must be an integer"
      //
      // So `POST /users` with `{"password": 12345}` answered that a five digit
      // number is too long. The caller reads the one message this returns and
      // fixes the wrong thing.
      //
      // The ordering is an implementation detail of class-validator rather than
      // a documented promise, which is why `request-validation.spec.ts` asserts
      // the message a caller receives rather than trusting the position.
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
