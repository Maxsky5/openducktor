import { describe, expect, test } from "bun:test";
import type { NotificationOccurrence } from "@openducktor/contracts";
import { createBrowserNotificationCoordinator } from "./browser-notification-coordinator";

type CoordinatorMessage =
  | { type: "occurrence"; occurrence: NotificationOccurrence }
  | { type: "external_delivery_complete"; occurrenceId: string };

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

  constructor(private paused = false) {}

  request(
    name: string,
    options: { mode: "exclusive" | "shared"; signal?: AbortSignal },
    callback: (lock: { name: string }) => Promise<void>,
  ): Promise<void> {
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
          const index = this.requests.indexOf(request);
          if (index >= 0) {
            this.requests.splice(index, 1);
          }
          reject(new DOMException("Aborted", "AbortError"));
        }
      });
      this.requests.push(request);
      this.drain(name);
    });
  }

  async query(): Promise<{ held: Array<{ name: string }> }> {
    return {
      held: this.requests
        .filter((request) => request.active)
        .map((request) => ({ name: request.name })),
    };
  }

  resume(): void {
    this.paused = false;
    for (const name of new Set(this.requests.map((request) => request.name))) {
      this.drain(name);
    }
  }

  heldCount(): number {
    return this.requests.filter((request) => request.active).length;
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
    const ready =
      next.mode === "shared" ? pending.filter((request) => request.mode === "shared") : [next];
    for (const request of ready) {
      request.active = true;
      void request.callback({ name: request.name }).then(
        () => {
          const index = this.requests.indexOf(request);
          if (index >= 0) {
            this.requests.splice(index, 1);
          }
          request.resolve();
          this.drain(name);
        },
        (cause) => request.reject(cause instanceof Error ? cause : new Error(String(cause))),
      );
    }
    this.drain(name);
  }
}

class FakeBroadcastHub {
  readonly channels = new Set<FakeBroadcastChannel>();

  createChannel(): FakeBroadcastChannel {
    const channel = new FakeBroadcastChannel(this);
    this.channels.add(channel);
    return channel;
  }
}

class FakeBroadcastChannel {
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

  constructor(private readonly hub: FakeBroadcastHub) {}

  postMessage(value: CoordinatorMessage): void {
    for (const channel of this.hub.channels) {
      if (channel !== this) {
        channel.emit(value);
      }
    }
  }

  addEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener);
  }

  close(): void {
    this.hub.channels.delete(this);
    this.listeners.clear();
  }

  private emit(value: CoordinatorMessage): void {
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

describe("browser notification coordinator", () => {
  test("delivers an occurrence once when leadership starts after publication", async () => {
    const locks = new FakeLockManager(true);
    const hub = new FakeBroadcastHub();
    const first = createBrowserNotificationCoordinator({
      channel: hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });
    const second = createBrowserNotificationCoordinator({
      channel: hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });
    const received: NotificationOccurrence[] = [];
    first.subscribeOccurrences((value) => {
      if (!first.isExternalDeliveryOwner()) return;
      received.push(value);
      first.completeExternalDelivery(value.occurrenceId);
    });

    second.publishOccurrence(occurrence);
    expect(received).toEqual([]);
    locks.resume();
    await waitFor(() => received.length === 1);

    expect(received).toEqual([occurrence]);
    expect(locks.heldCount()).toBe(1);
    first.dispose();
    second.dispose();
  });

  test("replays an occurrence published during owner handoff", async () => {
    const locks = new FakeLockManager();
    const hub = new FakeBroadcastHub();
    const first = createBrowserNotificationCoordinator({
      channel: hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });
    const second = createBrowserNotificationCoordinator({
      channel: hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });
    await waitFor(() => first.isExternalDeliveryOwner());
    const received: NotificationOccurrence[] = [];
    second.subscribeOccurrences((value) => {
      received.push(value);
      second.completeExternalDelivery(value.occurrenceId);
    });

    first.dispose();
    second.publishOccurrence(occurrence);
    await waitFor(() => received.length === 1);

    expect(received).toEqual([occurrence]);
    expect(second.isExternalDeliveryOwner()).toBe(true);
    second.dispose();
  });

  test("uses one live external delivery lock for many occurrences", async () => {
    const locks = new FakeLockManager();
    const hub = new FakeBroadcastHub();
    const owner = createBrowserNotificationCoordinator({
      channel: hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });
    const publisher = createBrowserNotificationCoordinator({
      channel: hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => false },
      focusWindow: new FakeFocusWindow(),
    });
    const received: NotificationOccurrence[] = [];
    owner.subscribeOccurrences((value) => {
      received.push(value);
      owner.completeExternalDelivery(value.occurrenceId);
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
    expect(locks.heldCount()).toBe(1);
    owner.dispose();
    publisher.dispose();
  });

  test("counts any focused tab and releases focus on blur", async () => {
    const locks = new FakeLockManager();
    const hub = new FakeBroadcastHub();
    let focused = true;
    const focusWindow = new FakeFocusWindow();
    const first = createBrowserNotificationCoordinator({
      channel: hub.createChannel(),
      locks,
      focusDocument: { hasFocus: () => focused },
      focusWindow,
    });
    const second = createBrowserNotificationCoordinator({
      channel: hub.createChannel(),
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
