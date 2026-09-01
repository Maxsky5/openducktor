import { notificationOccurrenceSchema, type NotificationOccurrence } from "@openducktor/contracts";
import { z } from "zod";

const OCCURRENCE_CHANNEL_NAME = "openducktor:notifications:occurrences";
const EXTERNAL_DELIVERY_LOCK_NAME = "openducktor:notifications:external-delivery";
const TAB_LOCK_NAME_PREFIX = "openducktor:notifications:tab:";
const APP_FOCUS_LOCK_NAME = "openducktor:notifications:app-focus";

const coordinatorMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("occurrence"), occurrence: notificationOccurrenceSchema }),
  z.object({ type: z.literal("external_delivery_claimed"), occurrenceId: z.string().min(1) }),
  z.object({
    type: z.literal("external_delivery_claim_ack"),
    occurrenceId: z.string().min(1),
    tabId: z.string().min(1),
  }),
]);
type CoordinatorMessage = z.infer<typeof coordinatorMessageSchema>;

type BroadcastChannelLike = {
  postMessage(value: CoordinatorMessage): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
};

type LockSnapshot = {
  held?: Array<{ name?: string }>;
};
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
  clearFailure(): void;
  publishOccurrence(occurrence: NotificationOccurrence): void;
  subscribeOccurrences(listener: (occurrence: NotificationOccurrence) => void): () => void;
  isExternalDeliveryOwner(): boolean;
  claimExternalDelivery(occurrenceId: string): Promise<boolean>;
  isAnyTabFocused(): Promise<boolean>;
  dispose(): void;
};

type CreateBrowserNotificationCoordinatorOptions = {
  createChannel?: (() => BroadcastChannelLike) | null;
  locks?: LockManagerLike | null;
  focusDocument?: FocusDocument | null;
  focusWindow?: FocusWindow | null;
  tabId?: string;
};

const getDefaultChannelFactory = (): (() => BroadcastChannelLike) | null => {
  const NativeBroadcastChannel = globalThis.BroadcastChannel;
  if (!NativeBroadcastChannel) {
    return null;
  }
  return () => new NativeBroadcastChannel(OCCURRENCE_CHANNEL_NAME);
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
  createChannel = getDefaultChannelFactory(),
  locks = getDefaultLocks(),
  focusDocument = globalThis.document ?? null,
  focusWindow = globalThis.window ?? null,
  tabId = globalThis.crypto.randomUUID(),
}: CreateBrowserNotificationCoordinatorOptions = {}): BrowserNotificationCoordinator => {
  const supported = Boolean(createChannel && locks && focusDocument && focusWindow);
  if (!createChannel || !locks || !focusDocument || !focusWindow) {
    return {
      supported: false,
      getFailureMessage: () =>
        "This browser cannot coordinate notifications and sound across tabs.",
      clearFailure: () => {},
      publishOccurrence: () => {},
      subscribeOccurrences: () => () => {},
      isExternalDeliveryOwner: () => false,
      claimExternalDelivery: async () => false,
      isAnyTabFocused: async () => false,
      dispose: () => {},
    };
  }

  let disposed = false;
  let failureMessage: string | null = null;
  let channel: BroadcastChannelLike | null = null;
  let externalDeliveryOwner = false;
  let releaseExternalDeliveryLock: (() => void) | null = null;
  let externalDeliveryLockAbortController: AbortController | null = null;
  let releaseFocusLock: (() => void) | null = null;
  let focusLockAbortController: AbortController | null = null;
  let releaseTabLock: (() => void) | null = null;
  let tabLockAbortController: AbortController | null = null;
  const pendingOccurrences = new Map<string, NotificationOccurrence>();
  const queuedPublications = new Map<string, NotificationOccurrence>();
  const claimedOccurrences = new Set<string>();
  const occurrenceListeners = new Set<(occurrence: NotificationOccurrence) => void>();
  const claimAcknowledgements = new Map<string, Map<string, () => void>>();
  const activeClaimPropagations = new Set<Promise<void>>();
  const tabLockName = `${TAB_LOCK_NAME_PREFIX}${tabId}`;

  const releaseTabState = (): void => {
    tabLockAbortController?.abort();
    tabLockAbortController = null;
    releaseTabLock?.();
    releaseTabLock = null;
  };

  const holdTabState = (): void => {
    const controller = new AbortController();
    tabLockAbortController = controller;
    void locks
      .request(tabLockName, { mode: "exclusive", signal: controller.signal }, async () => {
        if (disposed) return;
        tabLockAbortController = null;
        const registeredChannel = createChannel();
        channel = registeredChannel;
        registeredChannel.addEventListener("message", handleMessage);
        for (const occurrence of queuedPublications.values()) {
          registeredChannel.postMessage({ type: "occurrence", occurrence });
        }
        queuedPublications.clear();
        holdExternalDeliveryOwnership();
        if (focusDocument.hasFocus()) {
          holdFocusedState();
        }
        await new Promise<void>((resolve) => {
          releaseTabLock = resolve;
        });
        releaseTabLock = null;
      })
      .catch((cause: unknown) => {
        if (tabLockAbortController === controller) {
          tabLockAbortController = null;
        }
        if (!controller.signal.aborted) {
          failureMessage = cause instanceof Error ? cause.message : String(cause);
        }
      });
  };

  const getTabId = (lock: { name?: string }): string | null => {
    if (!lock.name?.startsWith(TAB_LOCK_NAME_PREFIX)) return null;
    return lock.name.slice(TAB_LOCK_NAME_PREFIX.length) || null;
  };

  const waitForClaimAcknowledgementOrExit = (
    occurrenceId: string,
    recipientTabId: string,
  ): Promise<void> => {
    const controller = new AbortController();
    let acknowledge = (): void => {};
    const acknowledged = new Promise<void>((resolve) => {
      acknowledge = () => {
        resolve();
        controller.abort();
      };
    });
    const acknowledgements = claimAcknowledgements.get(occurrenceId) ?? new Map();
    acknowledgements.set(recipientTabId, acknowledge);
    claimAcknowledgements.set(occurrenceId, acknowledgements);
    const exited = locks
      .request(
        `${TAB_LOCK_NAME_PREFIX}${recipientTabId}`,
        { mode: "exclusive", signal: controller.signal },
        async () => {},
      )
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        failureMessage = cause instanceof Error ? cause.message : String(cause);
        throw cause;
      })
      .finally(() => {
        const currentAcknowledgements = claimAcknowledgements.get(occurrenceId);
        if (currentAcknowledgements?.get(recipientTabId) === acknowledge) {
          currentAcknowledgements.delete(recipientTabId);
          if (currentAcknowledgements.size === 0) {
            claimAcknowledgements.delete(occurrenceId);
          }
        }
      });
    return Promise.race([acknowledged, exited]);
  };

  const propagateClaim = async (occurrenceId: string): Promise<void> => {
    let snapshot: LockSnapshot;
    try {
      snapshot = await locks.query();
    } catch (cause) {
      failureMessage = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    }
    const tabIds = new Set(
      (snapshot.held ?? [])
        .map(getTabId)
        .filter((value): value is string => value !== null && value !== tabId),
    );
    const acknowledgements = [...tabIds].map((recipientTabId) =>
      waitForClaimAcknowledgementOrExit(occurrenceId, recipientTabId),
    );
    const registeredChannel = channel;
    if (!registeredChannel) {
      throw new Error("The browser notification channel is not registered.");
    }
    registeredChannel.postMessage({ type: "external_delivery_claimed", occurrenceId });
    await Promise.all(acknowledgements);
    failureMessage = null;
  };

  const trackClaimPropagation = (occurrenceId: string): Promise<void> => {
    let propagation: Promise<void>;
    propagation = propagateClaim(occurrenceId).finally(() => {
      activeClaimPropagations.delete(propagation);
    });
    activeClaimPropagations.add(propagation);
    return propagation;
  };

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
    if (parsed.data.type === "external_delivery_claim_ack") {
      claimAcknowledgements.get(parsed.data.occurrenceId)?.get(parsed.data.tabId)?.();
      return;
    }
    if (parsed.data.type === "external_delivery_claimed") {
      claimedOccurrences.add(parsed.data.occurrenceId);
      pendingOccurrences.delete(parsed.data.occurrenceId);
      channel?.postMessage({
        type: "external_delivery_claim_ack",
        occurrenceId: parsed.data.occurrenceId,
        tabId,
      });
      return;
    }
    if (!claimedOccurrences.has(parsed.data.occurrence.occurrenceId)) {
      pendingOccurrences.set(parsed.data.occurrence.occurrenceId, parsed.data.occurrence);
    }
    notifyOccurrenceListeners(parsed.data.occurrence);
  };

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

  const releaseFocusedState = (): void => {
    focusLockAbortController?.abort();
    focusLockAbortController = null;
    releaseFocusLock?.();
    releaseFocusLock = null;
  };

  const holdFocusedState = (): void => {
    if (disposed || !channel || focusLockAbortController || releaseFocusLock) {
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
  holdTabState();

  return {
    supported,
    getFailureMessage: () => failureMessage,
    clearFailure() {
      failureMessage = null;
    },
    publishOccurrence(occurrence) {
      const parsed = notificationOccurrenceSchema.parse(occurrence);
      if (!claimedOccurrences.has(parsed.occurrenceId)) {
        pendingOccurrences.set(parsed.occurrenceId, parsed);
      }
      if (channel) {
        channel.postMessage({ type: "occurrence", occurrence: parsed });
      } else {
        queuedPublications.set(parsed.occurrenceId, parsed);
      }
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
    async claimExternalDelivery(occurrenceId) {
      if (!externalDeliveryOwner || !pendingOccurrences.has(occurrenceId)) return false;
      claimedOccurrences.add(occurrenceId);
      pendingOccurrences.delete(occurrenceId);
      await trackClaimPropagation(occurrenceId);
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
      releaseFocusedState();
      pendingOccurrences.clear();
      queuedPublications.clear();
      const finishExternalDeliveryOwnership = (): void => {
        releaseExternalDeliveryLock?.();
        releaseExternalDeliveryLock = null;
        externalDeliveryOwner = false;
        channel?.removeEventListener("message", handleMessage);
        channel?.close();
        channel = null;
        releaseTabState();
      };
      if (activeClaimPropagations.size > 0) {
        void Promise.allSettled(activeClaimPropagations).then(finishExternalDeliveryOwnership);
      } else {
        finishExternalDeliveryOwnership();
      }
      occurrenceListeners.clear();
      focusWindow.removeEventListener("focus", handleFocus);
      focusWindow.removeEventListener("blur", handleBlur);
    },
  };
};
