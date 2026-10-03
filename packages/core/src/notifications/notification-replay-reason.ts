import type { NotificationCursor, NotificationStreamFrame } from "@openducktor/contracts";

export const notificationReplayReason = (
  requested: NotificationCursor | null,
  current: NotificationCursor,
  oldestSequence: number | undefined,
): Extract<NotificationStreamFrame, { type: "attached" }>["reason"] => {
  if (requested === null) return "new";
  if (requested.epoch !== current.epoch) return "epoch_changed";
  const first = oldestSequence ?? current.sequence + 1;
  // A cursor one step before the retained range can replay every retained frame.
  if (requested.sequence < first - 1 || requested.sequence > current.sequence) return "gap";
  return "replay";
};
