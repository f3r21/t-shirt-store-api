import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { databaseSsl } from './database-ssl';

/**
 * One switch, three answers: nothing without a path, the bundle with one, and
 * a loud failure for a path that names no file, because a deployment that
 * points at a bundle it does not carry must not fall back to plaintext.
 */
describe('databaseSsl', () => {
  it('sends nothing when no path is set, so a laptop stays plain', () => {
    expect(databaseSsl(undefined)).toBeUndefined();
    expect(databaseSsl('')).toBeUndefined();
  });

  it('reads the bundle and asks for verification when a path is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'database-ssl-'));
    const path = join(dir, 'bundle.pem');
    writeFileSync(path, '-----BEGIN CERTIFICATE-----\nabc\n');

    expect(databaseSsl(path)).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\nabc\n',
      rejectUnauthorized: true,
    });
  });

  it('throws for a path that names no file, rather than connecting plain', () => {
    expect(() => databaseSsl('/nowhere/bundle.pem')).toThrow(/ENOENT/);
  });
});
