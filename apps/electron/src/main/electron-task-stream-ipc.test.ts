import { describe, expect, mock, test } from "bun:test";
import type { TaskEventStreamFrame, TaskEventStreamSubscribe } from "@openducktor/contracts";
import {
  ELECTRON_TASK_STREAM_ACKNOWLEDGE_CHANNEL,
  ELECTRON_TASK_STREAM_FRAME_CHANNEL,
  ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL,
  ELECTRON_TASK_STREAM_TERMINAL_FAILURE_CHANNEL,
  ELECTRON_TASK_STREAM_UNSUBSCRIBE_CHANNEL,
} from "../shared/electron-bridge-contract";
import {
  type ElectronTaskStreamEvent,
  type ElectronTaskStreamIpcHandler,
  type ElectronTaskStreamIpcOptions,
  registerElectronTaskStreamIpc,
} from "./electron-task-stream-ipc";

const epoch = "11111111-1111-4111-8111-111111111111";
const subscriptionId = "22222222-2222-4222-8222-222222222222";
const secondSubscriptionId = "33333333-3333-4333-8333-333333333333";
const frame: TaskEventStreamFrame = {
  type: "snapshot_required",
  cursor: { epoch, sequence: 0 },
  reason: "buffer_gap",
};

type Handler = ElectronTaskStreamIpcHandler;
type NavigationDetails = { isMainFrame: boolean; isSameDocument: boolean };
type LifecycleListener = () => void;
type NavigationListener = (details: NavigationDetails) => void;

const createFrame = (processId: number, routingId: number, send = mock(() => {})) => ({
  processId,
  routingId,
  isDestroyed: mock(() => false),
  send,
});

const createSender = (id: number, frameSend = mock(() => {})) => {
  const lifecycleListeners = new Map<string, Set<LifecycleListener>>();
  const navigationListeners = new Map<string, Set<NavigationListener>>();
  const addLifecycleListener = (event: string, listener: LifecycleListener) => {
    const eventListeners = lifecycleListeners.get(event) ?? new Set();
    eventListeners.add(listener);
    lifecycleListeners.set(event, eventListeners);
  };
  const addNavigationListener = (event: string, listener: NavigationListener) => {
    const eventListeners = navigationListeners.get(event) ?? new Set();
    eventListeners.add(listener);
    navigationListeners.set(event, eventListeners);
  };
  let mainFrame = createFrame(id, id * 10, frameSend);
  const sender = {
    get mainFrame() {
      return mainFrame;
    },
    isDestroyed: mock(() => false),
    off: mock((event: string, listener: LifecycleListener | NavigationListener) => {
      for (const candidate of lifecycleListeners.get(event) ?? []) {
        if (candidate === listener) lifecycleListeners.get(event)?.delete(candidate);
      }
      for (const candidate of navigationListeners.get(event) ?? []) {
        if (candidate === listener) navigationListeners.get(event)?.delete(candidate);
      }
    }),
    on: mock((event: string, listener: NavigationListener) =>
      addNavigationListener(event, listener),
    ),
    once: mock((event: string, listener: LifecycleListener) =>
      addLifecycleListener(event, listener),
    ),
    send: mock(() => {}),
  };
  return {
    sender,
    get mainFrame() {
      return mainFrame;
    },
    emitLifecycle(event: "destroyed" | "render-process-gone") {
      // oxlint-disable-next-line unicorn/no-useless-spread -- match EventEmitter snapshot behavior
      for (const listener of [...(lifecycleListeners.get(event) ?? [])]) {
        listener();
      }
    },
    emitNavigation(details: NavigationDetails) {
      // oxlint-disable-next-line unicorn/no-useless-spread -- match EventEmitter snapshot behavior
      for (const listener of [...(navigationListeners.get("did-start-navigation") ?? [])]) {
        listener(details);
      }
    },
    listenerCount(event: string) {
      return (
        (lifecycleListeners.get(event)?.size ?? 0) + (navigationListeners.get(event)?.size ?? 0)
      );
    },
    replaceMainFrame(nextFrame: ReturnType<typeof createFrame>) {
      mainFrame = nextFrame;
    },
  };
};

const eventFor = (sender: ReturnType<typeof createSender>, senderFrame = sender.mainFrame) => ({
  frameId: senderFrame.routingId,
  processId: senderFrame.processId,
  sender: sender.sender,
  senderFrame,
});

const createHarness = (subscriptionIds = [subscriptionId]) => {
  const handlers = new Map<string, Handler>();
  const unsubscribe = mock(() => {});
  const acknowledge = mock(() => {});
  const sinks: Array<(received: TaskEventStreamFrame) => void> = [];
  const stream: ElectronTaskStreamIpcOptions["taskEventStream"] = {
    acknowledge,
    publish: mock(() => {}),
    subscribe: mock(
      (_input: TaskEventStreamSubscribe, sink: (received: TaskEventStreamFrame) => void) => {
        const index = sinks.push(sink) - 1;
        const currentSubscriptionId = subscriptionIds[index];
        if (!currentSubscriptionId) {
          throw new Error(`Missing subscription ID for stream ${index}.`);
        }
        return { subscriptionId: currentSubscriptionId, unsubscribe };
      },
    ),
  };
  const reportDeliveryFailure = mock(() => {});
  registerElectronTaskStreamIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    reportDeliveryFailure,
    taskEventStream: stream,
  });
  const invoke = (channel: string, event: ElectronTaskStreamEvent, value: unknown) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for ${channel}.`);
    return handler(event, value);
  };
  return {
    acknowledge,
    invoke,
    reportDeliveryFailure,
    sink: (index = 0) => sinks[index],
    unsubscribe,
  };
};

describe("electron task stream IPC", () => {
  test("rejects malformed input at the raw IPC boundary", () => {
    const harness = createHarness();
    const owner = createSender(1);

    expect(() =>
      harness.invoke(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, eventFor(owner), null),
    ).toThrow("Electron task stream IPC payload is invalid.");
  });

  test("authorizes ACK and unsubscribe by sender and document IDs, not frame wrapper identity", () => {
    const harness = createHarness();
    const owner = createSender(1);
    const otherWindow = createSender(2);
    harness.invoke(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, eventFor(owner), { cursor: null });

    harness.invoke(ELECTRON_TASK_STREAM_ACKNOWLEDGE_CHANNEL, eventFor(owner, createFrame(1, 10)), {
      cursor: frame.cursor,
      subscriptionId,
    });
    expect(harness.acknowledge).toHaveBeenCalledTimes(1);
    expect(() =>
      harness.invoke(
        ELECTRON_TASK_STREAM_ACKNOWLEDGE_CHANNEL,
        { ...eventFor(owner), senderFrame: null },
        { cursor: frame.cursor, subscriptionId },
      ),
    ).toThrow("active main frame");
    expect(() =>
      harness.invoke(ELECTRON_TASK_STREAM_ACKNOWLEDGE_CHANNEL, eventFor(otherWindow), {
        cursor: frame.cursor,
        subscriptionId,
      }),
    ).toThrow("belong to their creating renderer frame");
    expect(() =>
      harness.invoke(
        ELECTRON_TASK_STREAM_ACKNOWLEDGE_CHANNEL,
        eventFor(owner, createFrame(1, 11)),
        { cursor: frame.cursor, subscriptionId },
      ),
    ).toThrow("active main frame");

    owner.mainFrame.processId = 3;
    owner.mainFrame.routingId = 30;
    expect(() =>
      harness.invoke(ELECTRON_TASK_STREAM_UNSUBSCRIBE_CHANNEL, eventFor(owner), { subscriptionId }),
    ).toThrow("belong to their creating renderer frame");
    harness.sink()?.(frame);
    expect(harness.reportDeliveryFailure).toHaveBeenCalledWith({
      cause: expect.objectContaining({ operation: "electron.task-stream.delivery.owner" }),
      subscriptionId,
    });
  });

  test("keeps separate subscription ownership for each window", () => {
    const harness = createHarness([subscriptionId, secondSubscriptionId]);
    const first = createSender(1);
    const second = createSender(2);
    harness.invoke(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, eventFor(first), { cursor: null });
    harness.invoke(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, eventFor(second), { cursor: null });
    harness.invoke(ELECTRON_TASK_STREAM_ACKNOWLEDGE_CHANNEL, eventFor(first), {
      cursor: frame.cursor,
      subscriptionId,
    });
    harness.invoke(ELECTRON_TASK_STREAM_ACKNOWLEDGE_CHANNEL, eventFor(second), {
      cursor: frame.cursor,
      subscriptionId: secondSubscriptionId,
    });

    expect(harness.acknowledge).toHaveBeenCalledTimes(2);
  });

  test("delivers only through the owning frame, never the sender or successor main frame", () => {
    const harness = createHarness();
    const owner = createSender(1);
    const owningFrame = owner.mainFrame;
    const successorFrame = createFrame(2, 20);
    harness.invoke(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, eventFor(owner), { cursor: null });
    owner.replaceMainFrame(successorFrame);
    harness.sink()?.(frame);

    expect(owningFrame.send).toHaveBeenCalledWith(ELECTRON_TASK_STREAM_FRAME_CHANNEL, {
      frame,
      subscriptionId,
    });
    expect(successorFrame.send).not.toHaveBeenCalled();
    expect(owner.sender.send).not.toHaveBeenCalled();
  });

  test("does not deliver after the owning frame's document identity changes", () => {
    const harness = createHarness();
    const owner = createSender(1);
    harness.invoke(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, eventFor(owner), { cursor: null });
    owner.mainFrame.processId = 2;
    owner.mainFrame.routingId = 20;
    harness.sink()?.(frame);

    expect(owner.mainFrame.send).not.toHaveBeenCalled();
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("cleans all sender subscriptions exactly once for cross-document main-frame navigation", () => {
    const harness = createHarness([subscriptionId, secondSubscriptionId]);
    const owner = createSender(1);
    const successorFrame = createFrame(2, 20);
    harness.invoke(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, eventFor(owner), { cursor: null });
    harness.invoke(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, eventFor(owner), { cursor: null });

    owner.emitNavigation({ isMainFrame: true, isSameDocument: false });
    owner.replaceMainFrame(successorFrame);
    owner.emitNavigation({ isMainFrame: true, isSameDocument: false });

    expect(harness.unsubscribe).toHaveBeenCalledTimes(2);
    expect(owner.listenerCount("destroyed")).toBe(0);
    expect(owner.listenerCount("render-process-gone")).toBe(0);
    expect(owner.listenerCount("did-start-navigation")).toBe(0);
    harness.sink(0)?.(frame);
    harness.sink(1)?.(frame);
    expect(successorFrame.send).not.toHaveBeenCalled();
  });

  test("retains subscriptions during same-document navigation", () => {
    const harness = createHarness();
    const owner = createSender(1);
    harness.invoke(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, eventFor(owner), { cursor: null });

    owner.emitNavigation({ isMainFrame: true, isSameDocument: true });
    harness.sink()?.(frame);

    expect(harness.unsubscribe).not.toHaveBeenCalled();
    expect(owner.mainFrame.send).toHaveBeenCalledTimes(1);
  });

  test("removes sender lifecycle listeners after explicit unsubscribe", () => {
    const harness = createHarness();
    const owner = createSender(1);
    harness.invoke(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, eventFor(owner), { cursor: null });
    harness.invoke(ELECTRON_TASK_STREAM_UNSUBSCRIBE_CHANNEL, eventFor(owner), { subscriptionId });

    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
    expect(owner.listenerCount("destroyed")).toBe(0);
    expect(owner.listenerCount("render-process-gone")).toBe(0);
    expect(owner.listenerCount("did-start-navigation")).toBe(0);
  });

  test("cleans up exactly once on destroyed or render-process-gone", () => {
    for (const lifecycleEvent of ["destroyed", "render-process-gone"] as const) {
      const harness = createHarness();
      const owner = createSender(1);
      harness.invoke(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, eventFor(owner), { cursor: null });
      owner.emitLifecycle(lifecycleEvent);
      owner.emitLifecycle(lifecycleEvent);

      expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
      expect(owner.listenerCount("destroyed")).toBe(0);
      expect(owner.listenerCount("render-process-gone")).toBe(0);
      expect(owner.listenerCount("did-start-navigation")).toBe(0);
    }
  });

  test("reports and detaches only a subscription whose frame send races destruction", () => {
    const sendFailure = new Error("destroyed during send");
    const harness = createHarness();
    const failing = createSender(
      1,
      mock(() => {
        throw sendFailure;
      }),
    );
    harness.invoke(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, eventFor(failing), { cursor: null });
    harness.sink()?.(frame);

    expect(harness.reportDeliveryFailure).toHaveBeenCalledWith({
      cause: sendFailure,
      subscriptionId,
    });
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("notifies the owning renderer when an outbound frame is invalid", () => {
    const harness = createHarness();
    const owner = createSender(1);
    harness.invoke(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, eventFor(owner), { cursor: null });

    // SAFETY: This negative test sends a deliberately malformed frame to the runtime validation boundary.
    const malformedFrame = { type: "change" } as TaskEventStreamFrame;
    harness.sink()?.(malformedFrame);

    expect(owner.mainFrame.send).toHaveBeenCalledWith(
      ELECTRON_TASK_STREAM_TERMINAL_FAILURE_CHANNEL,
      {
        message: "Task stream produced an invalid frame.",
        subscriptionId,
      },
    );
    expect(harness.reportDeliveryFailure).toHaveBeenCalledWith({
      cause: expect.objectContaining({ operation: "electron.task-stream.delivery.validate" }),
      subscriptionId,
    });
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("continues delivery to other windows after one subscription send fails", () => {
    const harness = createHarness([subscriptionId, secondSubscriptionId]);
    const first = createSender(
      1,
      mock(() => {
        throw new Error("destroyed during send");
      }),
    );
    const second = createSender(2);
    harness.invoke(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, eventFor(first), { cursor: null });
    harness.invoke(ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL, eventFor(second), { cursor: null });

    harness.sink(0)?.(frame);
    harness.sink(1)?.(frame);

    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
    expect(second.mainFrame.send).toHaveBeenCalledWith(ELECTRON_TASK_STREAM_FRAME_CHANNEL, {
      frame,
      subscriptionId: secondSubscriptionId,
    });
    expect(harness.reportDeliveryFailure).toHaveBeenCalledTimes(1);
  });
});
