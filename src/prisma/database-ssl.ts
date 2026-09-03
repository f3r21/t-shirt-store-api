import { readFileSync } from 'node:fs';

/** What the driver is told about TLS: a bundle to verify against, or nothing. */
export type DatabaseSsl = { ca: string; rejectUnauthorized: true } | undefined;

/**
 * The TLS half of the database connection, from one optional path.
 *
 * RDS refuses a connection that is not encrypted (`rds.force_ssl` is 1 by
 * default since PostgreSQL 15), and node-postgres encrypts nothing unless it
 * is told to. The Prisma CLI negotiates TLS on its own, which is why the
 * migrations applied on the first release while the seed, on this driver, was
 * refused with `P1010`. With a path, the connection is encrypted and the
 * server's certificate is verified against that bundle, hostname included.
 * Without one, as on a laptop against the compose container, it is plain,
 * because that container speaks no TLS. ADR 29.
 */
export function databaseSsl(caPath: string | undefined): DatabaseSsl {
  if (caPath === undefined || caPath === '') {
    return undefined;
  }
  return { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true };
}
