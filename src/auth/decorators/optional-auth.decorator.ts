import { SetMetadata } from '@nestjs/common';

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
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
