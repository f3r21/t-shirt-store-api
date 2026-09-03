import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { CONFIG_MODULE_OPTIONS } from './config/config-module-options';
import { AuthController } from './auth/auth.controller';
import { UsersController } from './users/users.controller';
import { MAILER } from './mail/mailer';
import { STOCK_QUEUE } from './stock-notifications/stock-queue';
import { validateEnv, EnvironmentVariables } from './config/env.validation';

/**
 * The application boots. `compile()` resolves the whole graph without a
 * socket, which catches a provider nothing supplies or a factory that reads
 * an undeclared variable. The environment is set here, not read from `.env`.
 */
describe('AppModule', () => {
  // This constant is the list of what the application genuinely cannot start
  // without. `REDIS_URL` left it while nothing opened a Redis connection, and
  // it is back since the stock notification queue does.
  const REQUIRED = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/tshirt_store',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'a'.repeat(32),
    REFRESH_TOKEN_PEPPER: 'b'.repeat(32),
    MAIL_FROM: 'no-reply@tshirt.store',
    // Required since block 3: a store that cannot verify a webhook must not
    // boot. Throwaway values; the signature check is exercised end to end.
    STRIPE_SECRET_KEY: 'sk_test_spec',
    STRIPE_WEBHOOK_SECRET: 'whsec_spec',
    // Required since the image operations: the store and the address images
    // are served from. Throwaway values; the e2e suite replaces the store.
    S3_BUCKET: 'spec-only-bucket',
    IMAGES_BASE_URL: 'https://images.example',
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
    // The queue is the one provider that would open a socket when used, so
    // it is replaced here and the test keeps the promise its docstring makes.
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(STOCK_QUEUE)
      .useValue({ add: jest.fn(), close: jest.fn() })
      .compile();

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

  /**
   * A variable something opens must stop the boot when it is missing, and must
   * still be checked when it is supplied.
   *
   * `REDIS_URL` was optional while no file in `src` opened a Redis connection.
   * The stock notification queue opens one now, so a missing value fails here
   * rather than at the first enqueue, and a present but malformed value, or one
   * with the wrong scheme, fails the same way.
   */
  it('refuses a missing REDIS_URL, and a malformed one', () => {
    const withoutRedis: Record<string, string> = { ...REQUIRED };
    delete withoutRedis.REDIS_URL;

    expect(() => validateEnv(withoutRedis)).toThrow(/REDIS_URL/);
    expect(() => validateEnv({ ...REQUIRED, REDIS_URL: 'not-a-url' })).toThrow(
      /REDIS_URL/,
    );
    expect(() =>
      validateEnv({ ...REQUIRED, REDIS_URL: 'http://localhost:6379' }),
    ).toThrow(/REDIS_URL/);
    expect(() => validateEnv(REQUIRED)).not.toThrow();
  });

  /**
   * `MAIL_TRANSPORT` is a word from a fixed list. A word outside it has to stop
   * the boot, because the mailer branches on it and an unknown word would fall
   * through to one branch or the other and send somewhere nobody chose.
   */
  it('refuses an unknown MAIL_TRANSPORT, and reads the two it knows', () => {
    expect(() =>
      validateEnv({ ...REQUIRED, MAIL_TRANSPORT: 'carrier-pigeon' }),
    ).toThrow(/MAIL_TRANSPORT/);
    expect(() =>
      validateEnv({ ...REQUIRED, MAIL_TRANSPORT: 'ses' }),
    ).not.toThrow();
    expect(() =>
      validateEnv({ ...REQUIRED, MAIL_TRANSPORT: 'smtp' }),
    ).not.toThrow();
  });

  /**
   * No numeric variable may read `''` as 0. The list is discovered from
   * `design:type`, so a variable added later is covered, and the length check
   * is the control.
   */
  it('treats an empty numeric variable as absent, for every numeric variable', () => {
    const proto = EnvironmentVariables.prototype as object;
    const numeric = Object.getOwnPropertyNames(
      new EnvironmentVariables(),
    ).filter(
      (key) =>
        (Reflect.getMetadata('design:type', proto, key) as unknown) === Number,
    );

    // Discovery found something. Without this the loop below proves nothing.
    expect(numeric.length).toBeGreaterThan(5);

    for (const key of numeric) {
      const omitted = validateEnv({ ...REQUIRED }) as unknown as Record<
        string,
        unknown
      >;
      const empty = validateEnv({
        ...REQUIRED,
        [key]: '',
      }) as unknown as Record<string, unknown>;
      expect([key, empty[key]]).toEqual([key, omitted[key]]);
    }
  });

  /**
   * Every declared variable appears in `.env.example`, discovered from the
   * schema so there is no list to forget.
   */
  it('documents every declared variable in .env.example', () => {
    const example = readFileSync(join(__dirname, '..', '.env.example'), 'utf8');
    const declared = Object.getOwnPropertyNames(new EnvironmentVariables());

    // Discovery found something, or the filter below proves nothing.
    expect(declared.length).toBeGreaterThan(10);

    const missing = declared.filter(
      (key) => !new RegExp(`^${key}=`, 'm').test(example),
    );
    expect(missing).toEqual([]);
  });

  /**
   * No boolean variable may read a word as truthy, and an unknown word stops
   * the boot. Discovered from `design:type`.
   */
  it('reads every boolean variable as a word, not as a truthy string', () => {
    const proto = EnvironmentVariables.prototype as object;
    const booleans = Object.getOwnPropertyNames(
      new EnvironmentVariables(),
    ).filter(
      (key) =>
        (Reflect.getMetadata('design:type', proto, key) as unknown) === Boolean,
    );

    // Discovery found something. Without this the loop below proves nothing.
    expect(booleans.length).toBeGreaterThan(0);

    const read = (key: string, value: string) => {
      const parsed = validateEnv({
        ...REQUIRED,
        [key]: value,
      }) as unknown as Record<string, unknown>;
      return parsed[key];
    };

    for (const key of booleans) {
      expect([key, read(key, 'false')]).toEqual([key, false]);
      expect([key, read(key, '0')]).toEqual([key, false]);
      expect([key, read(key, 'true')]).toEqual([key, true]);
      expect([key, read(key, '1')]).toEqual([key, true]);
      expect(() => validateEnv({ ...REQUIRED, [key]: 'nonsense' })).toThrow(
        new RegExp(key),
      );
    }
  });

  /**
   * A variable the shell exported empty stays absent through
   * `ConfigService`, which is what `skipProcessEnv` buys. The set pair is the
   * control. Built from `CONFIG_MODULE_OPTIONS`, because `forRoot` reads the
   * environment at import.
   */
  it('reads a variable the shell exported empty as absent, through the module', async () => {
    const before = { ...process.env };
    const configWith = async (shell: Record<string, string>) => {
      process.env = { ...before, ...REQUIRED, ...shell };
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            ...CONFIG_MODULE_OPTIONS,
            ignoreEnvFile: true,
          }),
        ],
      }).compile();
      return module.get(ConfigService);
    };

    try {
      const empty = await configWith({
        SMTP_HOST: 'relay.example',
        SMTP_USER: '',
        SMTP_PASS: '',
        PORT: '',
      });
      expect(empty.get('SMTP_USER')).toBeUndefined();
      expect(empty.get('SMTP_PASS')).toBeUndefined();
      expect(empty.get('PORT')).toBe(3000);
      expect(empty.get('SMTP_HOST')).toBe('relay.example');

      const set = await configWith({
        SMTP_USER: 'bob',
        SMTP_PASS: 'hunter22',
        PORT: '4000',
      });
      expect(set.get('SMTP_USER')).toBe('bob');
      expect(set.get('SMTP_PASS')).toBe('hunter22');
      expect(set.get('PORT')).toBe(4000);
    } finally {
      process.env = before;
    }
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
