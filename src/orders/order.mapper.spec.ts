import { AS_CLIENT, AS_MANAGER } from '../products/products.fixtures';
import {
  anOrderLine,
  anOrderWithDetail,
  anOrderWithSummary,
  aStatusChange,
} from './orders.fixtures';
import {
  toOrderDto,
  toOrderItemDto,
  toOrderStatusChangeDto,
  toOrderSummaryDto,
} from './order.mapper';

describe('toOrderItemDto', () => {
  it('reads the snapshots as they were stored', () => {
    expect(toOrderItemDto(anOrderLine())).toEqual({
      variantId: 21,
      productId: 7,
      productName: 'Nerdery classic tee',
      size: 'M',
      color: 'black',
      unitPrice: 1999,
      quantity: 2,
      lineTotal: 3998,
    });
  });

  it('omits a size or colour stored as the empty string', () => {
    const dto = toOrderItemDto(anOrderLine({ size: '', color: '' }));

    expect(dto).not.toHaveProperty('size');
    expect(dto).not.toHaveProperty('color');
  });

  it('carries no order id: the line travels inside its order', () => {
    expect(toOrderItemDto(anOrderLine())).not.toHaveProperty('orderId');
  });
});

describe('toOrderStatusChangeDto', () => {
  it('maps the status and the instant as ISO 8601', () => {
    expect(toOrderStatusChangeDto(aStatusChange())).toEqual({
      status: 'pending',
      changedAt: '2026-08-15T18:22:00.000Z',
    });
  });
});

describe('toOrderSummaryDto', () => {
  it('carries exactly the contract keys for a client, with no customer', () => {
    const dto = toOrderSummaryDto(anOrderWithSummary(), AS_CLIENT);

    expect(dto).toEqual({
      id: 501,
      status: 'pending',
      subtotal: 3998,
      total: 3998,
      itemCount: 2,
      createdAt: '2026-08-15T18:22:00.000Z',
    });
  });

  it('adds the customer for a manager, four fields and no more', () => {
    const dto = toOrderSummaryDto(anOrderWithSummary(), AS_MANAGER);

    expect(dto.customer).toEqual({
      id: 128,
      email: 'ana@example.com',
      firstName: 'Ana',
      lastName: 'Ramirez',
    });
  });

  it('counts units across every line, not lines', () => {
    const dto = toOrderSummaryDto(
      anOrderWithSummary({ items: [{ quantity: 2 }, { quantity: 3 }] }),
      AS_CLIENT,
    );

    expect(dto.itemCount).toBe(5);
  });

  it('never carries the user id column', () => {
    const dto = toOrderSummaryDto(anOrderWithSummary(), AS_CLIENT);

    expect(dto).not.toHaveProperty('userId');
  });
});

describe('toOrderDto', () => {
  it('carries exactly the contract keys for a client', () => {
    const dto = toOrderDto(anOrderWithDetail(), AS_CLIENT);

    expect(Object.keys(dto).sort()).toEqual(
      [
        'id',
        'status',
        'subtotal',
        'total',
        'items',
        'createdAt',
        'statusHistory',
      ].sort(),
    );
    expect(dto.items).toHaveLength(1);
    expect(dto.statusHistory).toEqual([
      { status: 'pending', changedAt: '2026-08-15T18:22:00.000Z' },
    ]);
  });

  it('adds the customer for a manager', () => {
    const dto = toOrderDto(anOrderWithDetail(), AS_MANAGER);

    expect(dto.customer).toEqual({
      id: 128,
      email: 'ana@example.com',
      firstName: 'Ana',
      lastName: 'Ramirez',
    });
  });

  it('carries the payment method once a payment set it, and not before', () => {
    expect(toOrderDto(anOrderWithDetail(), AS_CLIENT)).not.toHaveProperty(
      'paymentMethod',
    );

    const paid = toOrderDto(
      anOrderWithDetail({ status: 'paid', paymentMethod: 'payment_intent' }),
      AS_CLIENT,
    );
    expect(paid.paymentMethod).toBe('payment_intent');
  });

  it('keeps the history in the order it was loaded, oldest first', () => {
    const dto = toOrderDto(
      anOrderWithDetail({
        statusHistory: [
          aStatusChange(),
          aStatusChange({
            id: 2,
            status: 'paid',
            changedAt: new Date('2026-08-15T18:24:11.000Z'),
          }),
        ],
      }),
      AS_CLIENT,
    );

    expect(dto.statusHistory.map((h) => h.status)).toEqual(['pending', 'paid']);
  });
});
