import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { AuthController } from './auth/auth.controller';
import { UsersController } from './users/users.controller';
import { MAILER } from './mail/mailer';
import { validateEnv } from './config/env.validation';

/**
 * The application boots.
 *
 * `compile()` resolves the whole dependency graph without opening a socket or a
 * database connection, so this catches the class of failure that a unit test
 * cannot: a provider nothing supplies, a module that forgot an export, a
 * factory that reads a variable the environment schema does not declare.
 *
 * It is worth a test rather than a manual check because the failure only
 * appears at boot. Every service spec here builds its own tiny module, so all
 * of them would stay green while `npm run start:dev` threw.
 *
 * The environment is set here rather than read from `.env`, so the test states
 * exactly what the application requires and does not pass because a developer's
 * machine happens to be configured.
 */
describe('AppModule', () => {
  const REQUIRED = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/tshirt_store',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'a'.repeat(32),
    REFRESH_TOKEN_PEPPER: 'b'.repeat(32),
    MAIL_FROM: 'no-reply@tshirt.store',
  };

  let saved: NodeJS.ProcessEnv;

  beforeAll(() => {
    saved = { ...process.env };
    Object.assign(process.env, REQUIRED);
  });

  afterAll(() => {
    process.env = saved;
  });

  it('resolves every provider the application declares', async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // The two controllers the auth work added, and the mailer binding that
    // nothing outside a test used to supply.
    expect(module.get(AuthController)).toBeDefined();
    expect(module.get(UsersController)).toBeDefined();
    expect(module.get(MAILER)).toBeDefined();

    await module.close();
  });

  /**
   * The validator is exercised directly rather than through the module.
   *
   * Deleting a key from `process.env` proves nothing here: `@nestjs/config`
   * falls back to the `.env` file, so the value is still supplied and the module
   * compiles. Calling `validateEnv` with an explicit object is the only way to
   * state what the schema actually rejects.
   */
  it('refuses a configuration that is missing a required variable', () => {
    const withoutSecret: Record<string, string> = { ...REQUIRED };
    delete withoutSecret.JWT_SECRET;

    expect(() => validateEnv(withoutSecret)).toThrow(/JWT_SECRET/);
    expect(() => validateEnv(REQUIRED)).not.toThrow();
  });

  it('reads a numeric variable that arrives as a string, as dotenv supplies it', () => {
    // The regression this guards: every numeric property needs an explicit
    // `: number`, or `emitDecoratorMetadata` writes Object, class-transformer
    // has nothing to coerce to, and setting the variable at all breaks the boot.
    const parsed = validateEnv({
      ...REQUIRED,
      PORT: '3000',
      THROTTLE_TTL: '60',
      SMTP_PORT: '1025',
      JWT_ACCESS_TTL: '900',
    });

    expect(parsed.PORT).toBe(3000);
    expect(parsed.THROTTLE_TTL).toBe(60);
    expect(parsed.SMTP_PORT).toBe(1025);
    expect(parsed.JWT_ACCESS_TTL).toBe(900);
  });
});
