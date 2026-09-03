import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { NOT_DELETED } from '../products/product-visibility';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { SetVariantStockDto } from './dto/set-variant-stock.dto';
import { ProductVariantDto } from './dto/product-variant.dto';
import { toProductVariantDto, toStoredOption } from './variant.mapper';
import { LowStockProducer } from '../stock-notifications/low-stock.producer';

@Injectable()
export class VariantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lowStock: LowStockProducer,
  ) {}

  /**
   * A duplicate size and colour pair. No problem type: the enum names none,
   * and the status explains it.
   */
  private pairTaken(): ConflictException {
    return new ConflictException({
      title: 'Conflict',
      detail: 'This product already has a variant with this size and color.',
    });
  }

  /**
   * A variant an order line points at. The detail repeats the remedy the
   * contract's `deleteVariant` names.
   */
  private variantOrdered(): ConflictException {
    return new ConflictException({
      title: 'Conflict',
      detail:
        'This variant appears in an order. Set its stock to zero instead.',
    });
  }

  /** A count that raced another stock write. The remedy is to count again. */
  private stockChanged(): ConflictException {
    return new ConflictException({
      title: 'Conflict',
      detail:
        'The stock changed while you were counting. Read it and send the count again.',
    });
  }

  /**
   * The parent product, or 404. Disabled passes, because a manager works on a
   * disabled product; deleted is 404 for everyone. ADR 15.
   */
  private async assertProductExists(productId: number): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, ...NOT_DELETED },
      select: { id: true },
    });
    if (product === null) {
      throw new NotFoundException();
    }
  }

  /** Resolve a variant whose product is not deleted, or 404. */
  private async findVariantOr404(id: number) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id, product: { ...NOT_DELETED } },
    });
    if (variant === null) {
      throw new NotFoundException();
    }
    return variant;
  }

  async createVariant(
    productId: number,
    dto: CreateVariantDto,
  ): Promise<ProductVariantDto> {
    await this.assertProductExists(productId);

    try {
      const row = await this.prisma.productVariant.create({
        data: {
          productId,
          size: toStoredOption(dto.size),
          color: toStoredOption(dto.color),
          priceCents: dto.price,
          stock: dto.stock,
        },
      });
      return toProductVariantDto(row);
    } catch (err) {
      // The unique index is the arbiter rather than a pre-read, so two
      // simultaneous creates cannot both pass. Storing '' for an absent option
      // is what lets the index see a duplicate at all.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw this.pairTaken();
      }
      throw err;
    }
  }

  /**
   * Update a variant, never its stock: the DTO declares no stock field, and
   * the pipe rejects an unknown property.
   */
  async updateVariant(
    id: number,
    dto: UpdateVariantDto,
  ): Promise<ProductVariantDto> {
    await this.findVariantOr404(id);

    const data: Prisma.ProductVariantUpdateInput = {};
    if (dto.size !== undefined) {
      data.size = toStoredOption(dto.size);
    }
    if (dto.color !== undefined) {
      data.color = toStoredOption(dto.color);
    }
    if (dto.price !== undefined) {
      data.priceCents = dto.price;
    }

    try {
      const row = await this.prisma.productVariant.update({
        where: { id },
        data,
      });
      return toProductVariantDto(row);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw this.pairTaken();
      }
      throw err;
    }
  }

  /**
   * A hard delete, only while no order line points at it. The count gives
   * the contract's message; the catch of `P2003` covers an order placed
   * between the count and the delete. ADR 15.
   */
  async deleteVariant(id: number): Promise<void> {
    await this.findVariantOr404(id);

    const ordered = await this.prisma.orderItem.count({
      where: { variantId: id },
    });
    if (ordered > 0) {
      throw this.variantOrdered();
    }

    try {
      await this.prisma.productVariant.delete({ where: { id } });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw this.variantOrdered();
      }
      throw err;
    }
  }

  /**
   * Set the units on hand, an absolute value bounded at zero by the DTO. The
   * second stock writer, so the values before and after go to the low-stock
   * producer. The write carries the stock it read, so the pair is exact and a
   * count that raced another write is refused with 409. ADR 27, ADR 34.
   */
  async setVariantStock(
    id: number,
    dto: SetVariantStockDto,
  ): Promise<ProductVariantDto> {
    const current = await this.findVariantOr404(id);

    const written = await this.prisma.productVariant.updateMany({
      where: { id, stock: current.stock },
      data: { stock: dto.stock },
    });
    if (written.count === 0) {
      throw this.stockChanged();
    }
    await this.lowStock.notify([
      { variantId: id, before: current.stock, after: dto.stock },
    ]);
    const row = await this.prisma.productVariant.findUniqueOrThrow({
      where: { id },
    });
    return toProductVariantDto(row);
  }
}
