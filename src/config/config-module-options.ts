import type { ConfigModuleOptions } from '@nestjs/config';
import { validateEnv } from './env.validation';

/**
 * The options `AppModule` hands to `ConfigModule.forRoot`, shared with
 * `app.module.spec.ts` because `forRoot` reads the environment once, at
 * import. `skipProcessEnv`, or a key `validateEnv` dropped as empty would fall
 * through to the shell's `''`.
 */
export const CONFIG_MODULE_OPTIONS: ConfigModuleOptions = {
  isGlobal: true,
  validate: validateEnv,
  skipProcessEnv: true,
};
