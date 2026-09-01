/**
 * The two clauses that decide whether a refresh row is still a live session.
 *
 * **This lives in its own file because it now has three callers, and the third
 * one is the reason.** It began as a private method on `AuthService`, extracted
 * from the rotation so the device list could not drift from it, under a comment
 * saying that two places deciding the same thing must not drift.
 *
 * `AccessTokenGuard` then became the third place and drifted: it looked a
 * session up by owner and family and by nothing else, so a refresh row that had
 * expired, or whose session had run past the absolute cap, still authenticated
 * every protected route. `POST /auth/refresh` answered 401 for that same row
 * and `GET /auth/sessions` hid it, so the three readers disagreed about which
 * sessions exist.
 *
 * A private method cannot be shared, so sharing it meant copying it, and the
 * copy is what did not happen. A module-level function is the shape that makes
 * the fourth caller cheap and the fourth copy unnecessary.
 *
 * Nothing deletes a dead row. The window closes and the row stays, which is why
 * every reader has to carry this and why a reader that forgets it finds
 * something.
 */
export function liveSessionWhere(capDays: number): {
  expiresAt: { gt: Date };
  createdAt: { gt: Date };
} {
  const now = new Date();
  return {
    expiresAt: { gt: now },
    createdAt: { gt: new Date(now.getTime() - capDays * 86400 * 1000) },
  };
}
