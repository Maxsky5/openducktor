import type { NotificationCue, NotificationSound } from "@openducktor/contracts";

export const resolveNotificationCue = (
  sound: NotificationSound,
  globalCue: NotificationCue,
): NotificationCue | null => {
  if (sound === "none") return null;
  if (sound === "inherit") return globalCue;
  return sound;
};
