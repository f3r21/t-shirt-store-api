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
 * The policies a handler requires. A handler with no marker is 403 for
 * everyone, so a forgotten decorator fails closed. `@ApiBearerAuth` is
 * composed here, so the document cannot disagree with the guard.
 */
export const CheckPolicies = (...policies: Policy[]) =>
  applyDecorators(
    SetMetadata(CHECK_POLICIES_KEY, policies),
    ApiBearerAuth('bearerAuth'),
  );
