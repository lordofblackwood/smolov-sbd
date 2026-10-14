/** An absolute timestamp continues to elapse while the app is closed. */
export function startRestTimer(seconds: number, now = Date.now()): number {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86_400) {
    throw new Error("Rest duration must be between 0 and 86400 seconds.");
  }
  if (!Number.isFinite(now) || now < 0)
    throw new Error("Invalid timer timestamp.");
  return now + Math.round(seconds * 1000);
}

export function timerRemaining(
  timerEnd: number | null,
  now = Date.now(),
): number {
  if (timerEnd === null) return 0;
  return Math.max(0, Math.ceil((timerEnd - now) / 1000));
}
