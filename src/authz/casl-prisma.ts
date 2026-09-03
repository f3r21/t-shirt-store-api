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
  RefreshToken,
  User,
} from '../generated/prisma/client';

/**
 * CASL pointed at the generated client.
 *
 * `@casl/prisma`'s default entry reads its types from `@prisma/client`, which
 * the Prisma 7 `prisma-client` generator no longer fills: the client lives
 * under `src/generated`. This is the wrapper the package's README gives for
 * that layout, "Custom PrismaClient output path (Prisma 7 default)": the
 * ability factory and the condition type are built from our own
 * `Prisma.TypeMap`, so a condition is checked against the real `WhereInput`
 * of the model it names, and `accessibleBy` produces one.
 *
 * `RefreshToken` is what the contract calls a session; the subject keeps the
 * model's name so `accessibleBy` can map it.
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
  RefreshToken: RefreshToken;
  User: User;
}>;
