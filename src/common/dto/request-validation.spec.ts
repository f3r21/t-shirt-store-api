import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { VALIDATION_PIPE_OPTIONS } from '../validation-pipe-options';
import { PageQueryDto } from './page-query.dto';
import { CreateUserDto } from '../../users/dto/create-user.dto';
import { ChangePasswordDto } from '../../users/dto/change-password.dto';
import { CreateSessionDto } from '../../auth/dto/create-session.dto';
import { RefreshSessionDto } from '../../auth/dto/refresh-session.dto';
import { RequestPasswordResetDto } from '../../auth/dto/request-password-reset.dto';
import { ResetPasswordDto } from '../../auth/dto/reset-password.dto';
import type { ProblemField } from '../problem/problem';

/**
 * The request DTOs through the pipe the application runs, built from
 * `VALIDATION_PIPE_OPTIONS`. A rejection's `getResponse()` carries the
 * problem body.
 */
export function runPipe(
  metatype: new () => object,
  value: unknown,
  type: 'body' | 'query' = 'body',
): Promise<unknown> {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  return pipe.transform(value, { type, metatype });
}

/** The rejected fields, or a failure if the pipe accepted the value. */
export async function rejectedFields(
  metatype: new () => object,
  value: unknown,
  type: 'body' | 'query' = 'body',
): Promise<ProblemField[]> {
  let caught: unknown;
  let accepted = false;
  try {
    await runPipe(metatype, value, type);
    accepted = true;
  } catch (err) {
    caught = err;
  }
  if (accepted) {
    throw new Error(
      'expected the pipe to reject this value, and it accepted it',
    );
  }
  expect(caught).toBeInstanceOf(BadRequestException);
  const payload = (caught as BadRequestException).getResponse() as {
    errors: ProblemField[];
  };
  return payload.errors;
}

export const names = (fields: ProblemField[]) => fields.map((f) => f.field);

describe('request validation', () => {
  describe('CreateUserDto', () => {
    const valid = {
      email: 'ana@example.com',
      password: 'correct horse battery',
      firstName: 'Ana',
      lastName: 'Ramirez',
    };

    it('accepts a body with all four fields inside their bounds', async () => {
      await expect(runPipe(CreateUserDto, valid)).resolves.toMatchObject(valid);
    });

    it('rejects an email that is not an email address', async () => {
      const fields = await rejectedFields(CreateUserDto, {
        ...valid,
        email: 'ana at example dot com',
      });
      expect(names(fields)).toEqual(['email']);
    });

    it('rejects an email longer than 254 characters', async () => {
      const long = `${'a'.repeat(250)}@example.com`;
      expect(long.length).toBeGreaterThan(254);

      const fields = await rejectedFields(CreateUserDto, {
        ...valid,
        email: long,
      });
      expect(names(fields)).toContain('email');
    });

    it('rejects a password shorter than 8 characters', async () => {
      const fields = await rejectedFields(CreateUserDto, {
        ...valid,
        password: '1234567',
      });
      expect(names(fields)).toEqual(['password']);
    });

    it('rejects a password longer than 128 characters', async () => {
      const fields = await rejectedFields(CreateUserDto, {
        ...valid,
        password: 'a'.repeat(129),
      });
      expect(names(fields)).toEqual(['password']);
    });

    it('rejects a first name longer than 100 characters', async () => {
      const fields = await rejectedFields(CreateUserDto, {
        ...valid,
        firstName: 'a'.repeat(101),
      });
      expect(names(fields)).toEqual(['firstName']);
    });

    it('rejects an unknown property, so a role in the body cannot be ignored', async () => {
      // The whole reason sign-up can be public: an undeclared property is a 400
      // rather than a value the service silently drops.
      const fields = await rejectedFields(CreateUserDto, {
        ...valid,
        role: 'manager',
      });
      expect(names(fields)).toContain('role');
    });

    it('names every rejected field once in errors[]', async () => {
      // The password breaks three constraints at once. The contract says the
      // member carries one entry per rejected field, so this must be one entry
      // and not three, or a caller could count decorators.
      const fields = await rejectedFields(CreateUserDto, {
        ...valid,
        email: 'not an email',
        password: 1234,
      });

      expect(names(fields).sort()).toEqual(['email', 'password']);
      expect(new Set(names(fields)).size).toBe(fields.length);
      for (const field of fields) {
        expect(typeof field.message).toBe('string');
        expect(field.message.length).toBeGreaterThan(0);
      }
    });

    /**
     * The one message a caller receives has to name the failure to fix first,
     * not the constraint declared last. The second row is the control.
     */
    it.each([
      [
        'the wrong type on a field with length bounds',
        12345,
        /must be a string/,
      ],
      ['a real length violation', 'x'.repeat(200), /at most 128/],
    ])(
      'reports %s with the message that explains it',
      async (_l, password, expected) => {
        const [field] = await rejectedFields(CreateUserDto, {
          ...valid,
          password,
        });

        expect(field.field).toBe('password');
        expect(field.message).toMatch(expected);
      },
    );
  });

  describe('CreateSessionDto', () => {
    const valid = { email: 'ana@example.com', password: 'correct horse' };

    it('accepts a body without deviceName, and carries no value for it', async () => {
      const result = (await runPipe(
        CreateSessionDto,
        valid,
      )) as CreateSessionDto;

      // The key is present on the instance, because `plainToInstance` builds
      // every declared property. What matters is that it holds no value, which
      // is what Prisma reads as "not provided". The absent-key rule the contract
      // states applies to responses, and `toSessionDto` is where it is enforced.
      expect(result.deviceName).toBeUndefined();
      expect(result.email).toBe('ana@example.com');
    });

    it('accepts a deviceName of 64 characters', async () => {
      await expect(
        runPipe(CreateSessionDto, { ...valid, deviceName: 'a'.repeat(64) }),
      ).resolves.toMatchObject({ deviceName: 'a'.repeat(64) });
    });

    it('rejects a deviceName longer than 64 characters', async () => {
      const fields = await rejectedFields(CreateSessionDto, {
        ...valid,
        deviceName: 'a'.repeat(65),
      });
      expect(names(fields)).toEqual(['deviceName']);
    });

    it('rejects an explicit null deviceName, because an optional value is absent and never null', async () => {
      // `@IsOptional()` would treat null as missing and skip every decorator
      // after it, so the null would reach the service unchecked.
      const fields = await rejectedFields(CreateSessionDto, {
        ...valid,
        deviceName: null,
      });
      expect(names(fields)).toEqual(['deviceName']);
    });

    it('rejects a password shorter than 8 characters, which is a 400 and not a 401', async () => {
      // The answer names the password policy. It does not say whether the
      // account exists, so it leaks nothing the policy does not already state.
      const fields = await rejectedFields(CreateSessionDto, {
        ...valid,
        password: 'short',
      });
      expect(names(fields)).toEqual(['password']);
    });
  });

  describe('RefreshSessionDto', () => {
    it('rejects an empty refreshToken', async () => {
      const fields = await rejectedFields(RefreshSessionDto, {
        refreshToken: '',
      });
      expect(names(fields)).toEqual(['refreshToken']);
    });

    it('rejects a refreshToken longer than 512 characters', async () => {
      const fields = await rejectedFields(RefreshSessionDto, {
        refreshToken: 'a'.repeat(513),
      });
      expect(names(fields)).toEqual(['refreshToken']);
    });
  });

  describe('RequestPasswordResetDto', () => {
    it('rejects an email that is not an email address', async () => {
      const fields = await rejectedFields(RequestPasswordResetDto, {
        email: 'nope',
      });
      expect(names(fields)).toEqual(['email']);
    });
  });

  describe('ResetPasswordDto', () => {
    it('rejects an empty token', async () => {
      const fields = await rejectedFields(ResetPasswordDto, {
        token: '',
        password: 'a good password',
      });
      expect(names(fields)).toEqual(['token']);
    });

    it('rejects a password shorter than 8 characters', async () => {
      const fields = await rejectedFields(ResetPasswordDto, {
        token: 'a'.repeat(64),
        password: 'short',
      });
      expect(names(fields)).toEqual(['password']);
    });
  });

  describe('ChangePasswordDto', () => {
    it('rejects a body that carries only currentPassword', async () => {
      const fields = await rejectedFields(ChangePasswordDto, {
        currentPassword: 'the current one',
      });
      expect(names(fields)).toContain('newPassword');
    });

    it('rejects a newPassword shorter than 8 characters', async () => {
      const fields = await rejectedFields(ChangePasswordDto, {
        currentPassword: 'the current one',
        newPassword: 'short',
      });
      expect(names(fields)).toEqual(['newPassword']);
    });
  });

  describe('PageQueryDto', () => {
    it('applies limit 20 and offset 0 when the query carries neither', async () => {
      const result = (await runPipe(PageQueryDto, {}, 'query')) as PageQueryDto;

      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('converts the string a query carries into a number', async () => {
      // A query string is always text. Without the conversion the service would
      // pass "40" to Prisma's skip, which expects a number.
      const result = (await runPipe(
        PageQueryDto,
        { limit: '50', offset: '40' },
        'query',
      )) as PageQueryDto;

      expect(result.limit).toBe(50);
      expect(result.offset).toBe(40);
      expect(typeof result.limit).toBe('number');
      expect(typeof result.offset).toBe('number');
    });

    it('rejects limit 0', async () => {
      const fields = await rejectedFields(
        PageQueryDto,
        { limit: '0' },
        'query',
      );
      expect(names(fields)).toEqual(['limit']);
    });

    it('rejects limit 101', async () => {
      const fields = await rejectedFields(
        PageQueryDto,
        { limit: '101' },
        'query',
      );
      expect(names(fields)).toEqual(['limit']);
    });

    it('rejects a negative offset', async () => {
      const fields = await rejectedFields(
        PageQueryDto,
        { offset: '-1' },
        'query',
      );
      expect(names(fields)).toEqual(['offset']);
    });
  });
});
