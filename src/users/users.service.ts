import { Inject, Injectable } from '@nestjs/common';
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
 * The two operations under /users.
 *
 * `MAILER` is an injection token and not a class, because `Mailer` is a
 * TypeScript interface and Nest cannot resolve a type that carries no runtime
 * value.
 */
@Injectable()
export class UsersService {
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
   * Create a client account. See `openapi.yaml:378`.
   *
   * The request does not accept a role. Every account this operation creates is
   * a client account, so the role comes from the `roles` table and never from
   * the body.
   *
   * A registered address returns 409 with the `email-taken` type. The read is
   * the common path and reads better, and the catch is what makes it correct:
   * two simultaneous sign-ups both pass the read, and the loser hits the unique
   * index. Without the catch that loser falls through to the generic `P2002`
   * branch, which answers a bare 409 carrying no type, and the contract says a
   * client branches on the type and on nothing else.
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
   * Replace the password of the signed-in user. See `openapi.yaml:450`.
   *
   * A wrong current password returns 401. It is an authentication failure and
   * not a permissions failure.
   *
   * The method deletes every refresh row for this user, including the row of
   * the device that sent this request. Every device must sign in again.
   *
   * The method also clears any live password reset token. A user who reacts to
   * an unexpected reset mail by changing their own password would otherwise
   * leave the attacker's link working for the rest of its window.
   *
   * `argon2.verify` takes the digest first and the plain text second, which is
   * the opposite order of `bcrypt.compare`. The wrong order does not return
   * false, it throws `TypeError: pchstr must contain a $ as first char`, because
   * the first argument goes straight into the PHC parser before any comparison.
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

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await argon2.hash(dto.newPassword),
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
    });

    await this.prisma.refreshToken.deleteMany({ where: { userId } });

    await this.mailer.sendPasswordChanged(user.email);
  }
}
