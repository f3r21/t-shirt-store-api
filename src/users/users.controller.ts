import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UserDto } from './dto/user.dto';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/access-token-payload';
import { PASSWORD_THROTTLE } from '../auth/password-throttle';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * Sign up. Public, and it returns no tokens: the caller signs in afterwards.
   *
   * The body carries no role. Every account this creates is a client account,
   * and the pipe rejects an unknown property, so a `role` in the body is a 400
   * rather than a silent privilege grant.
   */
  @Public()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createUser(
    @Body() dto: CreateUserDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserDto> {
    const user = await this.users.createUser(dto);
    res.setHeader('Location', `/v1/users/${user.id}`);
    return user;
  }

  /**
   * Change the password of the signed-in account.
   *
   * Rate limited because the body carries a password guess, which is the same
   * reason the contract declares a 429 here.
   */
  @Throttle(PASSWORD_THROTTLE)
  @Patch('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.users.changePassword(user.sub, dto);
  }
}
