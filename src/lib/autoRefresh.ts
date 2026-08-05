export interface AutoRefreshState {
  visible: boolean;
  requestInFlight: boolean;
  hasBounds: boolean;
  lastUpdatedAt: number | null;
  now: number;
  intervalMs: number;
}

export function shouldAutoRefresh({
  visible,
  requestInFlight,
  hasBounds,
  lastUpdatedAt,
  now,
  intervalMs,
}: AutoRefreshState): boolean {
  return visible &&
    !requestInFlight &&
    hasBounds &&
    (lastUpdatedAt === null || now - lastUpdatedAt >= intervalMs);
}
