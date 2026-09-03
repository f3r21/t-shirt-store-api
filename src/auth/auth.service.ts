import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { MAILER, type Mailer } from '../mail/mailer';
import { ProblemException } from '../common/problem/problem.exception';
import { ProblemType } from '../common/problem/problem-type';
import { normalizeEmail } from '../common/email';
import { PageMetaDto } from '../common/dto/page-meta.dto';
import { PageQueryDto } from '../common/dto/page-query.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SessionDto } from './dto/session.dto';
import { SessionTokensDto } from './dto/session-tokens.dto';
import { toSessionDto } from './session.mapper';
import { toUserDto } from '../users/user.mapper';
import { generateToken, hashToken } from './token-hash';
import { EnvironmentVariables } from '../config/env.validation';
import { AccessTokenPayload } from './access-token-payload';
import { liveSessionWhere } from './live-session';

/** The lifetime of a reset link. ADR 9. */
const RESET_TOKEN_TTL_SECONDS = 30 * 60;

@Injectable()
export class AuthService {
  /**
   * The success events of the OWASP list; the problem filter writes the
   * failures. A line carries a user id, never an address or a token. ADR 21.
   */
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  private get pepper(): string {
    return this.config.getOrThrow<string>('REFRESH_TOKEN_PEPPER');
  }

  private invalidCredentials(): ProblemException {
    return new ProblemException(
      ProblemType.InvalidCredentials,
      'Invalid credentials',
      401,
      'The server did not accept this email and password.',
    );
  }

  /**
   * One document for every way a refresh token fails, so a caller cannot learn
   * whether a token it holds was ever real.
   */
  private refreshTokenUnknown(): ProblemException {
    return new ProblemException(
      ProblemType.RefreshTokenUnknown,
      'Refresh token unknown',
      401,
      'Sign in again. The server ended every session for this user.',
    );
  }

  private async issueAccessToken(
    userId: number,
    sessionId: number,
    role: string,
  ): Promise<string> {
    const payload: AccessTokenPayload = { sub: userId, sid: sessionId, role };
    return this.jwt.signAsync(payload);
  }

  private refreshExpiry(): Date {
    const ttl = this.config.getOrThrow<number>('JWT_REFRESH_TTL');
    return new Date(Date.now() + ttl * 1000);
  }

  /**
   * The two clauses that make a refresh row a live session. Shared with the
   * guard and the device list through `live-session.ts`, so the three cannot
   * drift; nothing deletes a dead row.
   */
  private liveSessionWhere(): {
    expiresAt: { gt: Date };
    createdAt: { gt: Date };
  } {
    return liveSessionWhere(
      this.config.getOrThrow<number>('REFRESH_ABSOLUTE_TTL_DAYS'),
    );
  }

  /**
   * A wrong address and a wrong password answer the same document in the same
   * time. The refresh row is created before the access token is signed,
   * because the token carries the session id.
   */
  async createSession(
    dto: CreateSessionDto,
  ): Promise<SessionTokensDto & { sessionId: number }> {
    const email = normalizeEmail(dto.email);

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });
    if (user === null) {
      // The same Argon2id work as the verify below, thrown away, so an unknown
      // address takes as long as a wrong password. Removing this call reopens
      // an enumeration leak that no test names.
      await argon2.hash(dto.password);
      throw this.invalidCredentials();
    }

    const matches = await argon2.verify(user.passwordHash, dto.password);
    if (!matches) {
      throw this.invalidCredentials();
    }

    const refreshToken = generateToken();
    const row = await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken, this.pepper),
        deviceName: dto.deviceName,
        expiresAt: this.refreshExpiry(),
      },
    });

    this.logger.log({
      msg: 'signed in',
      event: 'auth.signed-in',
      userId: user.id,
      sessionId: row.id,
    });

    return {
      accessToken: await this.issueAccessToken(user.id, row.id, user.role.name),
      refreshToken,
      user: toUserDto(user),
      sessionId: row.id,
    };
  }

  /**
   * Rotation is one conditional write, so one of two racing requests wins.
   * Zero rows asks two questions in order: rotated a moment ago by another tab
   * of the same session, or already used, which ends every session of the
   * user. ADR 2.
   */
  async refreshSession(dto: RefreshSessionDto): Promise<SessionTokensDto> {
    const presented = hashToken(dto.refreshToken, this.pepper);

    const nextToken = generateToken();
    const nextHash = hashToken(nextToken, this.pepper);

    const row =
      (await this.rotateLiveToken(presented, nextHash)) ??
      (await this.rotateSpentToken(presented, nextHash));

    if (row === null) {
      throw this.refreshTokenUnknown();
    }
    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      include: { role: true },
    });
    if (user === null) {
      throw this.refreshTokenUnknown();
    }

    return {
      // The family, not the row: on the grace path `row` is a child of an
      // existing family, and `row.id` names nothing the guard can find.
      accessToken: await this.issueAccessToken(
        user.id,
        this.familyOf(row),
        user.role.name,
      ),
      refreshToken: nextToken,
      user: toUserDto(user),
    };
  }

  /**
   * The rows of one device. A device is a family, and the founder carries
   * `familyId` null. ADR 2.
   */
  private familyWhere(familyId: number): {
    OR: [{ familyId: number }, { id: number; familyId: null }];
  } {
    return { OR: [{ familyId }, { id: familyId, familyId: null }] };
  }

  /** The family a row belongs to. Null means the row founded its own. */
  private familyOf(row: { id: number; familyId: number | null }): number {
    return row.familyId ?? row.id;
  }

  /**
   * Spend the live token. The rotation and the consumed row commit together:
   * as two statements a losing racer lands between them, finds no live row and
   * no record, and answers 401 to an honest tab.
   */
  private async rotateLiveToken(
    presented: string,
    nextHash: string,
  ): Promise<{ id: number; userId: number; familyId: number | null } | null> {
    return this.prisma.$transaction(async (tx) => {
      const rotated = await tx.refreshToken.updateManyAndReturn({
        where: {
          tokenHash: presented,
          ...this.liveSessionWhere(),
        },
        data: {
          tokenHash: nextHash,
          rotatedAt: new Date(),
          expiresAt: this.refreshExpiry(),
        },
      });
      if (rotated.length !== 1) {
        return null;
      }

      const row = rotated[0];
      await tx.consumedRefreshToken.create({
        data: {
          tokenHash: presented,
          familyId: this.familyOf(row),
          userId: row.userId,
        },
      });
      return row;
    });
  }

  /**
   * A token that was already spent. Never spent: 401 and nothing deleted.
   * Spent inside the grace window: an honest second tab, which gets a new row
   * in the same family, with the founder's `createdAt` so the absolute cap
   * belongs to the family. Spent outside it: theft, and every refresh row of
   * the user goes. ADR 2.
   */
  private async rotateSpentToken(
    presented: string,
    nextHash: string,
  ): Promise<{ id: number; userId: number; familyId: number | null } | null> {
    const capDays = this.config.getOrThrow<number>('REFRESH_ABSOLUTE_TTL_DAYS');
    const seconds = this.config.getOrThrow<number>('REFRESH_GRACE_SECONDS');

    // A hash spent longer ago than the absolute cap cannot be a replay of a
    // live session, so it reads as never spent. Without this bound one old
    // spent token could end the account again after every sign-in.
    const spent = await this.prisma.consumedRefreshToken.findFirst({
      where: {
        tokenHash: presented,
        consumedAt: { gt: new Date(Date.now() - capDays * 86400 * 1000) },
      },
    });
    if (spent === null) {
      return null;
    }

    // The window is measured on the database clock, which stamped
    // `consumed_at`. Comparing it with `Date.now()` compares two clocks.
    const [{ now }] = await this.prisma.$queryRaw<{ now: Date }[]>`
      SELECT NOW() AS now
    `;
    const within = spent.consumedAt.getTime() > now.getTime() - seconds * 1000;

    if (seconds <= 0 || !within) {
      // The consumed rows go with the refresh rows, or the same token wipes
      // the next sign-in too. One transaction, so a wipe cannot commit half.
      await this.prisma.$transaction([
        this.prisma.refreshToken.deleteMany({
          where: { userId: spent.userId },
        }),
        this.prisma.consumedRefreshToken.deleteMany({
          where: { userId: spent.userId },
        }),
      ]);
      return null;
    }

    const founder = await this.prisma.refreshToken.findFirst({
      where: {
        ...this.familyWhere(spent.familyId),
        ...this.liveSessionWhere(),
      },
      orderBy: { id: 'asc' },
    });
    if (founder === null) {
      return null;
    }

    // Unconditional: three honest tabs present the same token, and all three
    // deserve a working one. The bound is the window times the refresh tier,
    // ten rows per spent token at the defaults. ADR 2.
    return this.prisma.refreshToken.create({
      data: {
        userId: founder.userId,
        tokenHash: nextHash,
        deviceName: founder.deviceName,
        familyId: spent.familyId,
        createdAt: founder.createdAt,
        expiresAt: this.refreshExpiry(),
        rotatedAt: new Date(),
      },
    });
  }

  /**
   * The device list, one entry per family. `total` is counted before the page
   * is cut, and the order ends in `id` so a page under LIMIT is stable.
   */
  async listSessions(
    userId: number,
    query: PageQueryDto,
  ): Promise<{ data: SessionDto[]; meta: PageMetaDto }> {
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, ...this.liveSessionWhere() },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    // The grace path adds rows to an existing device, so rows are not devices.
    const newest = new Map<number, (typeof rows)[number]>();
    for (const row of rows) {
      const family = row.familyId ?? row.id;
      if (!newest.has(family)) {
        newest.set(family, row);
      }
    }
    const devices = [...newest.values()];

    // Grouped here and not in SQL: a founder names its family by its own id
    // with `family_id` null, so no GROUP BY can see it. The set is every live
    // row of one user, and small.
    return {
      data: devices
        .slice(query.offset, query.offset + query.limit)
        .map(toSessionDto),
      meta: { total: devices.length, limit: query.limit, offset: query.offset },
    };
  }

  /**
   * Sign this device out. The session id in the token names the family, and
   * the guard refuses the access token from the next request on.
   */
  async deleteCurrentSession(userId: number, sessionId: number): Promise<void> {
    // The whole family, and its consumed rows with it: a consumed row that
    // outlives its family is only a trigger for reuse detection against the
    // user's other devices.
    await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({
        where: { userId, ...this.familyWhere(sessionId) },
      }),
      this.prisma.consumedRefreshToken.deleteMany({
        where: { userId, familyId: sessionId },
      }),
    ]);
  }

  /**
   * Sign another device out. Another user's session id is 404 and never 403,
   * so a guessed id confirms nothing.
   */
  async deleteSession(userId: number, id: number): Promise<void> {
    // By family, as above. The 404 comes from the refresh row count.
    const [{ count }] = await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({
        where: { userId, ...this.familyWhere(id) },
      }),
      this.prisma.consumedRefreshToken.deleteMany({
        where: { userId, familyId: id },
      }),
    ]);
    if (count === 0) {
      throw new NotFoundException();
    }
  }

  /**
   * Ask for a reset link. The answer is the same for a known and an unknown
   * address, and only a known one gets mail. The two paths differ in time,
   * which the rate limit bounds and nothing closes (README, Known gaps). The
   * row stores a hash; the raw token exists only in the message.
   */
  async requestPasswordReset(dto: RequestPasswordResetDto): Promise<void> {
    const email = normalizeEmail(dto.email);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user === null) {
      return;
    }

    const token = generateToken();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash: hashToken(token, this.pepper),
        resetTokenExpiresAt: new Date(
          Date.now() + RESET_TOKEN_TTL_SECONDS * 1000,
        ),
      },
    });

    await this.mailer.sendPasswordReset(user.email, token);
  }

  /**
   * Set a new password with a reset token. An unknown or expired token is 422,
   * because the body is well formed. One conditional write makes the token
   * single use, and the password and the session wipe commit together or not
   * at all. The hash runs before the transaction opens, and the mail goes out
   * after it commits.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const presented = hashToken(dto.token, this.pepper);
    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateManyAndReturn({
        where: {
          resetTokenHash: presented,
          resetTokenExpiresAt: { gt: new Date() },
        },
        data: {
          passwordHash,
          resetTokenHash: null,
          resetTokenExpiresAt: null,
        },
      });

      if (updated.length !== 1) {
        throw new UnprocessableEntityException({
          title: 'Unprocessable content',
          detail: 'The reset token is unknown or expired.',
        });
      }

      const row = updated[0];
      await tx.refreshToken.deleteMany({ where: { userId: row.id } });
      // Every family has ended, so its consumed rows are only triggers.
      await tx.consumedRefreshToken.deleteMany({ where: { userId: row.id } });
      return row;
    });

    this.logger.log({
      msg: 'password reset',
      event: 'auth.password-reset',
      userId: user.id,
    });

    await this.mailer.sendPasswordChanged(user.email);
  }
}
