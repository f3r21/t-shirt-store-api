import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { PageMetaDto } from '../common/dto/page-meta.dto';
import { PageQueryDto } from '../common/dto/page-query.dto';
import { CreatePromoCodeDto } from './dto/create-promo-code.dto';
import { UpdatePromoCodeDto } from './dto/update-promo-code.dto';
import { PromoCodeDto } from './dto/promo-code.dto';
import { toPromoCodeDto } from './promo-code.mapper';

/**
 * The manager's three promo code operations, Optional Feature 13. Applying a
 * code at checkout is `OrdersService`'s, inside its transaction (ADR 37). The
 * rules and the arithmetic it applies are in `promo-code-rules.ts`, beside
 * this file.
 */
@Injectable()
export class PromoCodesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A code another row already holds. No problem type: the enum names none,
   * and the status explains it.
   */
  private codeTaken(): ConflictException {
    return new ConflictException({
      title: 'Conflict',
      detail: 'Another promo code already uses this code.',
    });
  }

  /**
   * The unique index on `code` is the arbiter rather than a pre-read, so two
   * simultaneous creates cannot both pass. The column is `citext`, so the
   * index sees `SAVE10` and `save10` as one code and this branch answers both.
   */
  private isCodeTaken(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    );
  }

  /** Create a code. It starts enabled and unused, from the column defaults. */
  async createPromoCode(dto: CreatePromoCodeDto): Promise<PromoCodeDto> {
    try {
      const row = await this.prisma.promoCode.create({
        data: {
          code: dto.code,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          expiresAt: this.toInstant(dto.expiresAt),
          usageLimit: dto.usageLimit,
          minPurchaseCents: dto.minPurchase,
        },
      });
      return toPromoCodeDto(row);
    } catch (err) {
      if (this.isCodeTaken(err)) {
        throw this.codeTaken();
      }
      throw err;
    }
  }

  /**
   * One page of codes, newest first. No filter: a disabled code and an expired
   * one stay in the list, because a manager reads this list to find them.
   */
  async listPromoCodes(
    query: PageQueryDto,
  ): Promise<{ data: PromoCodeDto[]; meta: PageMetaDto }> {
    const [rows, total] = await Promise.all([
      this.prisma.promoCode.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.promoCode.count(),
    ]);

    return {
      data: rows.map(toPromoCodeDto),
      meta: { total, limit: query.limit, offset: query.offset },
    };
  }

  /**
   * Update a code. `isActive` is the disable and enable switch the brief asks
   * for; `usedCount` is not in the body, so this cannot rewrite the counter.
   */
  async updatePromoCode(
    id: number,
    dto: UpdatePromoCodeDto,
  ): Promise<PromoCodeDto> {
    // Resolved first, so an unknown id is the 404 the contract declares rather
    // than Prisma's `P2025` on the update, which nothing maps.
    const existing = await this.prisma.promoCode.findUnique({
      where: { id },
      select: { id: true },
    });
    if (existing === null) {
      throw new NotFoundException();
    }

    try {
      const row = await this.prisma.promoCode.update({
        where: { id },
        data: {
          code: dto.code,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          expiresAt: this.toInstant(dto.expiresAt),
          usageLimit: dto.usageLimit,
          minPurchaseCents: dto.minPurchase,
          isActive: dto.isActive,
        },
      });
      return toPromoCodeDto(row);
    } catch (err) {
      if (this.isCodeTaken(err)) {
        throw this.codeTaken();
      }
      throw err;
    }
  }

  /**
   * The ISO 8601 string the DTO validated, as the `Date` the column takes.
   * Absent stays absent, which Prisma reads as "not provided"; `null` would
   * clear the column, and no body can send one.
   */
  private toInstant(value: string | undefined): Date | undefined {
    return value === undefined ? undefined : new Date(value);
  }
}
