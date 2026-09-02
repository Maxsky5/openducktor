import type {
  NotificationCue,
  NotificationDeliveryResult,
  NotificationNavigationTarget,
  NotificationOsCapability,
  NotificationSettings,
} from "@openducktor/contracts";
import { createContext, useContext } from "react";
import type { NotificationDispatchFailure } from "@/features/notifications/notification-policy";
import type { SessionStartNotificationPublisher } from "@/features/session-start/session-start-orchestration";
import type { TaskStreamNotificationSink } from "@/state/tasks/task-stream-controller";

export type NotificationNavigator = (target: NotificationNavigationTarget) => Promise<void>;

export type NotificationContextValue = {
  osFailure: NotificationDispatchFailure | null;
  getCapability(): Promise<NotificationOsCapability>;
  openSystemSettings(): Promise<void>;
  previewCue(cue: NotificationCue, volumePercent: number): Promise<void>;
  testInApp(settings: NotificationSettings): Promise<void>;
  testOs(settings: NotificationSettings): Promise<NotificationDeliveryResult>;
  registerNavigator(navigator: NotificationNavigator): () => void;
  sessionStartNotifications: SessionStartNotificationPublisher;
  taskStreamSink: TaskStreamNotificationSink;
};

export const NotificationContext = createContext<NotificationContextValue | null>(null);

export const useNotificationContext = (): NotificationContextValue => {
  const value = useContext(NotificationContext);
  if (!value) {
    throw new Error("useNotificationContext must be used inside NotificationProvider.");
  }
  return value;
};
