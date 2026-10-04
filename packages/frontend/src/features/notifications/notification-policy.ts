import { normalizeSessionErrorMessage } from "../../lib/session-error-message";
import {
  notificationOccurrenceSchema,
  notificationSettingsSchema,
  type NotificationCue,
  type NotificationDeliveryResult,
  type NotificationOccurrence,
  type NotificationSettings,
} from "@openducktor/contracts";
import { buildNotificationCopy, type NotificationCopy } from "./notification-copy";
import { resolveNotificationCue } from "./notification-sound";

export type NotificationDispatchContext =
  | { phase: "local"; errorMessage?: string; inAppFeedbackHandled?: boolean }
  | { phase: "external"; appFocused: boolean | undefined };

type InAppNotificationAdapter = {
  deliver(copy: NotificationCopy, occurrence: NotificationOccurrence): Promise<void>;
};

type OsNotificationAdapter = {
  deliver(
    copy: NotificationCopy,
    occurrence: NotificationOccurrence,
  ): Promise<NotificationDeliveryResult>;
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
  osStatus?: Exclude<NotificationDeliveryResult["status"], "shown">;
};

type CreateNotificationPolicyOptions = {
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

export const createNotificationPolicy = ({
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
    failure: Pick<NotificationDispatchFailure, "channel" | "message" | "osStatus">,
  ): void => {
    onFailure({
      ...failure,
      kind: occurrence.kind,
      occurrenceId: occurrence.occurrenceId,
      repoPath: occurrence.repoPath,
    });
  };

  const dispatch = async (
    rawOccurrence: NotificationOccurrence,
    context: NotificationDispatchContext,
    settings: NotificationSettings,
  ): Promise<NotificationDispatchResult> => {
    const occurrence = notificationOccurrenceSchema.parse(rawOccurrence);
    const selectedSettings = notificationSettingsSchema.removeDefault().parse(settings);
    onSettingsRecovered();
    const kindSettings = selectedSettings.kinds[occurrence.kind];
    if (!kindSettings.enabled) {
      return { externalPlan: null, inAppDelivered: false };
    }

    const copy = buildNotificationCopy(occurrence);
    const deliveries: PendingDelivery[] = [];
    const osSelected = targetIncludesOs(kindSettings.target);
    const cue = resolveNotificationCue(kindSettings.sound, settings.globalCue);
    const soundSelected = cue !== null && settings.volumePercent > 0;
    if (context.phase === "local" && !localOccurrences.has(occurrence.occurrenceId)) {
      localOccurrences.add(occurrence.occurrenceId);
      if (!context.inAppFeedbackHandled && targetIncludesInApp(kindSettings.target)) {
        const localCopy = context.errorMessage
          ? { ...copy, body: normalizeSessionErrorMessage(context.errorMessage) || copy.body }
          : copy;
        deliveries.push({ channel: "in_app", run: () => inApp.deliver(localCopy, occurrence) });
      }
    }
    if (context.phase === "external" && !externalOccurrences.has(occurrence.occurrenceId)) {
      externalOccurrences.add(occurrence.occurrenceId);
      if (osSelected && (settings.osFocus === "always_send" || context.appFocused === false)) {
        deliveries.push({
          channel: "os",
          run: async () => {
            const result = await os.deliver(copy, occurrence);
            if (result.status !== "shown") {
              reportFailure(occurrence, {
                channel: "os",
                message: result.message,
                osStatus: result.status,
              });
            }
          },
        });
      }
      if (
        soundSelected &&
        (settings.soundFocus === "always_play" || context.appFocused === false)
      ) {
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
          reportFailure(occurrence, {
            channel: delivery.channel,
            message: errorMessage(result.reason),
          });
        }
      }
    }

    if (context.phase === "external" || externalOccurrences.has(occurrence.occurrenceId)) {
      return { externalPlan: null, inAppDelivered };
    }
    const externalPlan =
      osSelected || soundSelected
        ? {
            requiresFocus:
              (osSelected && settings.osFocus === "suppress_if_focused") ||
              (soundSelected && settings.soundFocus === "mute_while_focused"),
          }
        : null;
    return { externalPlan, inAppDelivered };
  };

  return { dispatch };
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
