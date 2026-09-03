import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { AccessTokenPayload } from '../access-token-payload';

/**
 * The verified token payload, or undefined on an optional-auth route with no
 * token.
 *
 * A handler on a protected route can treat this as present: the guard rejects
 * before the handler runs when a token is missing or bad.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessTokenPayload | undefined =>
    context.switchToHttp().getRequest<Request>().user,
);
