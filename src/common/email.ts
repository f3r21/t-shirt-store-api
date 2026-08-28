/**
 * The one form an address is stored and matched in.
 *
 * The column is plain text behind a case-sensitive unique index, so without this
 * `ana@example.com` and `ana@EXAMPLE.com` register as two accounts, and sign-in,
 * forgot-password and reset-password each look the address up by equality.
 *
 * The whole address is folded, not only the domain. RFC 5321 leaves the local
 * part case-sensitive, so this is a product decision rather than a standards one:
 * no mail provider a customer of this store is likely to use treats `Ana@` and
 * `ana@` as two people, and two accounts for one person is the worse failure. The
 * contract does not define email equivalence, so the choice is ours to make and
 * to record.
 *
 * The durable form of this rule is a unique index on `lower(email)`, so that a
 * second code path cannot reintroduce the gap. Until that migration exists this
 * function is the only writer, and every lookup goes through it.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
