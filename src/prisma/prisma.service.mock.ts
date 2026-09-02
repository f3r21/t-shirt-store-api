import { PrismaService } from './prisma.service';

/**
 * The delegate methods the nine auth operations call.
 *
 * The list is short on purpose. A spec that calls a method which is not here
 * fails with a type error, instead of receiving `undefined` from a deep mock and
 * passing for the wrong reason. Add a method when a service needs one.
 */
export interface PrismaMock {
  user: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    updateManyAndReturn: jest.Mock;
  };
  refreshToken: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    updateManyAndReturn: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
  };
  consumedRefreshToken: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    deleteMany: jest.Mock;
  };
  $queryRaw: jest.Mock;
  role: {
    findUnique: jest.Mock;
  };
  product: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  productVariant: {
    findUnique: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    groupBy: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    // The webhook's conditional decrement, `stock >= quantity` in its where.
    updateMany: jest.Mock;
    delete: jest.Mock;
  };
  productImage: {
    findMany: jest.Mock;
  };
  // The five cart operations: the read, the two upserts, and the two deletes.
  // `findUnique` is the add path reading the existing line before it sums.
  cartItem: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    upsert: jest.Mock;
    deleteMany: jest.Mock;
  };
  category: {
    findMany: jest.Mock;
    count: jest.Mock;
  };
  productCategory: {
    deleteMany: jest.Mock;
    createMany: jest.Mock;
  };
  // The catalog's one read of an order table. `deleteVariant` counts the lines
  // pointing at a variant before removing it, because the contract answers 409
  // there and `onDelete: Restrict` would otherwise surface as an unmapped 500.
  orderItem: {
    count: jest.Mock;
    findMany: jest.Mock;
  };
  // The five order operations and the three payment ones. `updateMany` is the
  // conditional status write, `findUniqueOrThrow` the read back after it,
  // inside one transaction; `delete` is the payment link's compensation.
  order: {
    create: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    count: jest.Mock;
    updateMany: jest.Mock;
    delete: jest.Mock;
  };
  orderStatusChange: {
    create: jest.Mock;
  };
  // The webhook's replay guard: the event id is looked up, then inserted first.
  stripeEvent: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  $transaction: jest.Mock;
}

/**
 * Build a fresh mock. Call it in `beforeEach`, so no state crosses a test.
 *
 * `$transaction` accepts both call shapes. A callback receives this same mock,
 * so an assertion on `prisma.user.update` holds whether or not the service opens
 * a transaction. An array resolves the way `Promise.all` does.
 */
export function createPrismaMock(): PrismaMock {
  const mock: PrismaMock = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      updateManyAndReturn: jest.fn(),
    },
    refreshToken: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      updateManyAndReturn: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    consumedRefreshToken: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    // The grace window reads the database clock rather than the process one,
    // because `consumed_at` is stamped by Postgres. Defaults to "now" so a
    // spec that is not about the window reads as it always did.
    $queryRaw: jest.fn().mockResolvedValue([{ now: new Date() }]),
    role: {
      findUnique: jest.fn(),
    },
    product: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    productVariant: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
    },
    // Empty by default, for the reason `productImage.findMany` is: a cart spec
    // that is about the stock check or the 404 reads an empty cart back, and
    // a spec about the read says what rows it holds.
    cartItem: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    // Empty by default, for the reason `orderItem.count` defaults to zero: the
    // list asks for the page's primary images on every call, and a spec that
    // is not about images should read as it did before the table was read.
    productImage: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    category: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    productCategory: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    // Zero by default, so a spec that does not care about order lines gets the
    // path it means to test. A spec that does care says so.
    orderItem: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    order: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
    },
    orderStatusChange: {
      create: jest.fn(),
    },
    // Unseen by default, so a spec about applying an event reads as a first
    // delivery. A spec about a replay says so.
    stripeEvent: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  mock.$transaction.mockImplementation((arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: PrismaMock) => unknown)(mock);
    }
    return Promise.all(arg as readonly unknown[]);
  });

  return mock;
}

/**
 * Give the mock to a testing module where it wants the real service.
 *
 * The cast lives here, in one function, so no spec needs one. `PrismaMock`
 * carries the methods the auth services call and not the rest of the client.
 */
export function prismaMockProvider(mock: PrismaMock) {
  return { provide: PrismaService, useValue: mock as unknown as PrismaService };
}
