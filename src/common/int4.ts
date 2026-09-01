/**
 * The bounds of a Postgres `integer`.
 *
 * Every id, price and stock column in this schema is a Prisma `Int`, which is
 * `int4`. A value outside these bounds is not a row that does not exist. It is
 * a value the column cannot hold, so Postgres refuses the statement with
 * `P2020`, and nothing in this codebase maps that code, which leaves a 500.
 *
 * Measured against the live database before these constants existed:
 *
 *     stock = 2147483647   -> accepted
 *     stock = 2147483648   -> P2020, value out of range for type integer
 *
 * So the bound belongs on the way in. That is not the transport asserting
 * something the schema owns, which is the objection this file has to answer. It
 * is the transport refusing a value the schema has already declared it cannot
 * store.
 */
export const INT4_MAX = 2_147_483_647;

export const INT4_MIN = -2_147_483_648;
