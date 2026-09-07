import {
  notificationOccurrenceSchema,
  notificationSettingsSchema,
  type NotificationOccurrence,
  type NotificationSettings,
} from "@openducktor/contracts";
import { z } from "zod";

const OCCURRENCE_CHANNEL_NAME = "openducktor:notifications:occurrences";
const EXTERNAL_DELIVERY_LOCK_NAME = "openducktor:notifications:external-delivery";
const TAB_LOCK_NAME_PREFIX = "openducktor:notifications:tab:";
const APP_FOCUS_LOCK_NAME = "openducktor:notifications:app-focus";
const CLAIM_ACKNOWLEDGEMENT_TIMEOUT_MS = 5000;
const OCCURRENCE_SELECTION_TIMEOUT_MS = 5000;
const COORDINATION_DISPOSED_MESSAGE =
  "Browser notification coordination stopped before occurrence selection.";

const coordinatorMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("occurrence_candidate"),
    occurrence: notificationOccurrenceSchema,
    settings: notificationSettingsSchema.removeDefault(),
  }),
  z.object({
    type: z.literal("occurrence_selected"),
    claimId: z.string().min(1).optional(),
    occurrence: notificationOccurrenceSchema,
    settings: notificationSettingsSchema.removeDefault(),
  }),
  z.object({
    type: z.literal("external_delivery_claimed"),
    occurrenceId: z.string().min(1),
    claimId: z.string().min(1),
  }),
  z.object({
    type: z.literal("external_delivery_claim_released"),
    occurrenceId: z.string().min(1),
    claimId: z.string().min(1),
  }),
  z.object({
    type: z.literal("external_delivery_claim_ack"),
    occurrenceId: z.string().min(1),
    claimId: z.string().min(1),
    tabId: z.string().min(1),
    focusUnavailable: z.boolean().optional(),
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

type CoordinationOperation =
  | "tab_registration"
  | "selection"
  | "claim"
  | "external_ownership"
  | "remote_focus"
  | "focus_lock"
  | "focus_query";

export type BrowserNotificationCoordinator = {
  readonly supported: boolean;
  getFailureMessage(): string | null;
  publishOccurrence(
    occurrence: NotificationOccurrence,
    settings: NotificationSettings,
  ): Promise<{ occurrence: NotificationOccurrence; settings: NotificationSettings }>;
  subscribeOccurrences(
    listener: (occurrence: NotificationOccurrence, settings: NotificationSettings) => void,
  ): () => void;
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

type PendingOccurrence = {
  occurrence: NotificationOccurrence;
  settings: NotificationSettings;
};

type PublicationSettlement = {
  resolve(selection: PendingOccurrence): void;
  reject(cause: Error): void;
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
    const failureMessage = "This browser cannot coordinate notifications and sound across tabs.";
    return {
      supported: false,
      getFailureMessage: () => failureMessage,
      publishOccurrence: async (occurrence, settings) => ({ occurrence, settings }),
      subscribeOccurrences: () => () => {},
      isExternalDeliveryOwner: () => false,
      claimExternalDelivery: async () => {
        throw new Error(failureMessage);
      },
      isAnyTabFocused: async () => false,
      dispose: () => {},
    };
  }

  let disposed = false;
  const failureMessages = new Map<CoordinationOperation, string>();
  let channel: BroadcastChannelLike | null = null;
  let externalDeliveryOwner = false;
  let releaseExternalDeliveryLock: (() => void) | null = null;
  let externalDeliveryLockAbortController: AbortController | null = null;
  let focusLock: {
    controller: AbortController;
    release(): void;
    released: Promise<void>;
  } | null = null;
  let focusTransition = Promise.resolve();
  let releaseTabLock: (() => void) | null = null;
  let tabLockAbortController: AbortController | null = null;
  const candidateOccurrences = new Map<string, PendingOccurrence>();
  const selectedOccurrences = new Map<string, PendingOccurrence>();
  const pendingOccurrences = new Map<string, PendingOccurrence>();
  const claimedOccurrences = new Map<string, string>();
  const claimingOccurrences = new Map<string, string>();
  const occurrenceListeners = new Set<
    (occurrence: NotificationOccurrence, settings: NotificationSettings) => void
  >();
  const claimWaiters = new Map<string, Map<string, (focusUnavailable?: boolean) => void>>();
  const publicationSettlements = new Map<string, Set<PublicationSettlement>>();
  const activeClaimPropagations = new Set<Promise<void>>();
  const tabLockName = `${TAB_LOCK_NAME_PREFIX}${tabId}`;

  const recordFailure = (operation: CoordinationOperation, cause: unknown): void => {
    failureMessages.set(operation, cause instanceof Error ? cause.message : String(cause));
  };

  const rejectPublication = (occurrenceId: string, error: Error): void => {
    const settlements = publicationSettlements.get(occurrenceId);
    publicationSettlements.delete(occurrenceId);
    candidateOccurrences.delete(occurrenceId);
    for (const settlement of settlements ?? []) {
      settlement.reject(error);
    }
  };

  const rejectPendingPublications = (cause: unknown): void => {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    for (const occurrenceId of publicationSettlements.keys()) {
      rejectPublication(occurrenceId, error);
    }
    candidateOccurrences.clear();
  };

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
        failureMessages.delete("tab_registration");
        tabLockAbortController = null;
        const registeredChannel = createChannel();
        channel = registeredChannel;
        registeredChannel.addEventListener("message", handleMessage);
        for (const candidate of candidateOccurrences.values()) {
          registeredChannel.postMessage({ type: "occurrence_candidate", ...candidate });
        }
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
          recordFailure("tab_registration", cause);
          rejectPendingPublications(cause);
        }
      });
  };

  const getTabId = (lock: { name?: string }): string | null => {
    if (!lock.name?.startsWith(TAB_LOCK_NAME_PREFIX)) return null;
    return lock.name.slice(TAB_LOCK_NAME_PREFIX.length) || null;
  };

  const waitForClaimAcknowledgementOrExit = (
    claimId: string,
    recipientTabId: string,
  ): Promise<boolean | void> => {
    const controller = new AbortController();
    let finishWaiting = (_focusUnavailable?: boolean): void => {};
    let timeout: ReturnType<typeof setTimeout>;
    const waitFinished = new Promise<boolean | void>((resolve, reject) => {
      timeout = setTimeout(() => {
        const error = new Error(
          "A browser tab did not acknowledge the notification claim. Close or reload unresponsive OpenDucktor tabs.",
        );
        recordFailure("claim", error);
        reject(error);
      }, CLAIM_ACKNOWLEDGEMENT_TIMEOUT_MS);
      finishWaiting = (focusUnavailable) => {
        resolve(focusUnavailable);
        controller.abort();
      };
    });
    const tabWaiters = claimWaiters.get(claimId) ?? new Map();
    tabWaiters.set(recipientTabId, finishWaiting);
    claimWaiters.set(claimId, tabWaiters);
    const exited = locks
      .request(
        `${TAB_LOCK_NAME_PREFIX}${recipientTabId}`,
        { mode: "exclusive", signal: controller.signal },
        async () => {},
      )
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        recordFailure("claim", cause);
        throw cause;
      });
    return Promise.race([waitFinished, exited]).finally(() => {
      clearTimeout(timeout);
      controller.abort();
      const currentWaiters = claimWaiters.get(claimId);
      if (currentWaiters?.get(recipientTabId) === finishWaiting) {
        currentWaiters.delete(recipientTabId);
        if (currentWaiters.size === 0) {
          claimWaiters.delete(claimId);
        }
      }
    });
  };

  const propagateClaim = async (occurrenceId: string, claimId: string): Promise<void> => {
    await waitForFocusTransition();
    let snapshot: LockSnapshot;
    try {
      snapshot = await locks.query();
    } catch (cause) {
      recordFailure("claim", cause);
      throw cause;
    }
    const tabIds = new Set(
      (snapshot.held ?? [])
        .map(getTabId)
        .filter((value): value is string => value !== null && value !== tabId),
    );
    const acknowledgements = [...tabIds].map((recipientTabId) =>
      waitForClaimAcknowledgementOrExit(claimId, recipientTabId),
    );
    const registeredChannel = channel;
    if (!registeredChannel) {
      throw new Error("The browser notification channel is not registered.");
    }
    registeredChannel.postMessage({ type: "external_delivery_claimed", occurrenceId, claimId });
    const focusFailures = await Promise.all(acknowledgements);
    if (focusFailures.some(Boolean)) {
      recordFailure("remote_focus", "A browser tab could not report its focus state.");
    } else {
      failureMessages.delete("remote_focus");
    }
    failureMessages.delete("claim");
  };

  const trackClaimPropagation = (occurrenceId: string, claimId: string): Promise<void> => {
    let propagation: Promise<void>;
    propagation = propagateClaim(occurrenceId, claimId).finally(() => {
      activeClaimPropagations.delete(propagation);
    });
    activeClaimPropagations.add(propagation);
    return propagation;
  };

  const notifyOccurrenceListeners = ({ occurrence, settings }: PendingOccurrence): void => {
    for (const listener of occurrenceListeners) {
      listener(occurrence, settings);
    }
  };

  const acceptSelection = (selection: PendingOccurrence, claimId?: string): boolean => {
    const occurrenceId = selection.occurrence.occurrenceId;
    if (claimId !== undefined) {
      claimedOccurrences.set(occurrenceId, claimId);
      pendingOccurrences.delete(occurrenceId);
    }
    if (selectedOccurrences.has(occurrenceId)) return false;
    failureMessages.delete("selection");
    selectedOccurrences.set(occurrenceId, selection);
    candidateOccurrences.delete(occurrenceId);
    if (!claimedOccurrences.has(occurrenceId)) {
      pendingOccurrences.set(occurrenceId, selection);
    }
    for (const settlement of publicationSettlements.get(occurrenceId) ?? []) {
      settlement.resolve(selection);
    }
    publicationSettlements.delete(occurrenceId);
    notifyOccurrenceListeners(selection);
    return true;
  };

  const broadcastSelection = (selection: PendingOccurrence): void => {
    const occurrenceId = selection.occurrence.occurrenceId;
    const claimId = claimedOccurrences.get(occurrenceId) ?? claimingOccurrences.get(occurrenceId);
    const message: Extract<CoordinatorMessage, { type: "occurrence_selected" }> = {
      type: "occurrence_selected",
      ...selection,
    };
    if (claimId !== undefined) message.claimId = claimId;
    channel?.postMessage(message);
  };

  const selectCandidate = (candidate: PendingOccurrence): void => {
    const occurrenceId = candidate.occurrence.occurrenceId;
    acceptSelection(candidate);
    const selection = selectedOccurrences.get(occurrenceId);
    if (selection) {
      broadcastSelection(selection);
    }
  };

  const replayPendingOccurrences = (): void => {
    if (!externalDeliveryOwner) return;
    for (const pending of pendingOccurrences.values()) {
      notifyOccurrenceListeners(pending);
    }
  };

  const handleMessage = (event: MessageEvent<unknown>): void => {
    const parsed = coordinatorMessageSchema.safeParse(event.data);
    if (!parsed.success) return;
    if (parsed.data.type === "external_delivery_claim_ack") {
      claimWaiters.get(parsed.data.claimId)?.get(parsed.data.tabId)?.(parsed.data.focusUnavailable);
      return;
    }
    if (parsed.data.type === "external_delivery_claim_released") {
      const occurrenceId = parsed.data.occurrenceId;
      if (claimedOccurrences.get(occurrenceId) !== parsed.data.claimId) return;
      claimedOccurrences.delete(occurrenceId);
      const selected = selectedOccurrences.get(occurrenceId);
      if (selected) {
        pendingOccurrences.set(occurrenceId, selected);
        if (externalDeliveryOwner) notifyOccurrenceListeners(selected);
      }
      return;
    }
    if (parsed.data.type === "external_delivery_claimed") {
      claimedOccurrences.set(parsed.data.occurrenceId, parsed.data.claimId);
      pendingOccurrences.delete(parsed.data.occurrenceId);
      const { occurrenceId, claimId } = parsed.data;
      void waitForFocusTransition()
        .then(() => {
          channel?.postMessage({
            type: "external_delivery_claim_ack",
            occurrenceId,
            claimId,
            tabId,
            focusUnavailable: failureMessages.has("focus_lock"),
          });
        })
        .catch((cause: unknown) => recordFailure("claim", cause));
      return;
    }
    const pending = { occurrence: parsed.data.occurrence, settings: parsed.data.settings };
    const occurrenceId = pending.occurrence.occurrenceId;
    if (parsed.data.type === "occurrence_selected") {
      acceptSelection(pending, parsed.data.claimId);
      return;
    }
    const selected = selectedOccurrences.get(occurrenceId);
    if (selected) {
      if (externalDeliveryOwner) {
        broadcastSelection(selected);
      }
      return;
    }
    if (claimedOccurrences.has(occurrenceId)) return;
    if (!candidateOccurrences.has(occurrenceId)) {
      candidateOccurrences.set(occurrenceId, pending);
    }
    if (externalDeliveryOwner) {
      const candidate = candidateOccurrences.get(occurrenceId);
      if (candidate) selectCandidate(candidate);
    }
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
          failureMessages.delete("external_ownership");
          externalDeliveryLockAbortController = null;
          externalDeliveryOwner = true;
          replayPendingOccurrences();
          for (const candidate of candidateOccurrences.values()) {
            selectCandidate(candidate);
          }
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
          recordFailure("external_ownership", cause);
          rejectPendingPublications(cause);
        }
      });
  };

  const waitForFocusTransition = async (): Promise<void> => {
    let transition: Promise<void>;
    do {
      transition = focusTransition;
      await transition;
    } while (transition !== focusTransition);
  };

  const releaseFocusedState = (): void => {
    const current = focusLock;
    if (!current) return;
    focusLock = null;
    current.controller.abort();
    current.release();
    focusTransition = Promise.all([focusTransition, current.released]).then(() => {});
  };

  const holdFocusedState = (): void => {
    if (disposed || !channel || focusLock) return;
    const controller = new AbortController();
    let markReady = (): void => {};
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const current = { controller, release: () => {}, released: Promise.resolve() };
    focusLock = current;
    current.released = locks
      .request(APP_FOCUS_LOCK_NAME, { mode: "shared", signal: controller.signal }, async () => {
        if (disposed || !focusDocument.hasFocus() || focusLock !== current) return;
        failureMessages.delete("focus_lock");
        await new Promise<void>((resolve) => {
          current.release = resolve;
          markReady();
        });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) recordFailure("focus_lock", cause);
      })
      .finally(() => {
        if (focusLock === current) focusLock = null;
        markReady();
      });
    focusTransition = Promise.all([focusTransition, ready]).then(() => {});
  };

  const handleFocus = (): void => holdFocusedState();
  const handleBlur = (): void => releaseFocusedState();
  focusWindow.addEventListener("focus", handleFocus);
  focusWindow.addEventListener("blur", handleBlur);
  holdTabState();

  return {
    supported,
    getFailureMessage: () => [...failureMessages.values()].join(" ") || null,
    async publishOccurrence(occurrence, settings) {
      const parsed = notificationOccurrenceSchema.parse(occurrence);
      const parsedSettings = notificationSettingsSchema.removeDefault().parse(settings);
      if (disposed) {
        throw new Error(COORDINATION_DISPOSED_MESSAGE);
      }
      const selected = selectedOccurrences.get(parsed.occurrenceId);
      if (selected) return selected;
      const selectionFailure =
        failureMessages.get("tab_registration") ?? failureMessages.get("external_ownership");
      if (selectionFailure) {
        throw new Error(selectionFailure);
      }
      const candidate = candidateOccurrences.get(parsed.occurrenceId) ?? {
        occurrence: parsed,
        settings: parsedSettings,
      };
      candidateOccurrences.set(parsed.occurrenceId, candidate);
      const selection = new Promise<PendingOccurrence>((resolve, reject) => {
        const deadline = setTimeout(() => {
          const error = new Error(
            "A browser tab did not select the notification occurrence. Close or reload unresponsive OpenDucktor tabs.",
          );
          recordFailure("selection", error);
          rejectPublication(parsed.occurrenceId, error);
        }, OCCURRENCE_SELECTION_TIMEOUT_MS);
        const settlements = publicationSettlements.get(parsed.occurrenceId) ?? new Set();
        settlements.add({
          resolve(selectedOccurrence: PendingOccurrence) {
            clearTimeout(deadline);
            resolve(selectedOccurrence);
          },
          reject(error: Error) {
            clearTimeout(deadline);
            reject(error);
          },
        });
        publicationSettlements.set(parsed.occurrenceId, settlements);
      });
      if (externalDeliveryOwner) {
        selectCandidate(candidate);
      } else if (channel) {
        channel.postMessage({ type: "occurrence_candidate", ...candidate });
      }
      return selection;
    },
    subscribeOccurrences(listener) {
      occurrenceListeners.add(listener);
      if (externalDeliveryOwner) {
        for (const pending of pendingOccurrences.values()) {
          listener(pending.occurrence, pending.settings);
        }
      }
      return () => occurrenceListeners.delete(listener);
    },
    isExternalDeliveryOwner: () => externalDeliveryOwner,
    async claimExternalDelivery(occurrenceId) {
      if (
        !externalDeliveryOwner ||
        !pendingOccurrences.has(occurrenceId) ||
        claimingOccurrences.has(occurrenceId)
      )
        return false;
      const claimId = crypto.randomUUID();
      claimingOccurrences.set(occurrenceId, claimId);
      try {
        await trackClaimPropagation(occurrenceId, claimId);
        claimedOccurrences.set(occurrenceId, claimId);
        pendingOccurrences.delete(occurrenceId);
        return true;
      } catch (cause) {
        for (const finishWaiting of claimWaiters.get(claimId)?.values() ?? []) finishWaiting();
        channel?.postMessage({ type: "external_delivery_claim_released", occurrenceId, claimId });
        throw cause;
      } finally {
        claimingOccurrences.delete(occurrenceId);
      }
    },
    async isAnyTabFocused() {
      await waitForFocusTransition();
      const focusLockFailure =
        failureMessages.get("focus_lock") ?? failureMessages.get("remote_focus");
      if (focusLockFailure) {
        throw new Error(focusLockFailure);
      }
      try {
        const snapshot = await locks.query();
        failureMessages.delete("focus_query");
        return snapshot.held?.some((lock) => lock.name === APP_FOCUS_LOCK_NAME) ?? false;
      } catch (cause) {
        recordFailure("focus_query", cause);
        throw cause;
      }
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      externalDeliveryLockAbortController?.abort();
      externalDeliveryLockAbortController = null;
      releaseFocusedState();
      rejectPendingPublications(new Error(COORDINATION_DISPOSED_MESSAGE));
      selectedOccurrences.clear();
      pendingOccurrences.clear();
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
