/**
 * The two clauses that make a refresh row a live session, shared by the
 * rotation, the device list and the guard so the three cannot drift. Nothing
 * deletes a dead row, so a reader that forgets this finds one.
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
