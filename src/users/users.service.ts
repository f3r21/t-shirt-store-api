import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { MAILER, type Mailer } from '../mail/mailer';
import { ProblemException } from '../common/problem/problem.exception';
import { ProblemType } from '../common/problem/problem-type';
import { CreateUserDto } from './dto/create-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UserDto } from './dto/user.dto';
import { toUserDto } from './user.mapper';

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

  /**
   * Create a client account. See `openapi.yaml:378`.
   *
   * The request does not accept a role. Every account this operation creates is
   * a client account, so the role comes from the `roles` table and never from
   * the body.
   *
   * A registered address returns 409 with the `email-taken` type. This method
   * reads the address first. The alternative is to catch `P2002`, which is free
   * of a race and reads worse.
   */
  async createUser(dto: CreateUserDto): Promise<UserDto> {
    const taken = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (taken !== null) {
      throw new ProblemException(ProblemType.EmailTaken, 'Conflict', 409);
    }

    const role = await this.prisma.role.findUnique({
      where: { name: 'client' },
    });
    if (role === null) {
      throw new Error('The roles table holds no client role. Run the seed.');
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await argon2.hash(dto.password),
        firstName: dto.firstName,
        lastName: dto.lastName,
        roleId: role.id,
      },
      include: { role: true },
    });

    return toUserDto(user);
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
   * `argon2.verify` takes the digest first and the plain text second. That is
   * the opposite order of `bcrypt.compare`, and the wrong order returns false
   * for every password.
   */
  async changePassword(userId: number, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user === null) {
      throw new ProblemException(
        ProblemType.InvalidCredentials,
        'Unauthorized',
        401,
      );
    }

    const matches = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!matches) {
      throw new ProblemException(
        ProblemType.InvalidCredentials,
        'Unauthorized',
        401,
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(dto.newPassword) },
    });

    await this.prisma.refreshToken.deleteMany({ where: { userId } });

    await this.mailer.sendPasswordChanged(user.email);
  }
}
