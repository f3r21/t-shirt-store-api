import { createPrismaAbilityFor } from '@casl/prisma';
import type { PrismaModel, PrismaQueryOf, Subjects } from '@casl/prisma';
import type { Prisma } from '../generated/prisma/client';
import type {
  CartItem,
  Category,
  Order,
  Product,
  ProductLike,
  ProductVariant,
  PromoCode,
  RefreshToken,
  User,
} from '../generated/prisma/client';

/**
 * CASL pointed at the generated client, the wrapper the package's README gives
 * for a custom output path, so a condition is checked against the real
 * `WhereInput`. `RefreshToken` is what the contract calls a session.
 */
export const createPrismaAbility = createPrismaAbilityFor<Prisma.TypeMap>();

export type PrismaQuery<T extends PrismaModel = PrismaModel> = PrismaQueryOf<
  Prisma.TypeMap,
  T
>;

export type AppSubjects = Subjects<{
  Product: Product;
  ProductVariant: ProductVariant;
  Category: Category;
  CartItem: CartItem;
  ProductLike: ProductLike;
  Order: Order;
  PromoCode: PromoCode;
  RefreshToken: RefreshToken;
  User: User;
}>;
