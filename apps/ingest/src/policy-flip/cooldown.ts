// 7-day cooldown enforcement for D20 Tier-C admin flips.
//
// The clock floor is `policies.tier_c_activated_at`: a row that has never been
// activated (NULL) skips the check; a row activated less than 7 days ago
// rejects with COOLDOWN_NOT_ELAPSED. The window measures wall-clock time, not
// signed-config issuance time — a flipper cannot stockpile signatures and
// burn them within the cooldown.
//
// Per CLAUDE.md §Security Rules (D20):
//   "Admin flips tenant-wide full-prompt mode with signed Ed25519 config +
//    7-day cooldown + IC banner."

export const COOLDOWN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface CooldownCheck {
  elapsed: boolean;
  /** Milliseconds remaining until the next allowed flip. 0 when elapsed. */
  remainingMs: number;
  /** When the previous flip happened; null if there has been none. */
  previousActivationAt: Date | null;
}

export function checkCooldown(
  previousActivationAt: Date | null,
  now: Date,
  windowMs: number = COOLDOWN_WINDOW_MS,
): CooldownCheck {
  if (previousActivationAt === null) {
    return { elapsed: true, remainingMs: 0, previousActivationAt: null };
  }
  const elapsedMs = now.getTime() - previousActivationAt.getTime();
  if (elapsedMs >= windowMs) {
    return { elapsed: true, remainingMs: 0, previousActivationAt };
  }
  return {
    elapsed: false,
    remainingMs: windowMs - elapsedMs,
    previousActivationAt,
  };
}
