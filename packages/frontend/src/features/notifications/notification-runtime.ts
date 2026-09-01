import {
  notificationSettingsSchema,
  notificationOccurrenceSchema,
  type NotificationCue,
  type NotificationDeliveryResult,
  type NotificationNavigationTarget,
  type NotificationOccurrence,
  type NotificationSettings,
} from "@openducktor/contracts";
import type { NotificationBridge } from "@/lib/shell-bridge";
import {
  createCuelumeNotificationSoundAdapter,
  createShellOsNotificationAdapter,
  createSonnerNotificationAdapter,
} from "./notification-delivery";
import { prepareNotificationOccurrence } from "./notification-occurrence";
import { createNotificationPolicy, type NotificationDispatchFailure } from "./notification-policy";

export const createNotificationRuntime = ({
  bridge,
  loadSettings,
  navigate,
  onFailure,
  onOsShown = () => {},
}: {
  bridge: NotificationBridge;
  loadSettings(): Promise<NotificationSettings>;
  navigate(target: NotificationNavigationTarget): Promise<void>;
  onFailure(failure: NotificationDispatchFailure): void;
  onOsShown?: () => void;
}) => {
  const inApp = createSonnerNotificationAdapter({ navigate });
  const os = createShellOsNotificationAdapter(bridge, onOsShown);
  const sound = createCuelumeNotificationSoundAdapter();
  const policy = createNotificationPolicy({
    loadSettings,
    inApp,
    os,
    sound,
    onFailure,
  });

  const testOccurrence: NotificationOccurrence = {
    occurrenceId: "notification-settings-test",
    kind: "agent.session_started",
    repoPath: "notification-settings-test",
    repositoryLabel: "OpenDucktor",
    sessionLabel: "Test session",
    status: "Notification settings test",
    navigationTarget: {
      type: "kanban_task",
      repoPath: "notification-settings-test",
      taskId: "notification-settings-test",
    },
  };

  const playConfiguredCue = async (
    settings: NotificationSettings,
    cue: NotificationCue = settings.globalCue,
  ): Promise<void> => {
    if (settings.volumePercent > 0) {
      await sound.play(cue, settings.volumePercent);
    }
  };

  const dispatch = async (rawOccurrence: NotificationOccurrence): Promise<void> => {
    const occurrence = notificationOccurrenceSchema.parse(rawOccurrence);
    try {
      await bridge.withExternalDeliveryOwnership(occurrence.occurrenceId, async (owner) => {
        const appFocused = await bridge.isAppFocused();
        await policy.dispatch(occurrence, {
          appFocused,
          externalDeliveryOwner: owner,
        });
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      onFailure({
        channel: "settings",
        kind: occurrence.kind,
        occurrenceId: occurrence.occurrenceId,
        repoPath: occurrence.repoPath,
        message: message.slice(0, 500),
      });
    }
  };

  return {
    dispatch,
    publish(rawOccurrence: NotificationOccurrence): void {
      const occurrence = notificationOccurrenceSchema.parse(
        prepareNotificationOccurrence(rawOccurrence),
      );
      bridge.publishOccurrence(occurrence);
      void dispatch(occurrence);
    },
    subscribe(): () => void {
      const stopOccurrences = bridge.subscribeOccurrences((occurrence) => {
        void dispatch(occurrence);
      });
      const stopClicks = bridge.subscribeClicks(({ navigationTarget }) => {
        void navigate(navigationTarget);
      });
      return () => {
        stopOccurrences();
        stopClicks();
      };
    },
    getCapability: () => bridge.getCapability(),
    previewCue(cue: NotificationCue, volumePercent: number): Promise<void> {
      return sound.play(cue, volumePercent);
    },
    async testInApp(rawSettings: NotificationSettings): Promise<void> {
      const settings = notificationSettingsSchema.parse(rawSettings);
      await inApp.deliver(
        { title: "Notifications are working", body: "This is an in-app notification test." },
        testOccurrence,
      );
      await playConfiguredCue(settings);
    },
    async testOs(rawSettings: NotificationSettings): Promise<NotificationDeliveryResult> {
      const settings = notificationSettingsSchema.parse(rawSettings);
      const capability = await bridge.requestPermission();
      if (!capability.supported) {
        return {
          status: "unsupported",
          message: capability.failureMessage ?? "OS notifications are not supported.",
        };
      }
      if (capability.permission === "denied") {
        return {
          status: "denied",
          message: capability.failureMessage ?? "OS notification permission was denied.",
        };
      }

      const result = await bridge.showOsNotification({
        occurrenceId: testOccurrence.occurrenceId,
        title: "Notifications are working",
        body: "This is an OS notification test.",
        silent: true,
        navigationTarget: testOccurrence.navigationTarget,
      });
      if (result.status === "shown") {
        onOsShown();
        await playConfiguredCue(settings);
      }
      return result;
    },
  };
};
