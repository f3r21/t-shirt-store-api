import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ParseIdPipe } from './parse-id.pipe';

/**
 * Both `int4` boundaries, either side: a value past the floor is one the
 * column cannot hold, not a row that does not exist.
 */
describe('ParseIdPipe', () => {
  const pipe = new ParseIdPipe();
  const run = (value: string) => pipe.transform(value);

  it.each([
    ['1', 1],
    ['2147483647', 2147483647],
  ])('accepts %s, the largest ids a row can carry', async (input, expected) => {
    await expect(run(input)).resolves.toBe(expected);
  });

  it.each(['2147483648', '99999999999999999999'])(
    'answers 404 for %s, which no row could carry',
    async (input) => {
      // Not 400. Seven of the seventeen operations with a path id declare no
      // 400 at all, so a 400 here would be a status the contract does not offer.
      await expect(run(input)).rejects.toThrow(NotFoundException);
    },
  );

  it.each(['abc', '1.5'])(
    'keeps the 400 for %s, which is malformed rather than absent',
    async (input) => {
      await expect(run(input)).rejects.toThrow(BadRequestException);
    },
  );

  it('leaves an in-range negative id to the query, which answers 404', async () => {
    // The pipe does not bound this one. A negative id inside int4 matches no
    // row, so the query already answers 404 and bounding it here would move the
    // same answer earlier for nothing. This is the positive control for the
    // pair below: it proves the lower bound refuses on magnitude and not on
    // sign.
    await expect(run('-1')).resolves.toBe(-1);
  });

  it.each(['-2147483649', '-99999999999999999999'])(
    'answers 404 for %s, which is past the int4 floor',
    async (input) => {
      // Where the "a negative id already answers 404" argument stops holding.
      // Below the floor the value is not a row that does not exist, it is a
      // value the column cannot hold, so Postgres answers P2020 and the request
      // came back 500. Measured on this pipe before the bound existed:
      //     -1            resolved, then 404 from the query
      //     -2147483649   resolved, reached Prisma, P2020, then 500
      await expect(run(input)).rejects.toThrow(NotFoundException);
    },
  );

  it('accepts the int4 floor itself', async () => {
    await expect(run('-2147483648')).resolves.toBe(-2147483648);
  });
});
