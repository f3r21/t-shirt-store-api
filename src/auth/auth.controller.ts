import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SessionTokensDto } from './dto/session-tokens.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AccessTokenPayload } from './access-token-payload';
import { PageQueryDto } from '../common/dto/page-query.dto';
import { PASSWORD_THROTTLE } from './password-throttle';
import { Roles } from './decorators/roles.decorator';
import { ROLE_NAMES } from '../users/dto/user.dto';
import { SIGN_IN_THROTTLE } from './sign-in-throttle';

@ApiTags('auth')
@ApiBearerAuth('bearerAuth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Sign in. 201, because this creates a session in a collection of sessions.
   *
   * `Location` names the new session, so a client can sign this one device out
   * later without listing them first.
   */
  @Public()
  @Throttle(SIGN_IN_THROTTLE)
  @ApiOperation({ summary: 'Create a session and get tokens' })
  @ApiResponse({
    status: 201,
    description: 'The server created the session.',
    type: SessionTokensDto,
  })
  @ApiResponse({ status: 400, description: 'The request is not valid.' })
  @ApiResponse({ status: 401, description: 'The credentials are wrong.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  async createSession(
    @Body() dto: CreateSessionDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionTokensDto> {
    const { sessionId, ...tokens } = await this.auth.createSession(dto);
    res.setHeader('Location', `/v1/auth/sessions/${sessionId}`);
    return tokens;
  }

  /** 200 and not 201, because rotation replaces a session rather than creating one. */
  @Public()
  @ApiOperation({ summary: 'Exchange a refresh token for new tokens' })
  @ApiResponse({
    status: 200,
    description: 'The server rotated the tokens.',
    type: SessionTokensDto,
  })
  @ApiResponse({ status: 400, description: 'The request is not valid.' })
  @ApiResponse({ status: 401, description: 'The token is not valid.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refreshSession(@Body() dto: RefreshSessionDto): Promise<SessionTokensDto> {
    return this.auth.refreshSession(dto);
  }

  @Roles(...ROLE_NAMES)
  @ApiOperation({ summary: 'List the devices signed in to this account' })
  @ApiResponse({ status: 200, description: 'The server sent the list.' })
  @ApiResponse({ status: 400, description: 'The query is not valid.' })
  @ApiResponse({ status: 401, description: 'The token is not valid.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Get('sessions')
  listSessions(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: PageQueryDto,
  ) {
    return this.auth.listSessions(user.sub, query);
  }

  /**
   * Sign this device out.
   *
   * Declared before `sessions/:id`. Nest matches routes in declaration order,
   * so the parameterised route would otherwise swallow this one and the handler
   * would receive the literal string `current` as an id.
   */
  @Roles(...ROLE_NAMES)
  @ApiOperation({ summary: 'Sign out this device' })
  @ApiResponse({ status: 204, description: 'The device is signed out.' })
  @ApiResponse({ status: 401, description: 'The token is not valid.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Delete('sessions/current')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCurrentSession(@CurrentUser() user: AccessTokenPayload): Promise<void> {
    return this.auth.deleteCurrentSession(user.sub, user.sid);
  }

  @Roles(...ROLE_NAMES)
  @ApiOperation({ summary: 'Sign out another device' })
  @ApiResponse({ status: 204, description: 'The device is signed out.' })
  @ApiResponse({ status: 401, description: 'The token is not valid.' })
  @ApiResponse({ status: 404, description: 'The session does not exist.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSession(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.auth.deleteSession(user.sub, id);
  }

  /**
   * 202, and the same 202 whether or not the address has an account.
   *
   * Rate limited because the endpoint sends mail to an address the caller
   * chooses, and because an unlimited caller could probe the address space even
   * though the answer never differs.
   */
  @Public()
  @Throttle(PASSWORD_THROTTLE)
  @ApiOperation({ summary: 'Request a password reset link' })
  @ApiResponse({ status: 202, description: 'The request is accepted.' })
  @ApiResponse({ status: 400, description: 'The request is not valid.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  requestPasswordReset(@Body() dto: RequestPasswordResetDto): Promise<void> {
    return this.auth.requestPasswordReset(dto);
  }

  @Public()
  @Throttle(PASSWORD_THROTTLE)
  @ApiOperation({ summary: 'Set a new password with a reset token' })
  @ApiResponse({ status: 204, description: 'The password is changed.' })
  @ApiResponse({ status: 400, description: 'The request is not valid.' })
  @ApiResponse({ status: 422, description: 'The reset token is not valid.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'The server failed.' })
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.auth.resetPassword(dto);
  }
}
