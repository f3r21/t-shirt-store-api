import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/**
 * Refuse a PATCH body that names no field.
 *
 * Both update operations declare `minProperties: 1` in the contract, at
 * `openapi.yaml:673` for the product and `:1046` for the variant, with the
 * description "Send at least one field." Neither DTO enforced it, and both said
 * so in writing, so an empty body reached the service and answered 200 having
 * updated nothing.
 *
 * **Why a pipe and not a class-validator rule.** class-validator 0.15.1 types
 * `registerDecorator`'s `propertyName` as a required string, so there is no
 * class level constraint to hang this on, and hanging it on a property does not
 * work either: every field on these DTOs is optional, and an optional property
 * short circuits the rest of its validators the moment the value is absent,
 * which is exactly the case being caught. Measured, not assumed: a class
 * level `registerDecorator` with an undefined `propertyName` registers nothing
 * and `validate()` returns an empty array for a body that should fail.
 *
 * **Why no `errors` member.** The contract calls `errors` an extension member
 * that "carries one entry per rejected field". An empty body rejects no field,
 * so naming one would invent it. `Problem` requires only `title` and `status`,
 * and `detail` repeats the contract's own wording.
 *
 * **The check counts values, not keys, and that is not a style choice.** This
 * pipe runs after the global `ValidationPipe`, so it never sees the raw body. It
 * receives a DTO instance, and `class-transformer` gives that instance every
 * declared field as an own property. Measured against `UpdateProductDto` with an
 * empty body:
 *
 *     constructor:  UpdateProductDto
 *     Object.keys:  ["name","description","isActive","categoryIds"]
 *     values:       {}
 *
 * `Object.keys` therefore answers four for a body that named nothing, and a key
 * count would have let every empty body through while its unit test passed on a
 * plain `{}`. Counting the fields that carry a value is the check that survives
 * both shapes.
 */
@Injectable()
export class NonEmptyBodyPipe implements PipeTransform<unknown, unknown> {
  transform(value: unknown): unknown {
    if (
      value === null ||
      typeof value !== 'object' ||
      Object.values(value).every((field) => field === undefined)
    ) {
      throw new BadRequestException({
        title: 'Validation failed',
        status: 400,
        detail: 'Send at least one field.',
      });
    }
    return value;
  }
}
