import type { PureAbility } from '@casl/ability';
import type { AppSubjects, PrismaQuery } from './casl-prisma';

/**
 * The verbs the abilities speak.
 *
 * Five are CASL's own, and `manage` is its alias for every action: a rule
 * granting `manage` covers any check, and a check for `manage` passes only a
 * `manage` rule, which is what makes "view all orders" expressible for a
 * manager beside "read my orders" for a client. `cancel` and `pay` are the
 * brief's verbs for the two things a client does to an order that are not an
 * update, which is the manager's advance through the status flow.
 */
export const ACTIONS = [
  'manage',
  'create',
  'read',
  'update',
  'delete',
  'cancel',
  'pay',
] as const;

export type Action = (typeof ACTIONS)[number];

/** An ability whose conditions are Prisma where clauses on our own models. */
export type AppAbility = PureAbility<[Action, AppSubjects], PrismaQuery>;
