import { notificationOccurrenceSchema, type NotificationOccurrence } from "@openducktor/contracts";
import { z } from "zod";

const OCCURRENCE_CHANNEL_NAME = "openducktor:notifications:occurrences";
const EXTERNAL_DELIVERY_LOCK_NAME = "openducktor:notifications:external-delivery";
const APP_FOCUS_LOCK_NAME = "openducktor:notifications:app-focus";

const coordinatorMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("occurrence"), occurrence: notificationOccurrenceSchema }),
  z.object({ type: z.literal("external_delivery_claimed"), occurrenceId: z.string().min(1) }),
]);
type CoordinatorMessage = z.infer<typeof coordinatorMessageSchema>;

type BroadcastChannelLike = {
  postMessage(value: CoordinatorMessage): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
};

type LockSnapshot = { held?: Array<{ name?: string }> };
type LockHandle = { name: string };
type LockManagerLike = {
  request(
    name: string,
    options: { mode: "exclusive" | "shared"; signal?: AbortSignal },
    callback: (lock: LockHandle) => Promise<void>,
  ): Promise<void>;
  query(): Promise<LockSnapshot>;
};

type FocusDocument = { hasFocus(): boolean };
type FocusWindow = {
  addEventListener(type: "focus" | "blur", listener: EventListener): void;
  removeEventListener(type: "focus" | "blur", listener: EventListener): void;
};

export type BrowserNotificationCoordinator = {
  readonly supported: boolean;
  getFailureMessage(): string | null;
  publishOccurrence(occurrence: NotificationOccurrence): void;
  subscribeOccurrences(listener: (occurrence: NotificationOccurrence) => void): () => void;
  isExternalDeliveryOwner(): boolean;
  claimExternalDelivery(occurrenceId: string): boolean;
  isAnyTabFocused(): Promise<boolean>;
  dispose(): void;
};

type CreateBrowserNotificationCoordinatorOptions = {
  channel?: BroadcastChannelLike | null;
  locks?: LockManagerLike | null;
  focusDocument?: FocusDocument | null;
  focusWindow?: FocusWindow | null;
};

const createDefaultChannel = (): BroadcastChannelLike | null => {
  const NativeBroadcastChannel = globalThis.BroadcastChannel;
  if (!NativeBroadcastChannel) {
    return null;
  }
  return new NativeBroadcastChannel(OCCURRENCE_CHANNEL_NAME);
};

const getDefaultLocks = (): LockManagerLike | null => {
  const locks = globalThis.navigator?.locks;
  if (!locks) {
    return null;
  }
  return {
    request: (name, options, callback) =>
      locks.request<void>(name, options, async (lock) => {
        if (!lock) {
          throw new Error(`The browser did not grant the ${name} notification lock.`);
        }
        await callback({ name: lock.name });
      }),
    query: async () => {
      const snapshot = await locks.query();
      return {
        held: (snapshot.held ?? []).map((entry) => (entry.name ? { name: entry.name } : {})),
      };
    },
  };
};

export const createBrowserNotificationCoordinator = ({
  channel = createDefaultChannel(),
  locks = getDefaultLocks(),
  focusDocument = globalThis.document ?? null,
  focusWindow = globalThis.window ?? null,
}: CreateBrowserNotificationCoordinatorOptions = {}): BrowserNotificationCoordinator => {
  const supported = Boolean(channel && locks && focusDocument && focusWindow);
  if (!channel || !locks || !focusDocument || !focusWindow) {
    return {
      supported: false,
      getFailureMessage: () =>
        "This browser cannot coordinate notifications and sound across tabs.",
      publishOccurrence: () => {},
      subscribeOccurrences: () => () => {},
      isExternalDeliveryOwner: () => false,
      claimExternalDelivery: () => false,
      isAnyTabFocused: async () => false,
      dispose: () => channel?.close(),
    };
  }

  let disposed = false;
  let failureMessage: string | null = null;
  let externalDeliveryOwner = false;
  let releaseExternalDeliveryLock: (() => void) | null = null;
  let externalDeliveryLockAbortController: AbortController | null = null;
  let releaseFocusLock: (() => void) | null = null;
  let focusLockAbortController: AbortController | null = null;
  const pendingOccurrences = new Map<string, NotificationOccurrence>();
  const occurrenceListeners = new Set<(occurrence: NotificationOccurrence) => void>();

  const notifyOccurrenceListeners = (occurrence: NotificationOccurrence): void => {
    for (const listener of occurrenceListeners) {
      listener(occurrence);
    }
  };

  const replayPendingOccurrences = (): void => {
    if (!externalDeliveryOwner) return;
    for (const occurrence of pendingOccurrences.values()) {
      notifyOccurrenceListeners(occurrence);
    }
  };

  const handleMessage = (event: MessageEvent<unknown>): void => {
    const parsed = coordinatorMessageSchema.safeParse(event.data);
    if (!parsed.success) return;
    if (parsed.data.type === "external_delivery_claimed") {
      pendingOccurrences.delete(parsed.data.occurrenceId);
      return;
    }
    pendingOccurrences.set(parsed.data.occurrence.occurrenceId, parsed.data.occurrence);
    notifyOccurrenceListeners(parsed.data.occurrence);
  };
  channel.addEventListener("message", handleMessage);

  const holdExternalDeliveryOwnership = (): void => {
    const controller = new AbortController();
    externalDeliveryLockAbortController = controller;
    void locks
      .request(
        EXTERNAL_DELIVERY_LOCK_NAME,
        { mode: "exclusive", signal: controller.signal },
        async () => {
          if (disposed) return;
          externalDeliveryLockAbortController = null;
          externalDeliveryOwner = true;
          replayPendingOccurrences();
          await new Promise<void>((resolve) => {
            releaseExternalDeliveryLock = resolve;
          });
          releaseExternalDeliveryLock = null;
          externalDeliveryOwner = false;
        },
      )
      .catch((cause: unknown) => {
        if (externalDeliveryLockAbortController === controller) {
          externalDeliveryLockAbortController = null;
        }
        if (!controller.signal.aborted) {
          failureMessage = cause instanceof Error ? cause.message : String(cause);
        }
      });
  };
  holdExternalDeliveryOwnership();

  const releaseFocusedState = (): void => {
    focusLockAbortController?.abort();
    focusLockAbortController = null;
    releaseFocusLock?.();
    releaseFocusLock = null;
  };

  const holdFocusedState = (): void => {
    if (disposed || focusLockAbortController || releaseFocusLock) {
      return;
    }
    const controller = new AbortController();
    focusLockAbortController = controller;
    void locks
      .request(APP_FOCUS_LOCK_NAME, { mode: "shared", signal: controller.signal }, async () => {
        if (disposed || !focusDocument.hasFocus()) {
          return;
        }
        focusLockAbortController = null;
        await new Promise<void>((resolve) => {
          releaseFocusLock = resolve;
        });
        releaseFocusLock = null;
      })
      .catch((cause: unknown) => {
        if (focusLockAbortController === controller) {
          focusLockAbortController = null;
        }
        if (!controller.signal.aborted) {
          failureMessage = cause instanceof Error ? cause.message : String(cause);
        }
      });
  };

  const handleFocus = (): void => holdFocusedState();
  const handleBlur = (): void => releaseFocusedState();
  focusWindow.addEventListener("focus", handleFocus);
  focusWindow.addEventListener("blur", handleBlur);
  if (focusDocument.hasFocus()) {
    holdFocusedState();
  }

  return {
    supported,
    getFailureMessage: () => failureMessage,
    publishOccurrence(occurrence) {
      const parsed = notificationOccurrenceSchema.parse(occurrence);
      pendingOccurrences.set(parsed.occurrenceId, parsed);
      channel.postMessage({ type: "occurrence", occurrence: parsed });
    },
    subscribeOccurrences(listener) {
      occurrenceListeners.add(listener);
      if (externalDeliveryOwner) {
        for (const occurrence of pendingOccurrences.values()) {
          listener(occurrence);
        }
      }
      return () => occurrenceListeners.delete(listener);
    },
    isExternalDeliveryOwner: () => externalDeliveryOwner,
    claimExternalDelivery(occurrenceId) {
      if (!externalDeliveryOwner || !pendingOccurrences.has(occurrenceId)) return false;
      pendingOccurrences.delete(occurrenceId);
      channel.postMessage({ type: "external_delivery_claimed", occurrenceId });
      return true;
    },
    async isAnyTabFocused() {
      const snapshot = await locks.query();
      return snapshot.held?.some((lock) => lock.name === APP_FOCUS_LOCK_NAME) ?? false;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      externalDeliveryLockAbortController?.abort();
      externalDeliveryLockAbortController = null;
      releaseExternalDeliveryLock?.();
      releaseExternalDeliveryLock = null;
      externalDeliveryOwner = false;
      releaseFocusedState();
      pendingOccurrences.clear();
      occurrenceListeners.clear();
      channel.removeEventListener("message", handleMessage);
      channel.close();
      focusWindow.removeEventListener("focus", handleFocus);
      focusWindow.removeEventListener("blur", handleBlur);
    },
  };
};
