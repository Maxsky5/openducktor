import {
  NOTIFICATION_CUE_VALUES,
  type NotificationCue,
  type NotificationSound,
} from "@openducktor/contracts";

export type SoundPickerOption<Value extends string> = {
  value: Value;
  label: string;
  previewCue: NotificationCue | null;
};

const cueLabel = (cue: NotificationCue): string => cue.charAt(0).toUpperCase() + cue.slice(1);

export const notificationCueOptions: SoundPickerOption<NotificationCue>[] =
  NOTIFICATION_CUE_VALUES.map((cue) => ({
    value: cue,
    label: cueLabel(cue),
    previewCue: cue,
  }));

export const createNotificationSoundOptions = (
  globalCue: NotificationCue,
): SoundPickerOption<NotificationSound>[] => [
  { value: "inherit", label: "Use global sound", previewCue: globalCue },
  { value: "none", label: "No sound", previewCue: null },
  ...notificationCueOptions,
];
