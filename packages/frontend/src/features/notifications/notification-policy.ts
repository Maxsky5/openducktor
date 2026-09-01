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
}: CreateNotificationPolicyOptions) => {
  const settingsSnapshots = new Map<string, Promise<NotificationSettings | null>>();
  const terminalChannels = new Map<string, Set<DeliveryChannel>>();

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

  const loadSettingsSnapshot = (
    occurrence: NotificationOccurrence,
    suppliedSettings?: NotificationSettings,
  ): Promise<NotificationSettings | null> => {
    const existing = settingsSnapshots.get(occurrence.occurrenceId);
    if (existing) return existing;
    const snapshot = Promise.resolve(suppliedSettings)
      .then((settings) => settings ?? loadSettings())
      .then((settings) => notificationSettingsSchema.parse(settings))
      .catch((cause: unknown) => {
        reportFailure(occurrence, "settings", cause);
        return null;
      });
    settingsSnapshots.set(occurrence.occurrenceId, snapshot);
    return snapshot;
  };

  const markChannelTerminal = (occurrenceId: string, channel: DeliveryChannel): boolean => {
    const terminal = terminalChannels.get(occurrenceId) ?? new Set();
    if (terminal.has(channel)) return false;
    terminal.add(channel);
    terminalChannels.set(occurrenceId, terminal);
    return true;
  };

  const addDelivery = (
    occurrenceId: string,
    deliveries: PendingDelivery[],
    delivery: PendingDelivery,
  ): void => {
    if (!markChannelTerminal(occurrenceId, delivery.channel)) return;
    deliveries.push(delivery);
  };

  const dispatch = async (
    rawOccurrence: NotificationOccurrence,
    context: NotificationDispatchContext,
  ): Promise<NotificationExternalDeliveryPlan | null> => {
    const occurrence = notificationOccurrenceSchema.parse(rawOccurrence);
    const settings = await loadSettingsSnapshot(occurrence);
    if (!settings) return null;

    const kindSettings = settings.kinds[occurrence.kind];
    if (!kindSettings.enabled) {
      return null;
    }

    const copy = buildNotificationCopy(occurrence);
    const deliveries: PendingDelivery[] = [];
    if (context.phase === "local" && targetIncludesInApp(kindSettings.target)) {
      addDelivery(occurrence.occurrenceId, deliveries, {
        channel: "in_app",
        run: () => inApp.deliver(copy, occurrence),
      });
    }

    const osSelected = targetIncludesOs(kindSettings.target);
    const cue = resolveNotificationCue(kindSettings.sound, settings.globalCue);
    if (context.phase === "external" && osSelected) {
      const canDeliverOs = settings.osFocus === "always_send" || context.appFocused === false;
      if (canDeliverOs) {
        addDelivery(occurrence.occurrenceId, deliveries, {
          channel: "os",
          run: () => os.deliver(copy, occurrence),
        });
      } else {
        markChannelTerminal(occurrence.occurrenceId, "os");
      }
    }

    if (context.phase === "external" && cue) {
      const canPlaySound = settings.soundFocus === "always_play" || context.appFocused === false;
      if (canPlaySound) {
        addDelivery(occurrence.occurrenceId, deliveries, {
          channel: "sound",
          run: () => sound.play(cue, settings.volumePercent),
        });
      } else {
        markChannelTerminal(occurrence.occurrenceId, "sound");
      }
    }

    const results = await Promise.allSettled(deliveries.map(({ run }) => run()));
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        const delivery = deliveries[index];
        if (delivery) {
          reportFailure(occurrence, delivery.channel, result.reason);
        }
      }
    }

    if (context.phase === "external") return null;
    const terminal = terminalChannels.get(occurrence.occurrenceId);
    const osPending = osSelected && !terminal?.has("os");
    const soundPending = Boolean(cue) && !terminal?.has("sound");
    if (!osPending && !soundPending) return null;
    return {
      requiresFocus:
        (osPending && settings.osFocus === "suppress_if_focused") ||
        (soundPending && settings.soundFocus === "mute_while_focused"),
    };
  };

  return { dispatch, loadSettingsSnapshot };
};
