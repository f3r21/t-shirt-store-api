/**
 * The delivery person as a token payload, id 77.
 *
 * Here rather than beside `AS_CLIENT` and `AS_MANAGER` in
 * `products.fixtures.ts`, which is where the first two landed because the
 * catalog specs needed them first: two specs read this one, the ability
 * factory's and the orders service's, and neither is about products.
 */
export const AS_DELIVERY = { sub: 77, sid: 3, role: 'delivery_person' };
