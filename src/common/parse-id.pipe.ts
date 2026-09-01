import {
  Injectable,
  NotFoundException,
  ParseIntPipe,
  PipeTransform,
} from '@nestjs/common';
import { INT4_MAX, INT4_MIN } from './int4';

/**
 * Parse a path id, and refuse one no row could ever carry.
 *
 * `ParseIntPipe` bounds the format and not the magnitude. Measured before this
 * pipe existed, against `GET /v1/products/{id}`, which is `@OptionalAuth` and so
 * reachable with no token:
 *
 *     2147483647              404
 *     2147483648              500
 *     99999999999999999999    500
 *
 * The value parses as a JavaScript number, reaches Prisma, and Postgres rejects
 * it as out of range for `int4`. Nothing maps that, so it left as a 500 that one
 * request could produce.
 *
 * **The out of range answer is 404, and the contract decides it.** All 17
 * operations carrying a path id declare a 404, and seven declare no 400 at all,
 * `GET /products/{id}` among them, so a 400 there would be a status the document
 * does not offer.
 *
 * **A malformed id keeps its 400, and that distinction is the point.** `abc` and
 * `1.5` still answer 400 through `ParseIntPipe`, because a malformed path
 * segment is a bad request. An id that is well formed and larger than any row
 * could carry is a lookup that finds nothing, which is the same answer a
 * negative id and a zero id already give today.
 *
 * **The bound runs in both directions, and the reason is not symmetry.** This
 * pipe carried only the upper bound, under a paragraph arguing that a lower one
 * was redundant because a negative id already answers 404 by matching no row.
 * That holds for `-1` and stops holding at the `int4` floor, where the value
 * stops being a row that does not exist and becomes a value the column cannot
 * hold. Measured on this pipe before the second bound existed:
 *
 *     -1                404, by matching no row
 *     -2147483649       reached Prisma, P2020, then 500
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
