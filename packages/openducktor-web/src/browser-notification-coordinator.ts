import { notificationOccurrenceSchema, type NotificationOccurrence } from "@openducktor/contracts";

const OCCURRENCE_CHANNEL_NAME = "openducktor:notifications:occurrences";
const EXTERNAL_DELIVERY_LOCK_PREFIX = "openducktor:notifications:external-delivery";
const APP_FOCUS_LOCK_NAME = "openducktor:notifications:app-focus";

type BroadcastChannelLike = {
  postMessage(value: NotificationOccurrence): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
};

type LockSnapshot = { held?: Array<{ name?: string }> };
type LockHandle = { name: string };
type LockManagerLike = {
  request(
    name: string,
    options: { mode: "exclusive" | "shared"; signal?: AbortSignal; ifAvailable?: boolean },
    callback: (lock: LockHandle | null) => Promise<void>,
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
  claimExternalDelivery(occurrenceId: string): Promise<boolean>;
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
        await callback(lock ? { name: lock.name } : null);
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
      claimExternalDelivery: async () => false,
      isAnyTabFocused: async () => false,
      dispose: () => channel?.close(),
    };
  }

  let disposed = false;
  let failureMessage: string | null = null;
  let releaseFocusLock: (() => void) | null = null;
  let focusLockAbortController: AbortController | null = null;
  const externalClaimResults = new Map<string, Promise<boolean>>();
  const externalClaimAbortControllers = new Set<AbortController>();
  const externalClaimReleases = new Map<string, () => void>();
  const occurrenceListeners = new Set<(occurrence: NotificationOccurrence) => void>();

  const handleMessage = (event: MessageEvent<unknown>): void => {
    const parsed = notificationOccurrenceSchema.safeParse(event.data);
    if (!parsed.success) {
      return;
    }
    for (const listener of occurrenceListeners) {
      listener(parsed.data);
    }
  };
  channel.addEventListener("message", handleMessage);

  const claimExternalDelivery = (occurrenceId: string): Promise<boolean> => {
    const existingClaim = externalClaimResults.get(occurrenceId);
    if (existingClaim) return existingClaim;
    if (disposed) return Promise.resolve(false);

    const controller = new AbortController();
    externalClaimAbortControllers.add(controller);
    const claim = new Promise<boolean>((resolve) => {
      void locks
        .request(
          `${EXTERNAL_DELIVERY_LOCK_PREFIX}:${occurrenceId}`,
          { mode: "exclusive", ifAvailable: true, signal: controller.signal },
          async (lock) => {
            if (!lock || disposed) {
              resolve(false);
              return;
            }
            resolve(true);
            await new Promise<void>((release) => {
              externalClaimReleases.set(occurrenceId, release);
            });
            externalClaimReleases.delete(occurrenceId);
          },
        )
        .catch((cause: unknown) => {
          resolve(false);
          if (!controller.signal.aborted) {
            failureMessage = cause instanceof Error ? cause.message : String(cause);
          }
        })
        .finally(() => externalClaimAbortControllers.delete(controller));
    });
    externalClaimResults.set(occurrenceId, claim);
    return claim;
  };

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
      channel.postMessage(notificationOccurrenceSchema.parse(occurrence));
    },
    subscribeOccurrences(listener) {
      occurrenceListeners.add(listener);
      return () => occurrenceListeners.delete(listener);
    },
    claimExternalDelivery,
    async isAnyTabFocused() {
      const snapshot = await locks.query();
      return snapshot.held?.some((lock) => lock.name === APP_FOCUS_LOCK_NAME) ?? false;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const controller of externalClaimAbortControllers) controller.abort();
      for (const release of externalClaimReleases.values()) release();
      externalClaimAbortControllers.clear();
      externalClaimReleases.clear();
      releaseFocusedState();
      occurrenceListeners.clear();
      channel.removeEventListener("message", handleMessage);
      channel.close();
      focusWindow.removeEventListener("focus", handleFocus);
      focusWindow.removeEventListener("blur", handleBlur);
    },
  };
};
