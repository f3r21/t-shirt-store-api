import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import type { AccessTokenPayload } from '../auth/access-token-payload';
import { isManager, visibleProductWhere } from '../products/product-visibility';
import { CART_LINE_INCLUDE } from '../cart/cart.mapper';
import { insufficientStock } from '../common/problem/insufficient-stock';
import { ProblemException } from '../common/problem/problem.exception';
import { ProblemType } from '../common/problem/problem-type';
import { PageMetaDto } from '../common/dto/page-meta.dto';
import { OrderDto } from './dto/order.dto';
import { OrderSummaryDto } from './dto/order-summary.dto';
import { OrderHistoryQueryDto } from './dto/order-history-query.dto';
import { ListAllOrdersQueryDto } from './dto/list-all-orders-query.dto';
import { SetOrderStatusDto } from './dto/set-order-status.dto';
import { nextStatus } from './order-status';
import {
  ORDER_DETAIL_INCLUDE,
  ORDER_SUMMARY_INCLUDE,
  toOrderDto,
  toOrderSummaryDto,
} from './order.mapper';

/**
 * Orders: placed from the cart, moved through the status flow, and read back
 * as one order or as a filtered page. See `openapi.yaml:1375-1586`.
 *
 * **Ownership is in the `where`, not in an `if`.** A client's reads and
 * writes resolve the order with `userId` fixed to the caller, so another
 * client's order and a missing order are the same 404 and no branch can leak
 * that an id exists. A manager resolves without it. The contract asks for
 * exactly this: 404 and not 403, because an integer id can be guessed.
 *
 * **Stock is read here and never written.** The contract says an unpaid order
 * reserves nothing and the stock falls when the payment webhook reports
 * success, so `createOrder` checks every line against the units on hand and
 * leaves the number alone. The webhook is the only writer of `paid` and of
 * the stock, which is the halfway seam `ARCHITECTURE.md` describes.
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

  /** Title and detail follow the contract's example at `openapi.yaml:2568-2574`. */
  private notCancellable(): ProblemException {
    return new ProblemException(
      ProblemType.OrderNotCancellable,
      'Order cannot be cancelled',
      HttpStatus.CONFLICT,
      'This order already shipped.',
    );
  }

  /** No problem `type`: the enum names none for this, and the status explains it. */
  private illegalMove(from: string, to: string): ConflictException {
    return new ConflictException({
      title: 'Conflict',
      detail: `An order in status ${from} cannot move to ${to}.`,
    });
  }

  /** A manager sees every order; anyone else, their own. */
  private ownedBy(viewer: AccessTokenPayload): Prisma.OrderWhereInput {
    return isManager(viewer) ? {} : { userId: viewer.sub };
  }

  /**
   * Place an order from the cart, and empty the cart, in one transaction.
   *
   * The order of the statements is the point. The lines are read through the
   * cart's own predicate, so a withdrawn product's line is not ordered
   * (DECISIONS 22). Then the lines are **deleted before the order is created**,
   * and the delete has to remove exactly the lines that were read: two
   * checkouts of one cart both read the lines, the second blocks on the
   * first's delete, finds nothing left, and rolls back instead of placing a
   * second order. A second delete then clears what the read did not show, so
   * the cart is empty as the contract promises. Only then is the order
   * written, with the four snapshots copied from what the read returned, so
   * the order records the price the check ran against.
   */
  async createOrder(viewer: AccessTokenPayload): Promise<OrderDto> {
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

      return tx.order.create({
        data: {
          userId,
          status: 'pending',
          subtotalCents,
          totalCents: subtotalCents,
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
        },
        include: ORDER_DETAIL_INCLUDE,
      });
    });

    return toOrderDto(row, viewer);
  }

  /** One order with its lines and history, or 404 under the ownership rule. */
  async getOrder(viewer: AccessTokenPayload, id: number): Promise<OrderDto> {
    const row = await this.prisma.order.findFirst({
      where: { id, ...this.ownedBy(viewer) },
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
   * Move an order to another status.
   *
   * The table decides (`order-status.ts`), and the write is conditional on the
   * status the table saw: `updateMany` with the old status in its `where`, so
   * a cancel and a ship racing on one order cannot both land, and the loser
   * reads 409 rather than overwriting a `shipped` with a `cancelled`. The
   * history row is written in the same transaction, then the order is read
   * back with it.
   */
  async setOrderStatus(
    viewer: AccessTokenPayload,
    id: number,
    dto: SetOrderStatusDto,
  ): Promise<OrderDto> {
    const order = await this.prisma.order.findFirst({
      where: { id, ...this.ownedBy(viewer) },
      select: { id: true, status: true },
    });
    if (order === null) {
      throw new NotFoundException();
    }

    const verdict = nextStatus(viewer.role, order.status, dto.status);
    if (verdict === 'forbidden') {
      throw new ForbiddenException();
    }
    if (verdict === 'not-cancellable') {
      throw this.notCancellable();
    }
    if (verdict === 'illegal') {
      throw this.illegalMove(order.status, dto.status);
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.order.updateMany({
        where: { id, status: order.status },
        data: { status: dto.status },
      });
      if (moved.count === 0) {
        throw this.orderChanged();
      }
      await tx.orderStatusChange.create({
        data: { orderId: id, status: dto.status },
      });
      return tx.order.findUniqueOrThrow({
        where: { id },
        include: ORDER_DETAIL_INCLUDE,
      });
    });

    return toOrderDto(row, viewer);
  }
}
