const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

export const formatCiRelativeTime = (timestamp: string, now = Date.now()): string => {
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return timestamp;
  }

  const elapsedMs = Math.max(0, now - timestampMs);
  if (elapsedMs < MINUTE_MS) {
    return "now";
  }
  if (elapsedMs < HOUR_MS) {
    return `${Math.floor(elapsedMs / MINUTE_MS)}m ago`;
  }
  if (elapsedMs < DAY_MS) {
    return `${Math.floor(elapsedMs / HOUR_MS)}h ago`;
  }
  if (elapsedMs < MONTH_MS) {
    return `${Math.floor(elapsedMs / DAY_MS)}d ago`;
  }
  if (elapsedMs < YEAR_MS) {
    return `${Math.floor(elapsedMs / MONTH_MS)}mo ago`;
  }
  return `${Math.floor(elapsedMs / YEAR_MS)}y ago`;
};
