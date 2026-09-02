import { toSessionDto } from './session.mapper';
import { aRefreshToken } from './auth.fixtures';

/**
 * The mapper that turns a `refresh_tokens` row into one entry of the device list.
 *
 * The interesting case is `deviceName`: the contract states that an optional
 * value is absent and never null, so the assertion reads the property off the
 * object rather than comparing it to `undefined`.
 */
describe('toSessionDto', () => {
  it('returns id, createdAt and expiresAt', () => {
    const dto = toSessionDto(aRefreshToken({ deviceName: null }));

    expect(Object.keys(dto).sort()).toEqual(
      ['createdAt', 'expiresAt', 'id'].sort(),
    );
    expect(dto.id).toBe(42);
  });

  it('omits tokenHash and previousTokenHash', () => {
    const row = aRefreshToken({
      tokenHash: 'the-current-hash',
      previousTokenHash: 'the-previous-hash',
    });

    const dto = toSessionDto(row);

    expect(dto).not.toHaveProperty('tokenHash');
    expect(dto).not.toHaveProperty('previousTokenHash');
    // Neither value reached the object under some other name.
    expect(JSON.stringify(dto)).not.toContain('the-current-hash');
    expect(JSON.stringify(dto)).not.toContain('the-previous-hash');
  });

  it('returns deviceName when the row holds one', () => {
    const dto = toSessionDto(aRefreshToken({ deviceName: 'Ana iPhone' }));

    expect(dto.deviceName).toBe('Ana iPhone');
  });

  it('leaves the deviceName key absent when the column is null, so the object has no such property', () => {
    const dto = toSessionDto(aRefreshToken({ deviceName: null }));

    // `not.toHaveProperty` and never `toBeUndefined`, which passes on a present
    // key holding undefined. The contract's rule is absence, not a null value.
    expect(dto).not.toHaveProperty('deviceName');
    expect('deviceName' in dto).toBe(false);
  });

  it('returns both dates as ISO 8601 strings', () => {
    const dto = toSessionDto(aRefreshToken());

    expect(typeof dto.createdAt).toBe('string');
    expect(typeof dto.expiresAt).toBe('string');
    expect(dto.createdAt).toBe('2026-08-21T09:14:00.000Z');
    expect(dto.expiresAt).toBe('2026-08-28T09:14:00.000Z');
  });
});
