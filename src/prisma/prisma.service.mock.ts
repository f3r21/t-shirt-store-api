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
  };
  refreshToken: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
  };
  role: {
    findUnique: jest.Mock;
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
    },
    refreshToken: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    role: {
      findUnique: jest.fn(),
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
