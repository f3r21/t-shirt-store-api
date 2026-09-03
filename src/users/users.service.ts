import { Inject, Injectable, Logger } from '@nestjs/common';
import argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { MAILER, type Mailer } from '../mail/mailer';
import { ProblemException } from '../common/problem/problem.exception';
import { ProblemType } from '../common/problem/problem-type';
import { CreateUserDto } from './dto/create-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UserDto } from './dto/user.dto';
import { toUserDto } from './user.mapper';
import { normalizeEmail } from '../common/email';

/**
 * The two operations under /users. `MAILER` is a token, because `Mailer` is an
 * interface with no runtime value.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  private emailTaken(): ProblemException {
    return new ProblemException(
      ProblemType.EmailTaken,
      'Email already registered',
      409,
      'An account with this email already exists.',
    );
  }

  /**
   * Create a client account; the role never comes from the body. The pre-read
   * answers the common `email-taken` 409, and the `P2002` catch covers two
   * sign-ups racing past it.
   */
  async createUser(dto: CreateUserDto): Promise<UserDto> {
    const email = normalizeEmail(dto.email);

    const taken = await this.prisma.user.findUnique({
      where: { email },
    });
    if (taken !== null) {
      throw this.emailTaken();
    }

    const role = await this.prisma.role.findUnique({
      where: { name: 'client' },
    });
    if (role === null) {
      throw new Error('The roles table holds no client role. Run the seed.');
    }

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash: await argon2.hash(dto.password),
          firstName: dto.firstName,
          lastName: dto.lastName,
          roleId: role.id,
        },
        include: { role: true },
      });

      return toUserDto(user);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw this.emailTaken();
      }
      throw err;
    }
  }

  /**
   * Replace the signed-in user's password. A wrong current password is 401.
   * Every session ends, and a live reset token is cleared, so an attacker's
   * link stops working. `argon2.verify` takes the digest first.
   */
  async changePassword(userId: number, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user === null) {
      throw new ProblemException(
        ProblemType.InvalidCredentials,
        'Invalid credentials',
        401,
        'The server did not accept this email and password.',
      );
    }

    const matches = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!matches) {
      throw new ProblemException(
        ProblemType.InvalidCredentials,
        'Invalid credentials',
        401,
        'The server did not accept this email and password.',
      );
    }

    // The new password and the session wipe commit together, or neither does.
    const passwordHash = await argon2.hash(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          resetTokenHash: null,
          resetTokenExpiresAt: null,
        },
      });
      await tx.refreshToken.deleteMany({ where: { userId } });
      // Every family has ended, so its consumed rows are only triggers.
      await tx.consumedRefreshToken.deleteMany({ where: { userId } });
    });

    // A privileged action on the account, which the OWASP logging cheat sheet
    // asks to be recorded. The id and never the address.
    this.logger.log({
      msg: 'password changed',
      event: 'users.password-changed',
      userId,
    });

    await this.mailer.sendPasswordChanged(user.email);
  }
}
