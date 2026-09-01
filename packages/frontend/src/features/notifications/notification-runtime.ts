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
  createShellOsNotificationAdapter,
  type createCuelumeNotificationSoundAdapter,
  type createSonnerNotificationAdapter,
} from "./notification-delivery";
import { prepareNotificationOccurrence } from "./notification-occurrence";
import { createNotificationPolicy, type NotificationDispatchFailure } from "./notification-policy";

export const createNotificationRuntime = ({
  bridge,
  loadSettings,
  navigate,
  onFailure,
  onOsShown = () => {},
  inApp,
  sound,
}: {
  bridge: NotificationBridge;
  loadSettings(): Promise<NotificationSettings>;
  navigate(target: NotificationNavigationTarget): Promise<void>;
  onFailure(failure: NotificationDispatchFailure): void;
  onOsShown?: () => void;
  inApp: ReturnType<typeof createSonnerNotificationAdapter>;
  sound: ReturnType<typeof createCuelumeNotificationSoundAdapter>;
}) => {
  const os = createShellOsNotificationAdapter(bridge, onOsShown);
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

  const reportCoordinationFailure = (occurrence: NotificationOccurrence, cause: unknown): void => {
    const message = cause instanceof Error ? cause.message : String(cause);
    onFailure({
      channel: "coordination",
      kind: occurrence.kind,
      occurrenceId: occurrence.occurrenceId,
      repoPath: occurrence.repoPath,
      message: message.slice(0, 500),
    });
  };

  const dispatch = async (
    rawOccurrence: NotificationOccurrence,
    suppliedSettings?: NotificationSettings,
  ): Promise<void> => {
    const occurrence = notificationOccurrenceSchema.parse(rawOccurrence);
    const settings = await policy.loadSettingsSnapshot(occurrence, suppliedSettings);
    if (!settings) return;
    const externalPlan = await policy.dispatch(occurrence, { phase: "local" });
    if (!externalPlan) return;
    try {
      await bridge.withExternalDeliveryOwnership(occurrence.occurrenceId, async (owner) => {
        if (!owner) return;
        let appFocused: boolean | undefined;
        if (externalPlan.requiresFocus) {
          try {
            appFocused = await bridge.isAppFocused();
          } catch (cause) {
            reportCoordinationFailure(occurrence, cause);
          }
        }
        await policy.dispatch(occurrence, { phase: "external", appFocused });
      });
    } catch (cause) {
      reportCoordinationFailure(occurrence, cause);
    }
  };

  return {
    dispatch,
    publish(rawOccurrence: NotificationOccurrence): void {
      const occurrence = notificationOccurrenceSchema.parse(
        prepareNotificationOccurrence(rawOccurrence),
      );
      void policy.loadSettingsSnapshot(occurrence).then((settings) => {
        if (!settings) return;
        bridge.publishOccurrence(occurrence, settings);
        return dispatch(occurrence, settings);
      });
    },
    subscribe(): () => void {
      const stopOccurrences = bridge.subscribeOccurrences((occurrence, settings) => {
        void dispatch(occurrence, settings);
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
