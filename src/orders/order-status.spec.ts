import type { MoveVerdict } from './order-status';
import { nextStatus } from './order-status';

/**
 * The whole table, written out. Six origins, three targets, and the verdict
 * for each of the eighteen, so a change to the flow shows up as a row and not
 * as a surprise in a service spec. Who may ask is the ability's business and
 * is tested with it, in `ability.factory.spec.ts`.
 */
describe('nextStatus', () => {
  const TABLE: [string, string, MoveVerdict][] = [
    ['pending', 'processing', 'illegal'],
    ['pending', 'shipped', 'illegal'],
    ['pending', 'cancelled', 'ok'],
    ['paid', 'processing', 'ok'],
    ['paid', 'shipped', 'illegal'],
    ['paid', 'cancelled', 'ok'],
    ['processing', 'processing', 'illegal'],
    ['processing', 'shipped', 'ok'],
    ['processing', 'cancelled', 'ok'],
    ['shipped', 'processing', 'illegal'],
    ['shipped', 'shipped', 'illegal'],
    ['shipped', 'cancelled', 'not-cancellable'],
    ['delivered', 'processing', 'illegal'],
    ['delivered', 'shipped', 'illegal'],
    ['delivered', 'cancelled', 'not-cancellable'],
    ['cancelled', 'processing', 'illegal'],
    ['cancelled', 'shipped', 'illegal'],
    ['cancelled', 'cancelled', 'illegal'],
  ];

  it.each(TABLE)('%s to %s is %s', (from, to, verdict) => {
    expect(
      nextStatus(
        from as Parameters<typeof nextStatus>[0],
        to as Parameters<typeof nextStatus>[1],
      ),
    ).toBe(verdict);
  });

  it('covers every origin and target exactly once', () => {
    const pairs = TABLE.map(([from, to]) => `${from}>${to}`);

    expect(new Set(pairs).size).toBe(18);
  });
});
