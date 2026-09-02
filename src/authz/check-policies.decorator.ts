import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AppAbility } from './ability';

export const CHECK_POLICIES_KEY = 'checkPolicies';

/**
 * One question a handler asks of the caller's ability before it runs.
 *
 * A function rather than an object, the shape the NestJS authorization page
 * gives, with the request as the second argument so a policy can read what
 * the caller asked for: `listProducts` needs to know whether the query asks
 * for the inactive products before it can say who may ask.
 */
export type Policy = (ability: AppAbility, request: Request) => boolean;

/**
 * The policies a handler requires, all of them.
 *
 * A handler with no marker at all reaches nobody. `PoliciesGuard` denies by
 * default, so an undecorated route answers 403 to every caller including a
 * manager, and that is the point: the route somebody adds next week and
 * forgets to decorate fails closed.
 *
 * **The marker also tells the OpenAPI document.** Needing a token and needing
 * a policy are the same fact, and stating it twice is how the served document
 * once showed public operations as requiring a bearer token. Composing
 * `@ApiBearerAuth` here means the document cannot disagree with the guard,
 * because there is only one statement to read. An optional-auth route adds
 * `@OptionalAuth`, which contributes the empty requirement beside this one.
 */
export const CheckPolicies = (...policies: Policy[]) =>
  applyDecorators(
    SetMetadata(CHECK_POLICIES_KEY, policies),
    ApiBearerAuth('bearerAuth'),
  );
