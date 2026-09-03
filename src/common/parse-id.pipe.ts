import {
  Injectable,
  NotFoundException,
  ParseIntPipe,
  PipeTransform,
} from '@nestjs/common';
import { INT4_MAX, INT4_MIN } from './int4';

/**
 * Parse a path id and refuse one no row could carry. `ParseIntPipe` bounds the
 * format; the `int4` bounds, in both directions, keep Postgres's `P2020` out.
 * Out of range is 404, because every operation with a path id declares one
 * and seven declare no 400. A malformed id keeps its 400.
 */
@Injectable()
export class ParseIdPipe implements PipeTransform<string, Promise<number>> {
  private readonly parse = new ParseIntPipe();

  async transform(value: string): Promise<number> {
    const id = await this.parse.transform(value, {
      type: 'param',
      metatype: Number,
    });

    if (id > INT4_MAX || id < INT4_MIN) {
      throw new NotFoundException();
    }
    return id;
  }
}
