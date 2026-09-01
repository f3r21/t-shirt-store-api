import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * A token is allowed and not required.
 *
 * This is the third authentication state, and it exists because the contract
 * has it. `listProducts` and `getProduct` are spelled with an empty security
 * object beside the bearer scheme, meaning a caller may be anonymous, and a
 * manager who does send a token sees the disabled products.
 *
 * `@Public()` cannot express it. Public returns before any token work, so the
 * handler would never learn who the caller is even when a token was sent. Here
 * a present token is still verified, and only its absence is forgiven.
 *
 * **The two swagger decorators reproduce the contract's spelling exactly.**
 * `@ApiSecurity({})` emits the empty requirement that means anonymous is
 * allowed, and `@ApiBearerAuth` emits the alternative beside it, so the served
 * operation carries `[{}, {bearerAuth: []}]` the way `openapi.yaml:511-513`
 * does. Emitting only one of the two would describe a route that is either
 * closed to shoppers or closed to managers, and both readings are wrong.
 */
export const OptionalAuth = () =>
  applyDecorators(
    SetMetadata(IS_OPTIONAL_AUTH_KEY, true),
    ApiSecurity({}),
    ApiBearerAuth('bearerAuth'),
  );
