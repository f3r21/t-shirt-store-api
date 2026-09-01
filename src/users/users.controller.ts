import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
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
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLE_NAMES } from './dto/user.dto';

@ApiTags('auth')
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
  @ApiOperation({ summary: 'Create an account' })
  @ApiResponse({ status: 201, description: 'Account created.', type: UserDto })
  @ApiResponse({ status: 400, description: 'The request body is not valid.' })
  @ApiResponse({ status: 409, description: 'The email address is taken.' })
  @ApiResponse({ status: 500, description: 'Unexpected server error.' })
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
  @Roles(...ROLE_NAMES)
  @ApiOperation({ summary: 'Change the password of the signed-in account' })
  @ApiResponse({ status: 204, description: 'Password changed.' })
  @ApiResponse({ status: 400, description: 'The request body is not valid.' })
  @ApiResponse({ status: 401, description: 'Authentication is required.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Unexpected server error.' })
  @Patch('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.users.changePassword(user.sub, dto);
  }
}
