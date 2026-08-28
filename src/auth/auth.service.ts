import {
  Inject,
  Injectable,
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

/**
 * A reset link is short-lived. The contract sets no window, so this is ours to
 * choose and to record: thirty minutes is long enough to walk to a laptop and
 * short enough that a link left in an inbox stops working the same hour.
 */
const RESET_TOKEN_TTL_SECONDS = 30 * 60;

@Injectable()
export class AuthService {
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
   * One rejection for every way a refresh token can fail.
   *
   * Unknown, expired, already used and past the absolute cap all answer with the
   * same document. A caller that could tell them apart would learn whether a
   * token it holds was ever real.
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
   * Sign in. See `openapi.yaml:88`.
   *
   * A wrong address and a wrong password produce the identical rejection. The
   * contract is explicit that the server does not say which of the two was
   * wrong, so the two paths must not differ in status, type, title or detail.
   *
   * The refresh row is created before the access token is signed, because the
   * token carries the session id and the row is where that id comes from.
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

    return {
      accessToken: await this.issueAccessToken(user.id, row.id, user.role.name),
      refreshToken,
      user: toUserDto(user),
      sessionId: row.id,
    };
  }

  /**
   * Rotate. See `openapi.yaml:227`.
   *
   * The rotation is one conditional write and never a read followed by a write.
   * PostgreSQL re-evaluates the WHERE clause after waiting on a concurrent
   * writer, so exactly one of two racing requests can match a given hash. A read
   * then a write would let both pass.
   *
   * The same statement carries the expiry and the absolute cap, so a token that
   * is expired or whose session has simply run long matches nothing and takes
   * the same path as one that was never real.
   *
   * Zero rows is not yet an error. It is the question "was this token already
   * used", and a hash found in `previous_token_hash` means the answer is yes,
   * which the contract answers by deleting every refresh row for that user.
   *
   * Known limit, deliberate: this fixes the lost update and does not fix the
   * two-tab false positive. Two honest tabs rotating in the same moment leave
   * the loser holding a hash that is now the previous one, so the loser trips
   * reuse detection and signs the account out everywhere. See DECISIONS.md.
   */
  async refreshSession(dto: RefreshSessionDto): Promise<SessionTokensDto> {
    const presented = hashToken(dto.refreshToken, this.pepper);
    const now = new Date();
    const capDays = this.config.getOrThrow<number>('REFRESH_ABSOLUTE_TTL_DAYS');
    const oldestAllowed = new Date(now.getTime() - capDays * 86400 * 1000);

    const nextToken = generateToken();
    const rotated = await this.prisma.refreshToken.updateManyAndReturn({
      where: {
        tokenHash: presented,
        expiresAt: { gt: now },
        createdAt: { gt: oldestAllowed },
      },
      data: {
        tokenHash: hashToken(nextToken, this.pepper),
        previousTokenHash: presented,
        expiresAt: this.refreshExpiry(),
      },
    });

    if (rotated.length !== 1) {
      await this.detectReuse(presented);
      throw this.refreshTokenUnknown();
    }

    const row = rotated[0];
    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      include: { role: true },
    });
    if (user === null) {
      throw this.refreshTokenUnknown();
    }

    return {
      accessToken: await this.issueAccessToken(user.id, row.id, user.role.name),
      refreshToken: nextToken,
      user: toUserDto(user),
    };
  }

  /**
   * A token presented twice means the server is holding a stolen one.
   *
   * The contract's response is to end every session for that user rather than
   * only the one that was replayed, because the server cannot tell which of the
   * two holders is the owner.
   *
   * Known gap, and the contract does not grant it. `previous_token_hash` is one
   * column that every rotation overwrites, so only the immediately preceding
   * token is recognised. Replay a token from two or more rotations ago and it
   * matches neither `token_hash` nor `previous_token_hash`, so nothing is
   * revoked and every session survives. The contract says the server deletes
   * every refresh row when it receives an already-used token, with no carve-out
   * for how old that token is. Closing it needs a row per consumed hash, or a
   * family id on the session. See DECISIONS.md item 3.
   */
  private async detectReuse(presentedHash: string): Promise<void> {
    const previous = await this.prisma.refreshToken.findFirst({
      where: { previousTokenHash: presentedHash },
    });
    if (previous === null) {
      return;
    }
    await this.prisma.refreshToken.deleteMany({
      where: { userId: previous.userId },
    });
  }

  /**
   * The device list. See `openapi.yaml:166`.
   *
   * `total` counts every row the filter matches, before limit and offset apply,
   * so it comes from its own count and not from the length of the page.
   *
   * The order ends in `id` on purpose. Two rows can share a microsecond, and
   * PostgreSQL returns an unpredictable subset under LIMIT when the order does
   * not pin the rows uniquely.
   */
  async listSessions(
    userId: number,
    query: PageQueryDto,
  ): Promise<{ data: SessionDto[]; meta: PageMetaDto }> {
    const where = { userId };

    const [rows, total] = await Promise.all([
      this.prisma.refreshToken.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.refreshToken.count({ where }),
    ]);

    return {
      data: rows.map(toSessionDto),
      meta: { total, limit: query.limit, offset: query.offset },
    };
  }

  /**
   * Sign this device out. See `openapi.yaml:196`.
   *
   * The session id comes from the access token, so the row this deletes is the
   * one belonging to the device that sent the request. Other devices stay signed
   * in. The access token itself stays valid until it expires.
   */
  async deleteCurrentSession(userId: number, sessionId: number): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { id: sessionId, userId },
    });
  }

  /**
   * Sign another device out. See `openapi.yaml:207`.
   *
   * A session id that belongs to another user answers 404 and never 403. The id
   * is a small integer a caller can guess, so a 403 would confirm that the row
   * exists. The `where` names both the id and the owner, so an id that is absent
   * and an id that belongs to somebody else take the same path.
   */
  async deleteSession(userId: number, id: number): Promise<void> {
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { id, userId },
    });
    if (count === 0) {
      throw new NotFoundException();
    }
  }

  /**
   * Ask for a reset link. See `openapi.yaml:281`.
   *
   * The server answers the same way whether or not the address has an account,
   * because a different answer would tell the caller which addresses are
   * registered. Only a registered address receives mail.
   *
   * Known limit, deliberate: the two paths still differ in how long they take,
   * since only one of them writes a row and sends a message. Closing that gap
   * means doing equivalent work on the unknown path, and the endpoint is rate
   * limited instead. Recorded rather than hidden.
   *
   * The row stores a hash. The raw token exists only in the message.
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
   * Set a new password with a reset token. See `openapi.yaml:320`.
   *
   * An unknown or expired token answers 422 and not 400, because the body is
   * well formed and the server rejects it on its content. It is also not 401:
   * this operation carries no credentials to reject.
   *
   * One conditional write again, for two reasons. It makes the token single use
   * against a concurrent second submission, and it avoids the shape where a
   * plain `update` on a missing row raises `P2025`, which this codebase maps to
   * 404 where the contract requires 422.
   *
   * Clearing the token in the same statement is what makes it single use.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const presented = hashToken(dto.token, this.pepper);

    const updated = await this.prisma.user.updateManyAndReturn({
      where: {
        resetTokenHash: presented,
        resetTokenExpiresAt: { gt: new Date() },
      },
      data: {
        passwordHash: await argon2.hash(dto.password),
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

    const user = updated[0];

    await this.prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    await this.mailer.sendPasswordChanged(user.email);
  }
}
