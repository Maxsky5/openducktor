import type { NotificationCue, NotificationSound } from "@openducktor/contracts";
import { notificationCueSounds } from "@/features/notifications/notification-sound";

export type SoundPickerOption<Value extends string> = {
  value: Value;
  label: string;
  previewCue: NotificationCue | null;
};

// One existing stored value represents each distinct sound in the picker.
const selectableCues = {
  success: "success",
  close: "droplet",
  open: "bloom",
  select: "tick",
  tap: "press",
  toggle: "toggle",
  error: "error",
  navigate: "page",
  loading: "loading",
  ready: "ready",
} satisfies Record<(typeof notificationCueSounds)[NotificationCue], NotificationCue>;

export const notificationCueOptions: SoundPickerOption<NotificationCue>[] = Object.entries(
  selectableCues,
).map(([sound, cue]) => ({
  value: cue,
  label: sound.charAt(0).toUpperCase() + sound.slice(1),
  previewCue: cue,
}));

export const resolveNotificationCuePickerValue = (cue: NotificationCue): NotificationCue =>
  selectableCues[notificationCueSounds[cue]];

export const createNotificationSoundOptions = (
  globalCue: NotificationCue,
): SoundPickerOption<NotificationSound>[] => [
  { value: "inherit", label: "Use global sound", previewCue: globalCue },
  { value: "none", label: "No sound", previewCue: null },
  ...notificationCueOptions,
];
