import type {
  NotificationCue,
  NotificationDeliveryResult,
  NotificationOccurrence,
} from "@openducktor/contracts";
import type { NotificationBridge } from "../platform/notification-bridge";
import type { NotificationCopy } from "./notification-copy";

/** Shows an occurrence inside the app. The platform owns its presentation. */
export type InAppNotificationAdapter = {
  dismiss(occurrenceId: string): void;
  deliver(copy: NotificationCopy, occurrence: NotificationOccurrence): Promise<void>;
};

/** Plays a notification cue. The platform owns the sound. */
export type SoundNotificationAdapter = {
  play(cue: NotificationCue, volumePercent: number): Promise<void>;
};

/** Shows an occurrence as an operating system notification. */
export type OsNotificationAdapter = {
  deliver(
    copy: NotificationCopy,
    occurrence: NotificationOccurrence,
  ): Promise<NotificationDeliveryResult>;
};

export const createShellOsNotificationAdapter = (
  bridge: NotificationBridge,
  onShown: () => void = () => {},
): OsNotificationAdapter => ({
  async deliver(
    copy: NotificationCopy,
    occurrence: NotificationOccurrence,
  ): Promise<NotificationDeliveryResult> {
    const result = await bridge.showOsNotification({
      occurrenceId: occurrence.occurrenceId,
      title: copy.title,
      body: copy.body,
      silent: true,
      navigationTarget: occurrence.navigationTarget,
    });
    if (result.status === "shown") onShown();
    return result;
  },
});
