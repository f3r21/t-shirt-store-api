import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AccessTokenPayload } from '../access-token-payload';

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
