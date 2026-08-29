import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ParseIdPipe } from './parse-id.pipe';

/**
 * The pipe exists because of one measured 500, so the spec asserts the boundary
 * either side rather than a single happy value. `2147483647` and `2147483648`
 * are the two cases that mattered: before this pipe the first answered 404 and
 * the second answered 500, on a route reachable with no token.
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

  it('leaves a negative id to the query, which already answers 404', async () => {
    // No lower bound on purpose. A negative id matches no row and comes back
    // 404 today, so bounding it here would move the same answer earlier and make
    // the transport assert something the schema owns.
    await expect(run('-1')).resolves.toBe(-1);
  });
});
