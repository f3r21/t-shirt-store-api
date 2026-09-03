import type { ConfigModuleOptions } from '@nestjs/config';
import { validateEnv } from './env.validation';

/**
 * The options `AppModule` hands to `ConfigModule.forRoot`, in one place.
 *
 * `app.module.spec.ts` builds its own `ConfigModule` from this object, for the
 * reason `validation-pipe-options.ts` gives: a spec that declared its own
 * options would test a module the application does not run, and the drift
 * would be invisible because both would pass.
 *
 * It has to be a shared object rather than an assertion against `AppModule`,
 * because `forRoot` reads the environment once, when `app.module.ts` is
 * imported. A spec that sets `process.env` afterwards and compiles `AppModule`
 * is reading the environment the import saw, and three of its assertions
 * passed that way before the fourth one caught it.
 *
 * **`skipProcessEnv`, or the validated object is not the only source.**
 * `validateEnv` reads a variable that is present and empty as absent. Without
 * this option, a key it dropped is undefined in the validated object and
 * `ConfigService.get` falls through to `process.env`, where the shell's `''`
 * still sits. A container that exported `SMTP_USER=` got a mailer
 * authenticating with empty credentials, and `PORT=` read `''`. A `.env` line
 * never showed it, because the file is parsed and not exported. Measured with
 * the real module and an empty exported pair: `get('SMTP_USER')` answered `''`
 * without the option and `undefined` with it, while a set value still came
 * through.
 */
export const CONFIG_MODULE_OPTIONS: ConfigModuleOptions = {
  isGlobal: true,
  validate: validateEnv,
  skipProcessEnv: true,
};
