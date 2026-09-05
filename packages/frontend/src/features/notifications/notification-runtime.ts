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
import { boundNotificationOccurrenceId } from "./notification-occurrence-id";
import { prepareNotificationOccurrence } from "./notification-occurrence";
import { createNotificationPolicy, type NotificationDispatchFailure } from "./notification-policy";

type CoordinationFailurePhase = "publication" | "external_delivery";

export const createNotificationRuntime = ({
  bridge,
  loadSettings,
  navigate,
  onFailure,
  onCoordinationRecovered,
  onOsShown = () => {},
  onSettingsRecovered = () => {},
  inApp,
  sound,
}: {
  bridge: NotificationBridge;
  loadSettings(): Promise<NotificationSettings>;
  navigate(target: NotificationNavigationTarget): Promise<void>;
  onFailure(failure: NotificationDispatchFailure): void;
  onCoordinationRecovered(): void;
  onOsShown?: () => void;
  onSettingsRecovered?: () => void;
  inApp: ReturnType<typeof createSonnerNotificationAdapter>;
  sound: ReturnType<typeof createCuelumeNotificationSoundAdapter>;
}) => {
  const activeCoordinationFailures = new Set<CoordinationFailurePhase>();
  const os = createShellOsNotificationAdapter(bridge, onOsShown);
  const policy = createNotificationPolicy({
    loadSettings,
    inApp,
    os,
    sound,
    onFailure,
    onSettingsRecovered,
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

  const reportCoordinationFailure = (
    phase: CoordinationFailurePhase,
    occurrence: NotificationOccurrence,
    cause: unknown,
  ): void => {
    activeCoordinationFailures.add(phase);
    const message = cause instanceof Error ? cause.message : String(cause);
    onFailure({
      channel: "coordination",
      kind: occurrence.kind,
      occurrenceId: occurrence.occurrenceId,
      repoPath: occurrence.repoPath,
      message: message.slice(0, 500),
    });
  };

  const recoverCoordinationFailure = (phase: CoordinationFailurePhase): void => {
    if (!activeCoordinationFailures.delete(phase) || activeCoordinationFailures.size > 0) return;
    onCoordinationRecovered();
  };

  const dispatch = async (
    rawOccurrence: NotificationOccurrence,
    suppliedSettings: NotificationSettings,
  ): Promise<boolean> => {
    const occurrence = notificationOccurrenceSchema.parse(rawOccurrence);
    const localResult = await policy.dispatch(occurrence, { phase: "local" }, suppliedSettings);
    const externalPlan = localResult.externalPlan;
    if (!externalPlan) return localResult.inAppDelivered;
    let coordinationFailed = false;
    let coordinationCompleted = false;
    try {
      await bridge.withExternalDeliveryOwnership(occurrence.occurrenceId, async (owner) => {
        if (!owner) return;
        let appFocused: boolean | undefined;
        if (externalPlan.requiresFocus) {
          try {
            appFocused = await bridge.isAppFocused();
          } catch (cause) {
            coordinationFailed = true;
            reportCoordinationFailure("external_delivery", occurrence, cause);
          }
        }
        await policy.dispatch(occurrence, { phase: "external", appFocused }, suppliedSettings);
        coordinationCompleted = true;
      });
    } catch (cause) {
      coordinationFailed = true;
      reportCoordinationFailure("external_delivery", occurrence, cause);
    }
    if (coordinationCompleted && !coordinationFailed) {
      recoverCoordinationFailure("external_delivery");
    }
    return localResult.inAppDelivered;
  };

  const publishAndWait = async (rawOccurrence: NotificationOccurrence): Promise<boolean> => {
    let occurrence = rawOccurrence;
    try {
      occurrence = notificationOccurrenceSchema.parse({
        ...prepareNotificationOccurrence(rawOccurrence),
        occurrenceId: await boundNotificationOccurrenceId(rawOccurrence.occurrenceId),
      });
      const settings = await policy.loadSettingsCandidate(occurrence);
      if (!settings) return false;
      const selected = await bridge.publishOccurrence(occurrence, settings);
      recoverCoordinationFailure("publication");
      return await dispatch(selected.occurrence, selected.settings);
    } catch (cause) {
      reportCoordinationFailure("publication", occurrence, cause);
      return false;
    }
  };

  return {
    publish(rawOccurrence: NotificationOccurrence): void {
      void publishAndWait(rawOccurrence);
    },
    publishAndWait,
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
    openSystemSettings: () => bridge.openSystemSettings(),
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
