import type { NotificationCue, NotificationSound } from "@openducktor/contracts";
import type { SoundName } from "cuelume";

// Saved cue names remain valid even when Cuelume combines their sounds.
export const notificationCueSounds = {
  chime: "success",
  sparkle: "success",
  droplet: "close",
  bloom: "open",
  whisper: "select",
  tick: "select",
  press: "tap",
  release: "tap",
  toggle: "toggle",
  success: "success",
  error: "error",
  page: "navigate",
  loading: "loading",
  ready: "ready",
  pulse: "tap",
  scan: "select",
  arrival: "navigate",
} satisfies Record<NotificationCue, SoundName>;

export const resolveNotificationCue = (
  sound: NotificationSound,
  globalCue: NotificationCue,
): NotificationCue | null => {
  if (sound === "none") return null;
  if (sound === "inherit") return globalCue;
  return sound;
};
