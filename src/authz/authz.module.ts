import { Global, Module } from '@nestjs/common';
import { AbilityFactory } from './ability.factory';

/**
 * The ability factory, global because the guard that needs it is global and a
 * service in any module may build an ability for a spec.
 */
@Global()
@Module({
  providers: [AbilityFactory],
  exports: [AbilityFactory],
})
export class AuthzModule {}
