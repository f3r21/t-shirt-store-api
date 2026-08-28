import { toUserDto } from './user.mapper';
import { aUser } from './users.fixtures';

/**
 * The mapper that turns a `users` row into the `User` response shape.
 *
 * The `users` row also carries `password_hash`, the reset token hash and its
 * expiry. The contract names the six fields that may leave, so the field list is
 * the behaviour under test and not an implementation detail.
 */
describe('toUserDto', () => {
  it('returns the six fields the User schema names at openapi.yaml:1751', () => {
    const dto = toUserDto(aUser());

    // The key set, not field by field. Asserting each field individually would
    // still pass if a seventh appeared, which is the thing this guards against.
    expect(Object.keys(dto).sort()).toEqual(
      ['createdAt', 'email', 'firstName', 'id', 'lastName', 'role'].sort(),
    );
  });

  it('omits passwordHash', () => {
    const dto = toUserDto(aUser());

    expect(dto).not.toHaveProperty('passwordHash');
    // The value must not have reached the object under any other name either.
    expect(JSON.stringify(dto)).not.toContain(aUser().passwordHash);
  });

  it('omits the reset token and its expiry', () => {
    const live = aUser({
      resetTokenHash: 'a-live-reset-token-hash',
      resetTokenExpiresAt: new Date('2026-08-28T12:00:00.000Z'),
    });

    const dto = toUserDto(live);

    expect(dto).not.toHaveProperty('resetTokenHash');
    expect(dto).not.toHaveProperty('resetTokenExpiresAt');
    expect(JSON.stringify(dto)).not.toContain('a-live-reset-token-hash');
  });

  it('returns createdAt as an ISO 8601 string and not a Date', () => {
    const dto = toUserDto(aUser());

    expect(typeof dto.createdAt).toBe('string');
    expect(dto.createdAt).toBe('2026-08-21T13:45:00.000Z');
  });

  it('returns the role name from the loaded roles row', () => {
    const manager = aUser({ roleId: 1, role: { id: 1, name: 'manager' } });

    expect(toUserDto(manager).role).toBe('manager');
    expect(toUserDto(aUser()).role).toBe('client');
  });

  it('throws when the roles row holds a name the contract does not declare', () => {
    const unknown = aUser({ role: { id: 9, name: 'wholesaler' } });

    // A 500 is the right answer here. A role name the contract does not declare
    // is a server fault, and returning it would put an undeclared value on the
    // wire for a client to branch on.
    expect(() => toUserDto(unknown)).toThrow(/wholesaler/);
  });
});
