import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';

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
 * **The document's spelling comes from two decorators on the handler.**
 * `@ApiSecurity({})` here emits the empty requirement that means anonymous is
 * allowed, and `@CheckPolicies`, which every non-public handler carries, emits
 * the bearer alternative beside it, so the served operation carries
 * `[{}, {bearerAuth: []}]` the way `openapi.yaml:511-513` does. An optional
 * route is therefore always `@OptionalAuth()` with `@CheckPolicies(...)`, and
 * the policies run against the anonymous ability when no token came.
 */
export const OptionalAuth = () =>
  applyDecorators(SetMetadata(IS_OPTIONAL_AUTH_KEY, true), ApiSecurity({}));
