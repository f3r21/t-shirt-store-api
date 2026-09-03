import type { ConfigService } from '@nestjs/config';
import type { PoolConfig } from 'pg';
import type { EnvironmentVariables } from '../config/env.validation';
import { databaseSsl } from './database-ssl';

/**
 * The driver's pool, from the environment: the connection string, the
 * certificate bundle when one is set, and the pool size the environment chose
 * instead of the driver's default. ADR 35.
 */
export function poolConfig(
  config: ConfigService<EnvironmentVariables, true>,
): PoolConfig {
  return {
    connectionString: config.get('DATABASE_URL', { infer: true }),
    ssl: databaseSsl(config.get('DATABASE_SSL_CA', { infer: true })),
    max: config.get('DATABASE_POOL_SIZE', { infer: true }),
  };
}
