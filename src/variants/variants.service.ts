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

@Injectable()
export class VariantsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A size and colour pair the product already has.
   *
   * No problem `type`. The enum is closed and carries no member for a duplicate
   * variant, and the contract makes `type` optional precisely so a failure the
   * status code already explains does not have to invent one.
   */
  private pairTaken(): ConflictException {
    return new ConflictException({
      title: 'Conflict',
      detail: 'This product already has a variant with this size and color.',
    });
  }

  /**
   * Resolve the parent product, or 404.
   *
   * `isActive` is deliberately not filtered. Every operation here is
   * manager-only, and a manager works on a disabled product: disabling is how
   * you take something off sale while you fix it. Deleted is filtered, because
   * deleted is 404 for everyone.
   *
   * Without this read a bad id reaches the insert and raises a foreign key
   * violation, which nothing maps, so the caller would read 500.
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
   * Update a variant. Never its stock.
   *
   * `UpdateVariantDto` declares no stock field, and that is the enforcement:
   * stock has its own operation because it moves for reasons that have nothing
   * to do with editing a product, and the pipe rejects an unknown property.
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
   * Delete a variant outright.
   *
   * A hard delete, unlike a product. Nothing points at a variant yet.
   *
   * TODO, week 4: the contract also declares a 409 here, for a variant that
   * appears on an order. Order items do not exist this week, so that branch has
   * nothing to check and is deliberately absent rather than faked.
   */
  async deleteVariant(id: number): Promise<void> {
    await this.findVariantOr404(id);
    await this.prisma.productVariant.delete({ where: { id } });
  }

  /**
   * Set the units on hand.
   *
   * An absolute value and not a delta, because the caller is a person doing a
   * stock count. The DTO bounds it at zero, so the column cannot go negative
   * through this path.
   */
  async setVariantStock(
    id: number,
    dto: SetVariantStockDto,
  ): Promise<ProductVariantDto> {
    await this.findVariantOr404(id);

    const row = await this.prisma.productVariant.update({
      where: { id },
      data: { stock: dto.stock },
    });
    return toProductVariantDto(row);
  }
}
