import { poolConfig } from './pool-config';

/**
 * The driver's pool is built from three variables and nothing else: the
 * connection string, the certificate bundle, and the pool size the
 * environment chose. ADR 35.
 */
describe('poolConfig', () => {
  const configWith = (values: Record<string, unknown>) =>
    ({
      get: (key: string) => values[key],
    }) as unknown as Parameters<typeof poolConfig>[0];

  it('hands the pool size through as max, beside the connection string', () => {
    const config = configWith({
      DATABASE_URL:
        'postgresql://postgres:postgres@localhost:5433/tshirt_store',
      DATABASE_SSL_CA: undefined,
      DATABASE_POOL_SIZE: 25,
    });

    expect(poolConfig(config)).toEqual({
      connectionString:
        'postgresql://postgres:postgres@localhost:5433/tshirt_store',
      ssl: undefined,
      max: 25,
    });
  });
});
