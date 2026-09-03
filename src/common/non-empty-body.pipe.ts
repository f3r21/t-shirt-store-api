import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/**
 * Refuse a PATCH body that names no field, the `minProperties: 1` of both
 * update operations. A pipe, because class-validator has no class-level
 * constraint and an absent optional property skips its validators. It counts
 * values and not keys, because it receives a DTO instance that carries every
 * declared field as an own property. No `errors` member: an empty body rejects
 * no field.
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
