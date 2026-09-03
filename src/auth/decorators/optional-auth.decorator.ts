import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * A token is allowed and not required, as the contract spells `listProducts`
 * and `getProduct`. A present token is still verified. `@ApiSecurity({})`
 * emits the empty requirement beside the bearer one `@CheckPolicies` adds, so
 * the served operation carries `[{}, {bearerAuth: []}]`. ADR 6.
 */
export const OptionalAuth = () =>
  applyDecorators(SetMetadata(IS_OPTIONAL_AUTH_KEY, true), ApiSecurity({}));
