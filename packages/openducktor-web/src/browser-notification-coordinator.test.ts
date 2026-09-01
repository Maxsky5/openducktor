import { describe, expect, mock, test } from "bun:test";
import type { NotificationOccurrence } from "@openducktor/contracts";
import { createBrowserNotificationBridge } from "./browser-notification-bridge";
import { createBrowserNotificationCoordinator } from "./browser-notification-coordinator";

type CoordinatorMessage =
  | { type: "occurrence"; occurrence: NotificationOccurrence }
  | { type: "external_delivery_claimed"; occurrenceId: string }
  | { type: "external_delivery_claim_ack"; occurrenceId: string; tabId: string };

const EXTERNAL_DELIVERY_LOCK_NAME = "openducktor:notifications:external-delivery";
const TAB_LOCK_NAME_PREFIX = "openducktor:notifications:tab:";
const APP_FOCUS_LOCK_NAME = "openducktor:notifications:app-focus";

type LockRequest = {
  name: string;
  mode: "exclusive" | "shared";
  signal: AbortSignal | undefined;
  callback: (lock: { name: string }) => Promise<void>;
  resolve(): void;
  reject(cause: Error): void;
  active: boolean;
};

class FakeLockManager {
  private readonly requests: LockRequest[] = [];
  private readonly deferredRequests: LockRequest[] = [];
  private readonly deferredNames = new Set<string>();
  private readonly requestFailures = new Map<string, Error>();
  private queryFailure: Error | null = null;

  constructor(private paused = false) {}

  request(
    name: string,
    options: { mode: "exclusive" | "shared"; signal?: AbortSignal },
    callback: (lock: { name: string }) => Promise<void>,
  ): Promise<void> {
    const requestFailure = this.requestFailures.get(name);
    if (requestFailure) {
      this.requestFailures.delete(name);
      return Promise.reject(requestFailure);
    }
    return new Promise<void>((resolve, reject) => {
      const request: LockRequest = {
        name,
        mode: options.mode,
        signal: options.signal,
        callback,
        resolve,
        reject,
        active: false,
      };
      options.signal?.addEventListener("abort", () => {
        if (!request.active) {
          for (const requests of [this.requests, this.deferredRequests]) {
            const index = requests.indexOf(request);
            if (index >= 0) {
              requests.splice(index, 1);
            }
          }
          reject(new DOMException("Aborted", "AbortError"));
          this.drain(name);
        }
      });
      if (this.deferredNames.has(name)) {
        this.deferredRequests.push(request);
      } else {
        this.requests.push(request);
        this.drain(name);
      }
    });
  }

  async query(): Promise<{
    held: Array<{ name: string }>;
    pending: Array<{ name: string }>;
  }> {
    if (this.queryFailure) {
      const cause = this.queryFailure;
      this.queryFailure = null;
      throw cause;
    }
    return {
      held: this.requests
        .filter((request) => request.active)
        .map((request) => ({ name: request.name })),
      pending: this.requests
        .filter((request) => !request.active)
        .map((request) => ({ name: request.name })),
    };
  }

  defer(name: string): void {
    this.deferredNames.add(name);
  }

  admit(name: string): void {
    this.deferredNames.delete(name);
    const deferred = this.deferredRequests.filter((request) => request.name === name);
    for (const request of deferred) {
      this.deferredRequests.splice(this.deferredRequests.indexOf(request), 1);
      this.requests.push(request);
    }
    this.drain(name);
  }

  rejectNextQuery(cause: Error): void {
    this.queryFailure = cause;
  }

  rejectNextRequest(name: string, cause: Error): void {
    this.requestFailures.set(name, cause);
  }

  resume(): void {
    this.paused = false;
    for (const name of new Set(this.requests.map((request) => request.name))) {
      this.drain(name);
    }
  }

  heldCount(name?: string): number {
    return this.requests.filter(
      (request) => request.active && (name === undefined || request.name === name),
    ).length;
  }

  private drain(name: string): void {
    if (this.paused) {
      return;
    }
    const matching = this.requests.filter((request) => request.name === name);
    const active = matching.filter((request) => request.active);
    const pending = matching.filter((request) => !request.active);
    if (pending.length === 0 || active.some((request) => request.mode === "exclusive")) {
      return;
    }
    const next = pending[0];
    if (!next) {
      return;
    }
    if (next.mode === "exclusive" && active.length > 0) {
      return;
    }
    const ready: LockRequest[] = [];
    if (next.mode === "exclusive") {
      ready.push(next);
    } else {
      for (const request of pending) {
        if (request.mode === "exclusive") break;
        ready.push(request);
      }
    }
    for (const request of ready) {
      request.active = true;
      queueMicrotask(() => {
        void request.callback({ name: request.name }).then(
          () => {
            const index = this.requests.indexOf(request);
            if (index >= 0) {
              this.requests.splice(index, 1);
            }
            request.resolve();
            this.drain(name);
          },
          (cause) => {
            const index = this.requests.indexOf(request);
            if (index >= 0) {
              this.requests.splice(index, 1);
            }
            request.reject(cause instanceof Error ? cause : new Error(String(cause)));
            this.drain(name);
          },
        );
      });
    }
  }
}

class FakeBroadcastHub {
  readonly channels = new Set<FakeBroadcastChannel>();
  private readonly messages: Array<{
    channel: FakeBroadcastChannel;
    value: CoordinatorMessage;
  }> = [];
  private flushScheduled = false;

  constructor(private readonly autoFlush = true) {}

  createChannel(): FakeBroadcastChannel {
    const channel = new FakeBroadcastChannel(this);
    this.channels.add(channel);
    return channel;
  }

  postMessage(source: FakeBroadcastChannel, value: CoordinatorMessage): void {
    for (const channel of this.channels) {
      if (channel !== source) {
        this.messages.push({ channel, value });
      }
    }
    if (!this.autoFlush || this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.flushAll();
    });
  }

  async flushNext(channel: FakeBroadcastChannel, type: CoordinatorMessage["type"]): Promise<void> {
    await Promise.resolve();
    const index = this.messages.findIndex(
      (message) => message.channel === channel && message.value.type === type,
    );
    if (index < 0) {
      throw new Error(`No queued ${type} message exists.`);
    }
    const [message] = this.messages.splice(index, 1);
    message?.channel.emit(message.value);
  }

  flushAll(): void {
    const messages = this.messages.splice(0);
    for (const message of messages) {
      message.channel.emit(message.value);
    }
  }
}

class FakeBroadcastChannel {
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  private closed = false;

  constructor(private readonly hub: FakeBroadcastHub) {}

  postMessage(value: CoordinatorMessage): void {
    if (this.closed) {
      throw new DOMException("The broadcast channel is closed.", "InvalidStateError");
    }
    this.hub.postMessage(this, value);
  }

  addEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.hub.channels.delete(this);
    this.listeners.clear();
  }

  emit(value: CoordinatorMessage): void {
    if (this.closed) return;
    const event = new MessageEvent("message", { data: value });
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

class FakeFocusWindow {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: "focus" | "blur", listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: "focus" | "blur", listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: "focus" | "blur"): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new Event(type));
    }
  }
}

const waitForAsync = async (condition: () => Promise<boolean>): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await condition()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("Condition was not met.");
};

const waitFor = async (condition: () => boolean): Promise<void> => {
  await waitForAsync(async () => condition());
};

const occurrence: NotificationOccurrence = {
  occurrenceId: "workflow.closed:/repo:task-1:event-1",
  kind: "workflow.closed",
  repoPath: "/repo",
  repositoryLabel: "Repo",
  task: { id: "task-1", title: "Build notifications" },
  status: "Task moved to Closed.",
  navigationTarget: { type: "kanban_task", repoPath: "/repo", taskId: "task-1" },
};

describe("FakeLockManager", () => {
  test("keeps an exclusive waiter ahead of a later shared waiter", async () => {
    const locks = new FakeLockManager(true);
    const grants: string[] = [];
    let releaseFirst = (): void => {};
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const requests = [
      locks.request("ordered", { mode: "shared" }, async () => {
        grants.push("first shared");
        await firstHeld;
      }),
      locks.request("ordered", { mode: "exclusive" }, async () => {
        grants.push("exclusive");
      }),
      locks.request("ordered", { mode: "shared" }, async () => {
        grants.push("later shared");
      }),
    ];

    locks.resume();
    await waitFor(() => grants.length > 0);
    expect(grants).toEqual(["first shared"]);
    releaseFirst();
    await Promise.all(requests);

    expect(grants).toEqual(["first shared", "exclusive", "later shared"]);
  });
});

describe("browser notification coordinator", () => {
  test("delivers an occurrence once when leadership starts after publication", async () => {
    const locks = new FakeLockManager(true);
    const hub = new FakeBroadcastHub();
    const first = createBrowserNotificationCoordinator({
      createChannel: () => hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });
    const second = createBrowserNotificationCoordinator({
      createChannel: () => hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });
    const received: NotificationOccurrence[] = [];
    first.subscribeOccurrences((value) => {
      void first.claimExternalDelivery(value.occurrenceId).then((owner) => {
        if (owner) received.push(value);
      });
    });

    second.publishOccurrence(occurrence);
    expect(received).toEqual([]);
    locks.resume();
    await waitFor(() => received.length === 1);

    expect(received).toEqual([occurrence]);
    expect(locks.heldCount(EXTERNAL_DELIVERY_LOCK_NAME)).toBe(1);
    first.dispose();
    second.dispose();
  });

  test("replays an occurrence published during owner handoff", async () => {
    const locks = new FakeLockManager();
    const hub = new FakeBroadcastHub();
    const first = createBrowserNotificationCoordinator({
      createChannel: () => hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });
    const second = createBrowserNotificationCoordinator({
      createChannel: () => hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });
    await waitFor(() => first.isExternalDeliveryOwner());
    const received: NotificationOccurrence[] = [];
    second.subscribeOccurrences((value) => {
      void second.claimExternalDelivery(value.occurrenceId).then((owner) => {
        if (owner) received.push(value);
      });
    });

    first.dispose();
    second.publishOccurrence(occurrence);
    await waitFor(() => received.length === 1);

    expect(received).toEqual([occurrence]);
    expect(second.isExternalDeliveryOwner()).toBe(true);
    second.dispose();
  });

  test("waits for asynchronous claim propagation before owner handoff", async () => {
    const locks = new FakeLockManager();
    const hub = new FakeBroadcastHub(false);
    let firstChannel!: FakeBroadcastChannel;
    let secondChannel!: FakeBroadcastChannel;
    const firstCoordinator = createBrowserNotificationCoordinator({
      createChannel: () => {
        firstChannel = hub.createChannel();
        return firstChannel;
      },
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });
    const secondCoordinator = createBrowserNotificationCoordinator({
      createChannel: () => {
        secondChannel = hub.createChannel();
        return secondChannel;
      },
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });
    const firstBridge = createBrowserNotificationBridge({
      NativeNotification: null,
      coordinator: firstCoordinator,
      focusWindow: () => {},
    });
    const secondBridge = createBrowserNotificationBridge({
      NativeNotification: null,
      coordinator: secondCoordinator,
      focusWindow: () => {},
    });
    let releaseDelivery = (): void => {};
    const pendingDelivery = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    const showOsNotification = mock(async () => pendingDelivery);
    const playSound = mock(async () => pendingDelivery);
    const dispatches: Promise<void>[] = [];
    const subscribe = (bridge: ReturnType<typeof createBrowserNotificationBridge>): (() => void) =>
      bridge.subscribeOccurrences((value) => {
        const dispatch = bridge.withExternalDeliveryOwnership(value.occurrenceId, async (owner) => {
          if (!owner) return;
          await Promise.all([showOsNotification(), playSound()]);
        });
        dispatches.push(dispatch);
        void dispatch.catch(() => {});
      });
    subscribe(firstBridge);
    subscribe(secondBridge);
    await waitFor(() => firstCoordinator.isExternalDeliveryOwner());

    secondBridge.publishOccurrence(occurrence);
    await hub.flushNext(firstChannel, "occurrence");
    expect(showOsNotification).not.toHaveBeenCalled();
    firstBridge.dispose();
    await Promise.resolve();
    expect(secondCoordinator.isExternalDeliveryOwner()).toBe(false);
    await hub.flushNext(secondChannel, "external_delivery_claimed");
    await hub.flushNext(firstChannel, "external_delivery_claim_ack");
    await waitFor(() => showOsNotification.mock.calls.length === 1);
    await waitFor(() => secondCoordinator.isExternalDeliveryOwner());
    releaseDelivery();
    const results = await Promise.allSettled(dispatches);

    expect(showOsNotification).toHaveBeenCalledTimes(1);
    expect(playSound).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(locks.heldCount(EXTERNAL_DELIVERY_LOCK_NAME)).toBe(1);
    secondBridge.dispose();
  });

  test("finishes claim propagation when an unresponsive tab exits", async () => {
    const locks = new FakeLockManager();
    const hub = new FakeBroadcastHub(false);
    let ownerChannel!: FakeBroadcastChannel;
    let recipientChannel!: FakeBroadcastChannel;
    const owner = createBrowserNotificationCoordinator({
      createChannel: () => {
        ownerChannel = hub.createChannel();
        return ownerChannel;
      },
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
      tabId: "owner",
    });
    const recipient = createBrowserNotificationCoordinator({
      createChannel: () => {
        recipientChannel = hub.createChannel();
        return recipientChannel;
      },
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
      tabId: "recipient",
    });
    let claims = 0;
    owner.subscribeOccurrences((value) => {
      void owner.claimExternalDelivery(value.occurrenceId).then((externalOwner) => {
        if (externalOwner) claims += 1;
      });
    });
    await waitFor(() => owner.isExternalDeliveryOwner());

    recipient.publishOccurrence(occurrence);
    await hub.flushNext(ownerChannel, "occurrence");
    expect(claims).toBe(0);
    recipient.dispose();
    await waitFor(() => claims === 1);

    expect(claims).toBe(1);
    owner.dispose();
  });

  test("does not redeliver when the next owner receives an occurrence after claim starts", async () => {
    const locks = new FakeLockManager();
    const hub = new FakeBroadcastHub(false);
    let firstChannel!: FakeBroadcastChannel;
    let nextOwnerChannel!: FakeBroadcastChannel;
    let publisherChannel!: FakeBroadcastChannel;
    const firstCoordinator = createBrowserNotificationCoordinator({
      createChannel: () => {
        firstChannel = hub.createChannel();
        return firstChannel;
      },
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
      tabId: "first",
    });
    const nextOwnerCoordinator = createBrowserNotificationCoordinator({
      createChannel: () => {
        nextOwnerChannel = hub.createChannel();
        return nextOwnerChannel;
      },
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
      tabId: "next-owner",
    });
    const publisherCoordinator = createBrowserNotificationCoordinator({
      createChannel: () => {
        publisherChannel = hub.createChannel();
        return publisherChannel;
      },
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
      tabId: "publisher",
    });
    const firstBridge = createBrowserNotificationBridge({
      NativeNotification: null,
      coordinator: firstCoordinator,
      focusWindow: () => {},
    });
    const nextOwnerBridge = createBrowserNotificationBridge({
      NativeNotification: null,
      coordinator: nextOwnerCoordinator,
      focusWindow: () => {},
    });
    const publisherBridge = createBrowserNotificationBridge({
      NativeNotification: null,
      coordinator: publisherCoordinator,
      focusWindow: () => {},
    });
    let releaseDelivery = (): void => {};
    const pendingDelivery = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    const showOsNotification = mock(async () => pendingDelivery);
    const playSound = mock(async () => pendingDelivery);
    const dispatches: Promise<void>[] = [];
    const subscribe = (bridge: ReturnType<typeof createBrowserNotificationBridge>): void => {
      bridge.subscribeOccurrences((value) => {
        const dispatch = bridge.withExternalDeliveryOwnership(value.occurrenceId, async (owner) => {
          if (!owner) return;
          await Promise.all([showOsNotification(), playSound()]);
        });
        dispatches.push(dispatch);
        void dispatch.catch(() => {});
      });
    };
    subscribe(firstBridge);
    subscribe(nextOwnerBridge);
    subscribe(publisherBridge);
    await waitFor(() => firstCoordinator.isExternalDeliveryOwner());

    publisherBridge.publishOccurrence(occurrence);
    await hub.flushNext(firstChannel, "occurrence");
    await hub.flushNext(publisherChannel, "external_delivery_claimed");
    await hub.flushNext(firstChannel, "external_delivery_claim_ack");
    expect(showOsNotification).not.toHaveBeenCalled();
    await hub.flushNext(nextOwnerChannel, "occurrence");
    firstBridge.dispose();
    await Promise.resolve();
    expect(nextOwnerCoordinator.isExternalDeliveryOwner()).toBe(false);
    await hub.flushNext(nextOwnerChannel, "external_delivery_claimed");
    await hub.flushNext(firstChannel, "external_delivery_claim_ack");
    await waitFor(() => showOsNotification.mock.calls.length === 1);
    await waitFor(() => nextOwnerCoordinator.isExternalDeliveryOwner());
    releaseDelivery();
    const results = await Promise.allSettled(dispatches);

    expect(showOsNotification).toHaveBeenCalledTimes(1);
    expect(playSound).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    nextOwnerBridge.dispose();
    publisherBridge.dispose();
  });

  test("does not admit a channel before its tab registration is visible", async () => {
    const locks = new FakeLockManager();
    const hub = new FakeBroadcastHub(false);
    let ownerChannel!: FakeBroadcastChannel;
    let publisherChannel!: FakeBroadcastChannel;
    let joiningChannel: FakeBroadcastChannel | undefined;
    const joiningTabLockName = `${TAB_LOCK_NAME_PREFIX}joining`;
    locks.defer(joiningTabLockName);
    const ownerCoordinator = createBrowserNotificationCoordinator({
      createChannel: () => {
        ownerChannel = hub.createChannel();
        return ownerChannel;
      },
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
      tabId: "owner",
    });
    const publisherCoordinator = createBrowserNotificationCoordinator({
      createChannel: () => {
        publisherChannel = hub.createChannel();
        return publisherChannel;
      },
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
      tabId: "publisher",
    });
    const joiningCoordinator = createBrowserNotificationCoordinator({
      createChannel: () => {
        joiningChannel = hub.createChannel();
        return joiningChannel;
      },
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
      tabId: "joining",
    });
    const ownerBridge = createBrowserNotificationBridge({
      NativeNotification: null,
      coordinator: ownerCoordinator,
      focusWindow: () => {},
    });
    const publisherBridge = createBrowserNotificationBridge({
      NativeNotification: null,
      coordinator: publisherCoordinator,
      focusWindow: () => {},
    });
    const joiningBridge = createBrowserNotificationBridge({
      NativeNotification: null,
      coordinator: joiningCoordinator,
      focusWindow: () => {},
    });
    const showOsNotification = mock(async () => {});
    const playSound = mock(async () => {});
    const dispatches: Promise<void>[] = [];
    const subscribe = (bridge: ReturnType<typeof createBrowserNotificationBridge>): void => {
      bridge.subscribeOccurrences((value) => {
        const dispatch = bridge.withExternalDeliveryOwnership(value.occurrenceId, async (owner) => {
          if (!owner) return;
          await Promise.all([showOsNotification(), playSound()]);
        });
        dispatches.push(dispatch);
        void dispatch.catch(() => {});
      });
    };
    subscribe(ownerBridge);
    subscribe(publisherBridge);
    subscribe(joiningBridge);
    await waitFor(() => ownerCoordinator.isExternalDeliveryOwner());
    expect(joiningChannel).toBeUndefined();
    expect(hub.channels.size).toBe(2);

    publisherBridge.publishOccurrence(occurrence);
    await hub.flushNext(ownerChannel, "occurrence");
    await hub.flushNext(publisherChannel, "external_delivery_claimed");
    await hub.flushNext(ownerChannel, "external_delivery_claim_ack");
    await waitFor(() => showOsNotification.mock.calls.length === 1);
    locks.admit(joiningTabLockName);
    await waitFor(() => locks.heldCount(joiningTabLockName) === 1);
    expect(joiningChannel).toBeDefined();
    ownerBridge.dispose();
    await waitFor(() => publisherCoordinator.isExternalDeliveryOwner());
    publisherBridge.dispose();
    await waitFor(() => joiningCoordinator.isExternalDeliveryOwner());
    await Promise.allSettled(dispatches);

    expect(showOsNotification).toHaveBeenCalledTimes(1);
    expect(playSound).toHaveBeenCalledTimes(1);
    joiningBridge.dispose();
  });

  test("recovers from a lock snapshot failure on the next successful claim", async () => {
    const locks = new FakeLockManager();
    const hub = new FakeBroadcastHub();
    const owner = createBrowserNotificationCoordinator({
      createChannel: () => hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });
    const publisher = createBrowserNotificationCoordinator({
      createChannel: () => hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });
    let claimFailure: unknown;
    let deliveries = 0;
    owner.subscribeOccurrences((value) => {
      void owner
        .claimExternalDelivery(value.occurrenceId)
        .then((externalOwner) => {
          if (externalOwner) deliveries += 1;
        })
        .catch((cause: unknown) => {
          claimFailure = cause;
        });
    });
    await waitFor(() => owner.isExternalDeliveryOwner());
    locks.rejectNextQuery(new Error("Lock snapshot failed."));

    publisher.publishOccurrence(occurrence);
    await waitFor(() => claimFailure !== undefined);

    expect(deliveries).toBe(0);
    expect(claimFailure).toEqual(new Error("Lock snapshot failed."));
    expect(owner.getFailureMessage()).toBe("Lock snapshot failed.");

    publisher.publishOccurrence({
      ...occurrence,
      occurrenceId: `${occurrence.occurrenceId}:retry`,
    });
    await waitFor(() => deliveries === 1);

    expect(owner.getFailureMessage()).toBeNull();
    owner.dispose();
    publisher.dispose();
  });

  test("reports focus as unavailable after focus lock failure", async () => {
    const locks = new FakeLockManager();
    locks.rejectNextRequest(APP_FOCUS_LOCK_NAME, new Error("Focus lock failed."));
    const hub = new FakeBroadcastHub();
    const owner = createBrowserNotificationCoordinator({
      createChannel: () => hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => true },
      focusWindow: new FakeFocusWindow(),
    });
    const publisher = createBrowserNotificationCoordinator({
      createChannel: () => hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });
    let deliveries = 0;
    owner.subscribeOccurrences((value) => {
      void owner.claimExternalDelivery(value.occurrenceId).then((externalOwner) => {
        if (externalOwner) deliveries += 1;
      });
    });
    await waitFor(() => owner.getFailureMessage() === "Focus lock failed.");
    await waitFor(() => owner.isExternalDeliveryOwner());

    publisher.publishOccurrence({
      ...occurrence,
      occurrenceId: `${occurrence.occurrenceId}:focus-lock-failure`,
    });
    await waitFor(() => deliveries === 1);

    await expect(owner.isAnyTabFocused()).rejects.toThrow("Focus lock failed.");
    expect(owner.getFailureMessage()).toBe("Focus lock failed.");
    owner.dispose();
    publisher.dispose();
  });

  test("uses one live external delivery lock for many occurrences", async () => {
    const locks = new FakeLockManager();
    const hub = new FakeBroadcastHub();
    const owner = createBrowserNotificationCoordinator({
      createChannel: () => hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });
    const publisher = createBrowserNotificationCoordinator({
      createChannel: () => hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });
    const received: NotificationOccurrence[] = [];
    owner.subscribeOccurrences((value) => {
      void owner.claimExternalDelivery(value.occurrenceId).then((externalOwner) => {
        if (externalOwner) received.push(value);
      });
    });
    await waitFor(() => owner.isExternalDeliveryOwner());

    for (let index = 0; index < 100; index += 1) {
      publisher.publishOccurrence({
        ...occurrence,
        occurrenceId: `${occurrence.occurrenceId}:${index}`,
      });
    }
    await waitFor(() => received.length === 100);

    expect(received).toHaveLength(100);
    expect(locks.heldCount(EXTERNAL_DELIVERY_LOCK_NAME)).toBe(1);
    owner.dispose();
    publisher.dispose();
  });

  test("counts any focused tab and releases focus on blur", async () => {
    const locks = new FakeLockManager();
    const hub = new FakeBroadcastHub();
    let focused = true;
    const focusWindow = new FakeFocusWindow();
    const first = createBrowserNotificationCoordinator({
      createChannel: () => hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => focused },
      focusWindow,
    });
    const second = createBrowserNotificationCoordinator({
      createChannel: () => hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });

    await waitForAsync(() => second.isAnyTabFocused());
    expect(await second.isAnyTabFocused()).toBe(true);
    focused = false;
    focusWindow.emit("blur");
    await waitForAsync(async () => !(await second.isAnyTabFocused()));
    expect(await second.isAnyTabFocused()).toBe(false);

    first.dispose();
    second.dispose();
    expect(hub.channels.size).toBe(0);
  });
});
