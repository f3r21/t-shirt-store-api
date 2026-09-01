import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { CONFIG_MODULE_OPTIONS } from './config/config-module-options';
import { AuthController } from './auth/auth.controller';
import { UsersController } from './users/users.controller';
import { MAILER } from './mail/mailer';
import { validateEnv, EnvironmentVariables } from './config/env.validation';

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
  // `REDIS_URL` used to sit in here, and it is the reason this constant is
  // worth reading: it is the list of what the application genuinely cannot
  // start without, and a variable nothing opens does not belong on it.
  const REQUIRED = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/tshirt_store',
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

  /**
   * A variable nothing reads must not stop the boot, and must still be checked
   * when it is supplied.
   *
   * `REDIS_URL` was required, so every deployment and the CI job invented a
   * value for a service the process never opens: no file in `src` reads it and
   * `package.json` carries no Redis client. `REQUIRED` above no longer names
   * it, which is the first half of the proof, and the second half is that a
   * present but malformed value still fails at boot rather than at the first
   * job that would have used it.
   */
  it('accepts a missing REDIS_URL and still refuses a malformed one', () => {
    expect(() => validateEnv({ ...REQUIRED })).not.toThrow();

    expect(() =>
      validateEnv({ ...REQUIRED, REDIS_URL: 'redis://localhost:6379' }),
    ).not.toThrow();

    expect(() => validateEnv({ ...REQUIRED, REDIS_URL: 'not-a-url' })).toThrow(
      /REDIS_URL/,
    );
  });

  /**
   * **No numeric variable may accept a present but empty value, and the list of
   * them is discovered rather than written down.**
   *
   * This is the gate, not the fix. The fix is one filter in `validateEnv`; this
   * is what keeps it honest for variables nobody has added yet. It walks the
   * schema with `design:type` metadata, keeps the properties TypeScript typed
   * as `number`, and asserts each one reads the same whether it is omitted or
   * supplied as `''`.
   *
   * A hand-written list would have been wrong the day it was written: the two
   * variables that made this a security problem, `REFRESH_GRACE_SECONDS` and
   * `TRUST_PROXY_HOPS`, were added by two different commits on the same
   * afternoon, and `PORT` had been carrying the same hole since the first week.
   *
   * The `expect(numeric.length)` line is the control. Metadata discovery that
   * silently finds nothing would satisfy every assertion in the loop.
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
   * **Every variable the schema declares appears in `.env.example`.**
   *
   * Three commits added `REFRESH_GRACE_SECONDS`, `CORS_ORIGINS` and
   * `TRUST_PROXY_HOPS` and none of them touched the example file, while
   * `README.md` went on saying it fills in every value but two. A developer
   * copying it got a working boot and three defaults they did not know existed,
   * one of which decides whether a stolen refresh token raises an alarm.
   *
   * Discovered from the schema rather than listed, for the same reason as the
   * check above: a list is a fourth place to forget.
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
   * **No boolean variable may read a word as truthy, and the list of them is
   * discovered rather than written down.**
   *
   * The sibling of the check above, one type over, and it was found by running
   * the numeric one's reasoning against the variable this round added.
   * `SMTP_SECURE` carried `@Type(() => Boolean)`, which is `Boolean(value)`
   * under implicit conversion, so `SMTP_SECURE=false` read true.
   *
   * The last assertion is the one that makes this a gate rather than a
   * spelling test: an unknown word has to stop the boot. Every string is
   * truthy, so a boolean that does not reject loudly accepts silently, and
   * there is no third outcome.
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
   * **A variable the shell exported empty stays absent through the module.**
   *
   * The gate above proves `validateEnv` reads `''` as absent. This is the
   * other half. `ConfigService.get` used to fall through to `process.env` when
   * the validated value was undefined, and a container that exports
   * `SMTP_USER=` leaves `''` there. So the validator said absent, the service
   * said `''`, and the mailer authenticated with empty credentials. A `.env`
   * line never showed it, because the file is parsed and not exported.
   * `mailer.nodemailer.spec.ts` proves the mailer sends no `auth` for an
   * undefined pair, so undefined here is what closes it.
   *
   * `PORT` is the same hole one type over. It has a default, so the validated
   * value has to win over the shell's `''`, and `main.ts` reads that value
   * rather than the shell. The set pair is the control: the option that closes
   * this must not hide a real value.
   *
   * Built from `CONFIG_MODULE_OPTIONS` and not from `AppModule`, because
   * `forRoot` reads the environment when `app.module.ts` is imported, and a
   * test that sets `process.env` afterwards is testing the environment the
   * import saw. The first version of this test compiled `AppModule` and three
   * of its assertions passed for exactly that reason.
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
