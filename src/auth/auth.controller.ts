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
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refreshSession(@Body() dto: RefreshSessionDto): Promise<SessionTokensDto> {
    return this.auth.refreshSession(dto);
  }

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
  @Delete('sessions/current')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCurrentSession(@CurrentUser() user: AccessTokenPayload): Promise<void> {
    return this.auth.deleteCurrentSession(user.sub, user.sid);
  }

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
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  requestPasswordReset(@Body() dto: RequestPasswordResetDto): Promise<void> {
    return this.auth.requestPasswordReset(dto);
  }

  @Public()
  @Throttle(PASSWORD_THROTTLE)
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.auth.resetPassword(dto);
  }
}
