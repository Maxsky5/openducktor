import {
  notificationOccurrenceSchema,
  notificationSettingsSchema,
  type NotificationCue,
  type NotificationOccurrence,
  type NotificationSettings,
} from "@openducktor/contracts";
import { buildNotificationCopy, type NotificationCopy } from "./notification-copy";
import { resolveNotificationCue } from "./notification-sound";

export type NotificationDispatchContext = {
  appFocused: boolean;
  externalDeliveryOwner: boolean;
};

type InAppNotificationAdapter = {
  deliver(copy: NotificationCopy, occurrence: NotificationOccurrence): Promise<void>;
};

type OsNotificationAdapter = {
  deliver(copy: NotificationCopy, occurrence: NotificationOccurrence): Promise<void>;
};

type SoundNotificationAdapter = {
  play(cue: NotificationCue, volumePercent: number): Promise<void>;
};

export type NotificationDispatchFailure = {
  channel: "in_app" | "os" | "sound" | "settings";
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
};

type PendingDelivery = {
  channel: NotificationDispatchFailure["channel"];
  run: Promise<void>;
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
}: CreateNotificationPolicyOptions) => {
  const seenOccurrenceIds = new Set<string>();

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

  const dispatch = async (
    rawOccurrence: NotificationOccurrence,
    context: NotificationDispatchContext,
  ): Promise<void> => {
    const occurrence = notificationOccurrenceSchema.parse(rawOccurrence);
    if (seenOccurrenceIds.has(occurrence.occurrenceId)) {
      return;
    }
    seenOccurrenceIds.add(occurrence.occurrenceId);

    let settings: NotificationSettings;
    try {
      settings = notificationSettingsSchema.parse(await loadSettings());
    } catch (cause) {
      reportFailure(occurrence, "settings", cause);
      return;
    }

    const kindSettings = settings.kinds[occurrence.kind];
    if (!kindSettings.enabled) {
      return;
    }

    const copy = buildNotificationCopy(occurrence);
    const deliveries: PendingDelivery[] = [];
    if (targetIncludesInApp(kindSettings.target)) {
      deliveries.push({ channel: "in_app", run: inApp.deliver(copy, occurrence) });
    }

    const suppressOs = context.appFocused && settings.osFocus === "suppress_if_focused";
    if (context.externalDeliveryOwner && targetIncludesOs(kindSettings.target) && !suppressOs) {
      deliveries.push({ channel: "os", run: os.deliver(copy, occurrence) });
    }

    const cue = resolveNotificationCue(kindSettings.sound, settings.globalCue);
    const muteSound = context.appFocused && settings.soundFocus === "mute_while_focused";
    if (context.externalDeliveryOwner && cue && !muteSound) {
      deliveries.push({
        channel: "sound",
        run: sound.play(cue, settings.volumePercent),
      });
    }

    const results = await Promise.allSettled(deliveries.map(({ run }) => run));
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        const delivery = deliveries[index];
        if (delivery) {
          reportFailure(occurrence, delivery.channel, result.reason);
        }
      }
    }
  };

  return { dispatch };
};
