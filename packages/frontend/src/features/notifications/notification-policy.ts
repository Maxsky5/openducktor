import {
  notificationOccurrenceSchema,
  notificationSettingsSchema,
  type NotificationCue,
  type NotificationOccurrence,
  type NotificationSettings,
} from "@openducktor/contracts";
import { buildNotificationCopy, type NotificationCopy } from "./notification-copy";
import { resolveNotificationCue } from "./notification-sound";

export type NotificationDispatchContext =
  | { phase: "local" }
  | { phase: "external"; appFocused: boolean | undefined };

type InAppNotificationAdapter = {
  deliver(copy: NotificationCopy, occurrence: NotificationOccurrence): Promise<void>;
};

type OsNotificationAdapter = {
  deliver(copy: NotificationCopy, occurrence: NotificationOccurrence): Promise<void>;
};

type SoundNotificationAdapter = {
  play(cue: NotificationCue, volumePercent: number): Promise<void>;
};

export type NotificationExternalDeliveryPlan = {
  requiresFocus: boolean;
};

export type NotificationDispatchResult = {
  externalPlan: NotificationExternalDeliveryPlan | null;
  inAppDelivered: boolean;
};

export type NotificationDispatchFailure = {
  channel: "coordination" | "in_app" | "os" | "sound" | "settings";
  kind: NotificationOccurrence["kind"];
  occurrenceId: string;
  repoPath: string;
  message: string;
};

type CreateNotificationPolicyOptions = {
  loadSettings(): Promise<NotificationSettings>;
  inApp: InAppNotificationAdapter;
  os: OsNotificationAdapter;
  sound: SoundNotificationAdapter;
  onFailure(failure: NotificationDispatchFailure): void;
  onSettingsRecovered?(): void;
};

type DeliveryChannel = "in_app" | "os" | "sound";

type PendingDelivery = {
  channel: DeliveryChannel;
  run(): Promise<void>;
};

const errorMessage = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.slice(0, 500);
};

const targetIncludesInApp = (
  target: NotificationSettings["kinds"][NotificationOccurrence["kind"]]["target"],
): boolean => target === "in_app" || target === "both";

const targetIncludesOs = (
  target: NotificationSettings["kinds"][NotificationOccurrence["kind"]]["target"],
): boolean => target === "os" || target === "both";

export const createNotificationPolicy = ({
  loadSettings,
  inApp,
  os,
  sound,
  onFailure,
  onSettingsRecovered = () => {},
}: CreateNotificationPolicyOptions) => {
  const localOccurrences = new Set<string>();
  const externalOccurrences = new Set<string>();

  const reportFailure = (
    occurrence: NotificationOccurrence,
    channel: NotificationDispatchFailure["channel"],
    cause: unknown,
  ): void => {
    onFailure({
      channel,
      kind: occurrence.kind,
      occurrenceId: occurrence.occurrenceId,
      repoPath: occurrence.repoPath,
      message: errorMessage(cause),
    });
  };

  const loadSettingsCandidate = (
    occurrence: NotificationOccurrence,
  ): Promise<NotificationSettings | null> =>
    loadSettings()
      .then((settings) => {
        const parsed = notificationSettingsSchema.parse(settings);
        onSettingsRecovered();
        return parsed;
      })
      .catch((cause: unknown) => {
        reportFailure(occurrence, "settings", cause);
        return null;
      });

  const dispatch = async (
    rawOccurrence: NotificationOccurrence,
    context: NotificationDispatchContext,
    settings: NotificationSettings,
  ): Promise<NotificationDispatchResult> => {
    const occurrence = notificationOccurrenceSchema.parse(rawOccurrence);
    const kindSettings = settings.kinds[occurrence.kind];
    if (!kindSettings.enabled) {
      return { externalPlan: null, inAppDelivered: false };
    }

    const copy = buildNotificationCopy(occurrence);
    const deliveries: PendingDelivery[] = [];
    const osSelected = targetIncludesOs(kindSettings.target);
    const cue = resolveNotificationCue(kindSettings.sound, settings.globalCue);
    if (context.phase === "local" && !localOccurrences.has(occurrence.occurrenceId)) {
      localOccurrences.add(occurrence.occurrenceId);
      if (targetIncludesInApp(kindSettings.target)) {
        deliveries.push({ channel: "in_app", run: () => inApp.deliver(copy, occurrence) });
      }
    }
    if (context.phase === "external" && !externalOccurrences.has(occurrence.occurrenceId)) {
      externalOccurrences.add(occurrence.occurrenceId);
      if (osSelected && (settings.osFocus === "always_send" || context.appFocused === false)) {
        deliveries.push({ channel: "os", run: () => os.deliver(copy, occurrence) });
      }
      if (cue && (settings.soundFocus === "always_play" || context.appFocused === false)) {
        deliveries.push({ channel: "sound", run: () => sound.play(cue, settings.volumePercent) });
      }
    }

    const results = await Promise.allSettled(deliveries.map(({ run }) => run()));
    let inAppDelivered = false;
    for (const [index, result] of results.entries()) {
      const delivery = deliveries[index];
      if (delivery?.channel === "in_app" && result.status === "fulfilled") {
        inAppDelivered = true;
      }
      if (result.status === "rejected") {
        if (delivery) {
          reportFailure(occurrence, delivery.channel, result.reason);
        }
      }
    }

    if (context.phase === "external" || externalOccurrences.has(occurrence.occurrenceId)) {
      return { externalPlan: null, inAppDelivered };
    }
    const externalPlan =
      osSelected || cue
        ? {
            requiresFocus:
              (osSelected && settings.osFocus === "suppress_if_focused") ||
              (Boolean(cue) && settings.soundFocus === "mute_while_focused"),
          }
        : null;
    return { externalPlan, inAppDelivered };
  };

  return { dispatch, loadSettingsCandidate };
};
