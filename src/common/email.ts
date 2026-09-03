/**
 * The one form an address is stored and matched in. The column is `citext`,
 * so the database refuses a second capitalisation; this still trims and
 * folds, so one stored form exists. The whole address is folded. ADR 10.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
