import { MoveVerdict, nextStatus } from './order-status';

/**
 * The whole table, written out. Two roles, six origins, three targets, and the
 * verdict for each of the thirty-six, so a change to the flow shows up as a
 * row and not as a surprise in a service spec.
 */
describe('nextStatus', () => {
  const MANAGER: [string, string, MoveVerdict][] = [
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

  const CLIENT: [string, string, MoveVerdict][] = [
    ['pending', 'processing', 'forbidden'],
    ['pending', 'shipped', 'forbidden'],
    ['pending', 'cancelled', 'ok'],
    ['paid', 'processing', 'forbidden'],
    ['paid', 'shipped', 'forbidden'],
    ['paid', 'cancelled', 'ok'],
    ['processing', 'processing', 'forbidden'],
    ['processing', 'shipped', 'forbidden'],
    ['processing', 'cancelled', 'ok'],
    ['shipped', 'processing', 'forbidden'],
    ['shipped', 'shipped', 'forbidden'],
    ['shipped', 'cancelled', 'not-cancellable'],
    ['delivered', 'processing', 'forbidden'],
    ['delivered', 'shipped', 'forbidden'],
    ['delivered', 'cancelled', 'not-cancellable'],
    ['cancelled', 'processing', 'forbidden'],
    ['cancelled', 'shipped', 'forbidden'],
    ['cancelled', 'cancelled', 'illegal'],
  ];

  it.each(MANAGER)('manager: %s to %s is %s', (from, to, verdict) => {
    expect(
      nextStatus(
        'manager',
        from as Parameters<typeof nextStatus>[1],
        to as Parameters<typeof nextStatus>[2],
      ),
    ).toBe(verdict);
  });

  it.each(CLIENT)('client: %s to %s is %s', (from, to, verdict) => {
    expect(
      nextStatus(
        'client',
        from as Parameters<typeof nextStatus>[1],
        to as Parameters<typeof nextStatus>[2],
      ),
    ).toBe(verdict);
  });

  it('treats any role that is not manager the way it treats a client', () => {
    // The delivery person is a seeded role with no operation in the contract.
    // Whatever it can do later, it cannot advance an order today.
    expect(nextStatus('delivery_person', 'paid', 'processing')).toBe(
      'forbidden',
    );
    expect(nextStatus('delivery_person', 'paid', 'cancelled')).toBe('ok');
  });

  it('covers every origin and target exactly once per role', () => {
    const pairs = (rows: [string, string, MoveVerdict][]) =>
      rows.map(([from, to]) => `${from}>${to}`).sort();

    expect(new Set(pairs(MANAGER)).size).toBe(18);
    expect(pairs(CLIENT)).toEqual(pairs(MANAGER));
  });
});
