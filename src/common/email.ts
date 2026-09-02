/**
 * The one form an address is stored and matched in.
 *
 * The column is `citext` since the `email_citext` migration, so the database
 * itself refuses `ana@example.com` beside `ana@EXAMPLE.com`, whoever writes the
 * row: this service, the seed, or a raw statement. `citext` compares without
 * regard to case and does nothing else. This function still trims and folds, so
 * one stored form exists: the address the mailer sends to and the one sign-in,
 * forgot-password and reset-password look up are the same string.
 *
 * The whole address is folded, not only the domain. RFC 5321 leaves the local
 * part case-sensitive, so this is a product decision rather than a standards one:
 * no mail provider a customer of this store is likely to use treats `Ana@` and
 * `ana@` as two people, and two accounts for one person is the worse failure. The
 * contract does not define email equivalence, so the choice is ours to make and
 * to record. DECISIONS 10 says why a column type and not an index carries it.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
