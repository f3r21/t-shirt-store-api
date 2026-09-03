import { readFileSync } from 'node:fs';

/** What the driver is told about TLS: a bundle to verify against, or nothing. */
export type DatabaseSsl = { ca: string; rejectUnauthorized: true } | undefined;

/**
 * The TLS half of the connection. RDS forces TLS and node-postgres encrypts
 * nothing unless told, so with a path the server is verified against that
 * bundle; without one, as against the compose container, the connection is
 * plain. ADR 29.
 */
export function databaseSsl(caPath: string | undefined): DatabaseSsl {
  if (caPath === undefined || caPath === '') {
    return undefined;
  }
  return { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true };
}
