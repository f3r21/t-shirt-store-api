import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem/problem.exception';
import { ProblemType } from '../common/problem/problem-type';
import { visibleProductWhere } from '../products/product-visibility';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { SetCartItemDto } from './dto/set-cart-item.dto';
import { CartDto } from './dto/cart.dto';
import { CART_LINE_INCLUDE, toCartDto } from './cart.mapper';

/**
 * The cart of the signed-in user, five operations over `cart_items`.
 *
 * There is no cart row. The table is keyed on the user and the variant, so
 * "the cart exists because the user exists" is a fact about that key, and an
 * empty result is an empty cart rather than a 404. `schema.prisma` records why.
 *
 * **What a cart shows.** Only lines whose product is on sale, through the same
 * predicate the catalog reads with, `visibleProductWhere` for an anonymous
 * viewer. A line for a product since disabled or deleted leaves the view, and
 * `clearCart` removes the row. The add and set paths resolve the variant through
 * the same predicate, so the 404 for a withdrawn product and the vanished line
 * are one rule. DECISIONS 22.
 *
 * **The stock check is a courtesy, not the guarantee.** Both writes compare
 * the resulting quantity with the units on hand before they write, so a 409
 * leaves the cart unchanged, as the contract promises. Two adds racing past
 * the stock are accepted: the contract says the checkout validates every line
 * again and an unpaid order reserves nothing, so the cart is a live view and
 * the order is where the number has to be right.
 */
@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The resulting quantity is above the units on hand. Title and detail follow
   * the contract's own example at `openapi.yaml:2561-2567`.
   */
  private insufficientStock(stock: number, asked: number): ProblemException {
    return new ProblemException(
      ProblemType.InsufficientStock,
      'Not enough stock',
      HttpStatus.CONFLICT,
      `This variant has ${stock} units on hand and the request asks for ${asked}.`,
    );
  }

  /** Resolve a variant whose product is on sale, or 404. */
  private async findSellableVariantOr404(id: number) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id, product: visibleProductWhere(undefined) },
    });
    if (variant === null) {
      throw new NotFoundException();
    }
    return variant;
  }

  /** Create the line or replace its quantity. One statement, on the key. */
  private async upsertLine(
    userId: number,
    variantId: number,
    quantity: number,
  ): Promise<void> {
    await this.prisma.cartItem.upsert({
      where: { userId_variantId: { userId, variantId } },
      create: { userId, variantId, quantity },
      update: { quantity },
    });
  }

  /**
   * The cart, now. Every mutation answers through this one read, so the four
   * responses cannot drift from each other.
   *
   * Ordered by when the line was added, then by variant as the tiebreak, which
   * is the order a user would not find arbitrary. The schema comment on
   * `createdAt` is the reason that column exists.
   */
  async getCart(userId: number): Promise<CartDto> {
    const rows = await this.prisma.cartItem.findMany({
      where: { userId, variant: { product: visibleProductWhere(undefined) } },
      orderBy: [{ createdAt: 'asc' }, { variantId: 'asc' }],
      include: CART_LINE_INCLUDE,
    });
    return toCartDto(rows);
  }

  /** Remove every line. Idempotent: an empty cart is emptied again. */
  async clearCart(userId: number): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { userId } });
  }

  /**
   * Add a quantity to a line, creating it when absent.
   *
   * The quantity in the body is an amount to add and not the amount wanted,
   * so the existing line is read first and the sum is what the stock check
   * sees. A sum above the stock throws before the upsert, so the cart does not
   * change.
   */
  async addCartItem(userId: number, dto: AddCartItemDto): Promise<CartDto> {
    const variant = await this.findSellableVariantOr404(dto.variantId);

    const line = await this.prisma.cartItem.findUnique({
      where: { userId_variantId: { userId, variantId: variant.id } },
      select: { quantity: true },
    });
    const quantity = (line?.quantity ?? 0) + dto.quantity;
    if (quantity > variant.stock) {
      throw this.insufficientStock(variant.stock, quantity);
    }

    await this.upsertLine(userId, variant.id, quantity);
    return this.getCart(userId);
  }

  /**
   * Set the quantity of a line, creating it when absent.
   *
   * Absolute and idempotent: two identical calls leave the same quantity, so
   * a repeat on a slow connection cannot double the line.
   */
  async setCartItem(
    userId: number,
    variantId: number,
    dto: SetCartItemDto,
  ): Promise<CartDto> {
    const variant = await this.findSellableVariantOr404(variantId);
    if (dto.quantity > variant.stock) {
      throw this.insufficientStock(variant.stock, dto.quantity);
    }

    await this.upsertLine(userId, variant.id, dto.quantity);
    return this.getCart(userId);
  }

  /**
   * Remove a line. Idempotent: an absent line answers 204.
   *
   * The variant is resolved by id alone, with no visibility filter, because a
   * user must be able to remove a line for a product that was withdrawn after
   * they added it. A variant that does not exist at all is the contract's 404.
   */
  async deleteCartItem(userId: number, variantId: number): Promise<void> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true },
    });
    if (variant === null) {
      throw new NotFoundException();
    }

    await this.prisma.cartItem.deleteMany({ where: { userId, variantId } });
  }
}
