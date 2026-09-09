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
import {
  createNotificationPolicy,
  type NotificationDispatchFailure,
  type NotificationDispatchContext,
} from "./notification-policy";

type CoordinationFailurePhase = "publication" | "external_delivery";

export const createNotificationRuntime = ({
  bridge,
  loadSettings,
  navigate,
  onFailure,
  onCoordinationRecovered,
  onOsShown = () => {},
  onSettingsRecovered = () => {},
  onSoundPlayed = () => {},
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
  onSoundPlayed?: () => void;
  inApp: ReturnType<typeof createSonnerNotificationAdapter>;
  sound: ReturnType<typeof createCuelumeNotificationSoundAdapter>;
}) => {
  const activeCoordinationFailures = new Set<CoordinationFailurePhase>();
  const localErrorPublications = new Set<string>();
  const os = createShellOsNotificationAdapter(bridge, onOsShown);
  const playSound = async (cue: NotificationCue, volumePercent: number): Promise<void> => {
    await sound.play(cue, volumePercent);
    onSoundPlayed();
  };
  const policy = createNotificationPolicy({
    loadSettings,
    inApp,
    os,
    sound: { play: playSound },
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
      type: "notification_settings",
    },
  };

  const playConfiguredCue = async (
    settings: NotificationSettings,
    cue: NotificationCue = settings.globalCue,
  ): Promise<void> => {
    if (settings.volumePercent > 0) {
      await playSound(cue, settings.volumePercent);
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
    errorMessage?: string,
    inAppFeedbackHandled = false,
  ): Promise<boolean> => {
    const occurrence = notificationOccurrenceSchema.parse(rawOccurrence);
    const context: NotificationDispatchContext = { phase: "local", inAppFeedbackHandled };
    if (errorMessage !== undefined) context.errorMessage = errorMessage;
    const localResult = await policy.dispatch(occurrence, context, suppliedSettings);
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

  const publishAndWait = async (
    rawOccurrence: NotificationOccurrence,
    localErrorMessage?: string,
    inAppFeedbackHandled = false,
  ): Promise<boolean> => {
    let occurrence = rawOccurrence;
    try {
      occurrence = notificationOccurrenceSchema.parse({
        ...prepareNotificationOccurrence(rawOccurrence),
        occurrenceId: await boundNotificationOccurrenceId(rawOccurrence.occurrenceId),
      });
      const settings = await policy.loadSettingsCandidate(occurrence);
      if (!settings) return false;
      if (localErrorMessage !== undefined) localErrorPublications.add(occurrence.occurrenceId);
      const selected = await bridge.publishOccurrence(occurrence, settings);
      recoverCoordinationFailure("publication");
      return await dispatch(
        selected.occurrence,
        selected.settings,
        localErrorMessage,
        inAppFeedbackHandled,
      );
    } catch (cause) {
      reportCoordinationFailure("publication", occurrence, cause);
      return false;
    } finally {
      if (localErrorMessage !== undefined) localErrorPublications.delete(occurrence.occurrenceId);
    }
  };

  return {
    publish(rawOccurrence: NotificationOccurrence): void {
      void publishAndWait(rawOccurrence);
    },
    publishAndWait,
    subscribe(): () => void {
      const stopOccurrences = bridge.subscribeOccurrences((occurrence, settings) => {
        if (localErrorPublications.has(occurrence.occurrenceId)) return;
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
      return playSound(cue, volumePercent);
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
        purpose: "test",
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
