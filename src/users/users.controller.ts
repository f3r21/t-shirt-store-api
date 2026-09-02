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
import { SIGN_IN_THROTTLE } from '../auth/sign-in-throttle';
import { CheckPolicies } from '../authz/check-policies.decorator';
import { can } from '../authz/policies';

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
  @ApiResponse({
    status: 201,
    description: 'Account created.',
    type: UserDto,
    headers: {
      Location: {
        description: 'The URL of the new account.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'The request body is not valid.' })
  @ApiResponse({ status: 409, description: 'The email address is taken.' })
  @ApiResponse({ status: 429, description: 'Too many requests.' })
  @ApiResponse({ status: 500, description: 'Unexpected server error.' })
  /**
   * The sign-in tier, on sign-up.
   *
   * This route carried no `@Throttle` at all, so it inherited the browse
   * default of 100 a minute. It answers 409 for an address that has an account
   * and 201 for one that does not, which is **a faster and more exact account
   * enumeration oracle than sign-in**, the route this service deliberately
   * hardened by paying an Argon2id hash on the unknown-address path.
   *
   * The 409 cannot be removed: the contract declares it and a caller has to be
   * told the address is taken. So the answer is the limit, and the sign-in tier
   * is the right one, because a person signing up retries within seconds and a
   * script enumerating addresses does not stop at ten.
   */
  @Throttle(SIGN_IN_THROTTLE)
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
  @CheckPolicies(can('update', 'User'))
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
