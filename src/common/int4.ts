/**
 * The bounds of a Postgres `integer`, which every id, price and stock column
 * is. A value outside them is refused with `P2020`, which nothing maps, so the
 * bound belongs on the way in.
 */
export const INT4_MAX = 2_147_483_647;

export const INT4_MIN = -2_147_483_648;
