import { formatElapsedShort } from "@/lib/relative-time";

export const formatCiRelativeTime = (timestamp: string, now = Date.now()): string => {
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return timestamp;
  }
  const elapsed = formatElapsedShort(now - timestampMs);
  return elapsed === "now" ? elapsed : `${elapsed} ago`;
};
