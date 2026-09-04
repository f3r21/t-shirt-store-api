import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import type { PromoCode as PromoCodeRow } from '../generated/prisma/client';
import type { AccessTokenPayload } from '../auth/access-token-payload';
import { accessibleBy } from '@casl/prisma';
import { subject } from '@casl/ability';
import type { AppAbility } from '../authz/ability';
import { visibleProductWhere } from '../products/product-visibility';
import { CART_LINE_INCLUDE } from '../cart/cart.mapper';
import { insufficientStock } from '../common/problem/insufficient-stock';
import { ProblemException } from '../common/problem/problem.exception';
import { ProblemType } from '../common/problem/problem-type';
import { PageMetaDto } from '../common/dto/page-meta.dto';
import { OrderDto } from './dto/order.dto';
import { OrderSummaryDto } from './dto/order-summary.dto';
import { OrderHistoryQueryDto } from './dto/order-history-query.dto';
import { ListAllOrdersQueryDto } from './dto/list-all-orders-query.dto';
import { ListDeliveriesQueryDto } from './dto/list-deliveries-query.dto';
import { SetOrderStatusDto } from './dto/set-order-status.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { nextStatus } from './order-status';
import {
  ORDER_DETAIL_INCLUDE,
  ORDER_SUMMARY_INCLUDE,
  toOrderDto,
  toOrderSummaryDto,
} from './order.mapper';

/**
 * Orders: placed from the cart, moved through the status flow, read back one
 * at a time or as a filtered page. Ownership is in the `where` the ability
 * gives, so another client's order is the same 404 as a missing one (ADR 25).
 * The webhook lowers stock; this service writes it in one place, giving the
 * units back when a paid order is cancelled (ADR 23). A promo code named at
 * checkout is read, counted and copied onto the order here (ADR 37).
 */
@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private cartEmpty(): ConflictException {
    return new ConflictException({
      title: 'Conflict',
      detail: 'The cart is empty.',
    });
  }

  /**
   * The cart lost a line between the read and the delete. Two checkouts of
   * one cart end here for the second one: it read the lines, blocked on the
   * first one's delete, then found nothing to delete.
   */
  private cartChanged(): ConflictException {
    return new ConflictException({
      title: 'Conflict',
      detail: 'The cart changed while the order was created. Read it again.',
    });
  }

  /** The order moved between the read and the write. Same shape, same cause. */
  private orderChanged(): ConflictException {
    return new ConflictException({
      title: 'Conflict',
      detail: 'The order changed while this request ran. Read it again.',
    });
  }

  /** Title and detail follow the contract's `order-not-cancellable` example. */
  private notCancellable(): ProblemException {
    return new ProblemException(
      ProblemType.OrderNotCancellable,
      'Order cannot be cancelled',
      HttpStatus.CONFLICT,
      'This order already shipped.',
    );
  }

  /**
   * The four refusals a promo code can meet, one per rule the brief lists.
   *
   * All four are 422 and not 400: the body is well formed and the server
   * refuses it on its content, which is the reading `assertAllExist` already
   * makes for a category id that names no row. Each carries its own type,
   * because a client shows a different message for each. ADR 37.
   */
  private promoUnknown(): ProblemException {
    return new ProblemException(
      ProblemType.PromoCodeUnknown,
      'Promo code unknown',
      HttpStatus.UNPROCESSABLE_ENTITY,
      'This promo code does not exist, or it is disabled.',
    );
  }

  private promoExpired(expiresAt: Date): ProblemException {
    return new ProblemException(
      ProblemType.PromoCodeExpired,
      'Promo code expired',
      HttpStatus.UNPROCESSABLE_ENTITY,
      `This promo code expired on ${expiresAt.toISOString()}.`,
    );
  }

  /**
   * One detail for both ways a code runs out, because the caller acts the same
   * on either: the count was already at the limit, or another checkout took
   * the last use while this one ran.
   */
  private promoExhausted(): ProblemException {
    return new ProblemException(
      ProblemType.PromoCodeExhausted,
      'Promo code exhausted',
      HttpStatus.UNPROCESSABLE_ENTITY,
      'This promo code reached its usage limit.',
    );
  }

  private promoBelowMinimum(
    minimum: number,
    subtotal: number,
  ): ProblemException {
    return new ProblemException(
      ProblemType.PromoCodeMinimum,
      'Order below the promo code minimum',
      HttpStatus.UNPROCESSABLE_ENTITY,
      `This promo code applies to a subtotal of ${minimum} or more, and this order is ${subtotal}.`,
    );
  }

  /** No problem `type`: the enum names none for this, and the status explains it. */
  private illegalMove(from: string, to: string): ConflictException {
    return new ConflictException({
      title: 'Conflict',
      detail: `An order in status ${from} cannot move to ${to}.`,
    });
  }

  /**
   * What a code takes off a subtotal, in minor units.
   *
   * A percentage rounds down, so a discount is never a fraction of a minor
   * unit and never more than the share the code names. A fixed amount stops at
   * the subtotal, so the total floors at 0 and no order is ever negative.
   * ADR 37.
   */
  private discountOf(code: PromoCodeRow, subtotalCents: number): number {
    return code.discountType === 'percentage'
      ? Math.floor((subtotalCents * code.discountValue) / 100)
      : Math.min(code.discountValue, subtotalCents);
  }

  /**
   * Apply a code to a subtotal inside the checkout transaction: the brief's
   * four rules, the discount, and the use counted.
   *
   * The three read-only rules answer first, so nothing is written for an order
   * that cannot be placed. The count is last and it is the guarded increment
   * of ADR 34: the limit this read saw goes into the `where`, so two checkouts
   * racing for the last use write once and the loser matches no row. A throw
   * anywhere here rolls the whole checkout back, the emptied cart included.
   */
  private async applyPromoCode(
    tx: Prisma.TransactionClient,
    code: string,
    subtotalCents: number,
  ): Promise<{
    promoCodeId: number;
    promoCode: string;
    discountCents: number;
  }> {
    // The column is `citext`, so the database compares without case and
    // `save10` finds the row a manager typed as `SAVE10`.
    const row = await tx.promoCode.findUnique({ where: { code } });
    if (row === null || !row.isActive) {
      throw this.promoUnknown();
    }
    if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) {
      throw this.promoExpired(row.expiresAt);
    }
    if (row.minPurchaseCents !== null && subtotalCents < row.minPurchaseCents) {
      throw this.promoBelowMinimum(row.minPurchaseCents, subtotalCents);
    }

    const counted = await tx.promoCode.updateMany({
      where:
        row.usageLimit === null
          ? { id: row.id }
          : { id: row.id, usedCount: { lt: row.usageLimit } },
      data: { usedCount: { increment: 1 } },
    });
    if (counted.count === 0) {
      throw this.promoExhausted();
    }

    return {
      promoCodeId: row.id,
      // The code as the store holds it and not as the caller typed it: the
      // order records which code was used, in the one spelling that names it.
      promoCode: row.code,
      discountCents: this.discountOf(row, subtotalCents),
    };
  }

  /** The rows the ability lets this caller read, as a where clause. */
  private readable(ability: AppAbility): Prisma.OrderWhereInput {
    return { AND: [accessibleBy(ability, 'read').Order] };
  }

  /**
   * The rows on this caller's delivery round, as a where clause.
   *
   * Narrower than `readable` and not a subset of it by accident: the read set
   * carries the caller's own purchases, and a courier who shops here must not
   * find their own parcel in their delivery history because a colleague
   * delivered it. ADR 36.
   */
  private deliverable(ability: AppAbility): Prisma.OrderWhereInput {
    return { AND: [accessibleBy(ability, 'deliver').Order] };
  }

  /**
   * Place an order from the cart and empty it, in one transaction. The lines
   * are deleted before the order is created, and the delete must remove
   * exactly the lines read: the second of two racing checkouts deletes
   * nothing and rolls back. The snapshots come from the rows the check saw.
   * ADR 22, ADR 23.
   */
  async createOrder(
    viewer: AccessTokenPayload,
    dto: CreateOrderDto,
  ): Promise<OrderDto> {
    const userId = viewer.sub;

    const row = await this.prisma.$transaction(async (tx) => {
      const lines = await tx.cartItem.findMany({
        where: { userId, variant: { product: visibleProductWhere(undefined) } },
        orderBy: [{ createdAt: 'asc' }, { variantId: 'asc' }],
        include: CART_LINE_INCLUDE,
      });
      if (lines.length === 0) {
        throw this.cartEmpty();
      }
      for (const line of lines) {
        if (line.quantity > line.variant.stock) {
          throw insufficientStock(line.variant.stock, line.quantity);
        }
      }

      const removed = await tx.cartItem.deleteMany({
        where: {
          userId,
          variantId: { in: lines.map((line) => line.variantId) },
        },
      });
      if (removed.count !== lines.length) {
        throw this.cartChanged();
      }
      await tx.cartItem.deleteMany({ where: { userId } });

      const subtotalCents = lines.reduce(
        (sum, line) => sum + line.variant.priceCents * line.quantity,
        0,
      );

      // The code, when the body names one: its rules, its discount and its
      // count, all inside this transaction and all after the subtotal, which
      // the minimum purchase rule compares against. ADR 37.
      const promo =
        dto.promoCode === undefined
          ? undefined
          : await this.applyPromoCode(tx, dto.promoCode, subtotalCents);
      const discountCents = promo?.discountCents ?? 0;

      // The unchecked input, for the reason `setOrderStatus` gives: the checked
      // one takes the two relations and this writes their foreign keys.
      const data: Prisma.OrderUncheckedCreateInput = {
        userId,
        status: 'pending',
        subtotalCents,
        discountCents,
        totalCents: subtotalCents - discountCents,
        items: {
          create: lines.map((line) => ({
            variantId: line.variantId,
            productId: line.variant.productId,
            productName: line.variant.product.name,
            size: line.variant.size,
            color: line.variant.color,
            unitPriceCents: line.variant.priceCents,
            quantity: line.quantity,
          })),
        },
        statusHistory: { create: { status: 'pending' } },
      };
      // Named only when there is a code, so an order without one carries two
      // columns the writer never mentioned rather than two explicit nulls.
      if (promo !== undefined) {
        data.promoCodeId = promo.promoCodeId;
        data.promoCode = promo.promoCode;
      }

      return tx.order.create({ data, include: ORDER_DETAIL_INCLUDE });
    });

    return toOrderDto(row, viewer);
  }

  /** One order with its lines and history, or 404 under the ownership rule. */
  async getOrder(
    viewer: AccessTokenPayload,
    ability: AppAbility,
    id: number,
  ): Promise<OrderDto> {
    const row = await this.prisma.order.findFirst({
      where: { id, ...this.readable(ability) },
      include: ORDER_DETAIL_INCLUDE,
    });
    if (row === null) {
      throw new NotFoundException();
    }
    return toOrderDto(row, viewer);
  }

  /** The caller's own history. The scope is fixed, the filters are theirs. */
  listMyOrders(
    viewer: AccessTokenPayload,
    query: OrderHistoryQueryDto,
  ): Promise<{ data: OrderSummaryDto[]; meta: PageMetaDto }> {
    return this.listOrders({ userId: viewer.sub }, query, viewer);
  }

  /** Every order, for a manager, narrowed to one client when asked. */
  listAllOrders(
    viewer: AccessTokenPayload,
    query: ListAllOrdersQueryDto,
  ): Promise<{ data: OrderSummaryDto[]; meta: PageMetaDto }> {
    const scope: Prisma.OrderWhereInput =
      query.userId === undefined ? {} : { userId: query.userId };
    return this.listOrders(scope, query, viewer);
  }

  /**
   * The orders on this caller's round: the shipped queue, or their history.
   *
   * The scope is the `deliver` ability and not the `read` one, so the two
   * rules that grant the verb do the narrowing: a delivery person sees every
   * shipped order and only the delivered ones they delivered themselves, and a
   * manager, whose `manage` is unconditional, sees both sets whole. The status
   * filter comes off the query the same way it does on the other two lists.
   * ADR 36.
   */
  listDeliveries(
    viewer: AccessTokenPayload,
    ability: AppAbility,
    query: ListDeliveriesQueryDto,
  ): Promise<{ data: OrderSummaryDto[]; meta: PageMetaDto }> {
    return this.listOrders(this.deliverable(ability), query, viewer);
  }

  /**
   * One page of orders under a scope, with the five filters applied.
   *
   * Newest first by `createdAt` then `id`, the order the two indexes on
   * `orders` serve with no sort step. `createdFrom` is inclusive and
   * `createdTo` exclusive, as the contract states, so one day is `gte` its
   * start and `lt` the next day's.
   */
  private async listOrders(
    scope: Prisma.OrderWhereInput,
    query: OrderHistoryQueryDto,
    viewer: AccessTokenPayload,
  ): Promise<{ data: OrderSummaryDto[]; meta: PageMetaDto }> {
    const where: Prisma.OrderWhereInput = { ...scope };
    if (query.status !== undefined) {
      where.status = query.status;
    }
    if (query.createdFrom !== undefined || query.createdTo !== undefined) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.createdFrom !== undefined) {
        createdAt.gte = new Date(query.createdFrom);
      }
      if (query.createdTo !== undefined) {
        createdAt.lt = new Date(query.createdTo);
      }
      where.createdAt = createdAt;
    }
    if (query.minTotal !== undefined || query.maxTotal !== undefined) {
      const totalCents: Prisma.IntFilter = {};
      if (query.minTotal !== undefined) {
        totalCents.gte = query.minTotal;
      }
      if (query.maxTotal !== undefined) {
        totalCents.lte = query.maxTotal;
      }
      where.totalCents = totalCents;
    }

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
        skip: query.offset,
        include: ORDER_SUMMARY_INCLUDE,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: rows.map((row) => toOrderSummaryDto(row, viewer)),
      meta: { total, limit: query.limit, offset: query.offset },
    };
  }

  /**
   * Move an order. The ability says who (403), `order-status.ts` says whether
   * the move is legal (409), and the write is conditional on the status the
   * table saw, with the history row in the same transaction. ADR 23, ADR 25.
   */
  async setOrderStatus(
    viewer: AccessTokenPayload,
    ability: AppAbility,
    id: number,
    dto: SetOrderStatusDto,
  ): Promise<OrderDto> {
    const order = await this.prisma.order.findFirst({
      where: { id, ...this.readable(ability) },
    });
    if (order === null) {
      throw new NotFoundException();
    }

    // Three verbs, one per kind of move: a client cancels, a delivery person
    // delivers, a manager advances. Asked against the row, so the conditions
    // on the rules (own, shipped) decide, and not the subject type. ADR 36.
    const verb =
      dto.status === 'cancelled'
        ? 'cancel'
        : dto.status === 'delivered'
          ? 'deliver'
          : 'update';
    if (!ability.can(verb, subject('Order', order))) {
      throw new ForbiddenException();
    }

    const verdict = nextStatus(order.status, dto.status);
    if (verdict === 'not-cancellable') {
      throw this.notCancellable();
    }
    if (verdict === 'illegal') {
      throw this.illegalMove(order.status, dto.status);
    }

    // Who delivered it, written with the status and not after it, so the row
    // never holds `delivered` with no deliverer. Only on this move: the column
    // says "delivered by", not "last touched by". The unchecked input, because
    // the checked one takes the relation and this writes the foreign key.
    const data: Prisma.OrderUncheckedUpdateManyInput =
      dto.status === 'delivered'
        ? { status: dto.status, deliveredById: viewer.sub }
        : { status: dto.status };

    const row = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.order.updateMany({
        where: { id, status: order.status },
        data,
      });
      if (moved.count === 0) {
        throw this.orderChanged();
      }
      await tx.orderStatusChange.create({
        data: { orderId: id, status: dto.status },
      });
      // The webhook took the units on `paid`. A cancel after that gives them
      // back, one atomic increment per line. A rise is never a low-stock
      // crossing, so the producer is not told.
      if (dto.status === 'cancelled' && order.status !== 'pending') {
        const lines = await tx.orderItem.findMany({
          where: { orderId: id },
          select: { variantId: true, quantity: true },
        });
        for (const line of lines) {
          await tx.productVariant.updateMany({
            where: { id: line.variantId },
            data: { stock: { increment: line.quantity } },
          });
        }
      }
      return tx.order.findUniqueOrThrow({
        where: { id },
        include: ORDER_DETAIL_INCLUDE,
      });
    });

    return toOrderDto(row, viewer);
  }
}
