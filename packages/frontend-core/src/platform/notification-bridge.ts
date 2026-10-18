import type {
  NotificationClickEvent,
  NotificationDeliveryResult,
  NotificationOccurrence,
  NotificationOsCapability,
  NotificationOsDeliveryRequest,
  NotificationSettings,
} from "@openducktor/contracts";

/**
 * The notification system of this device. It also shares occurrences between the app windows on
 * this device. Only one window owns the external delivery of each occurrence.
 */
export type NotificationBridge = {
  getCapability(): Promise<NotificationOsCapability>;
  requestPermission(): Promise<NotificationOsCapability>;
  openSystemSettings(): Promise<void>;
  isAppFocused(): Promise<boolean>;
  withExternalDeliveryOwnership(
    occurrenceId: string,
    dispatch: (externalDeliveryOwner: boolean) => Promise<void>,
  ): Promise<void>;
  showOsNotification(request: NotificationOsDeliveryRequest): Promise<NotificationDeliveryResult>;
  publishOccurrence(
    occurrence: NotificationOccurrence,
    settings: NotificationSettings,
  ): Promise<{ occurrence: NotificationOccurrence; settings: NotificationSettings }>;
  subscribeOccurrences(
    listener: (occurrence: NotificationOccurrence, settings: NotificationSettings) => void,
  ): () => void;
  subscribeClicks(listener: (event: NotificationClickEvent) => void): () => void;
  dispose(): void;
};
