import { describe, expect, mock, test } from "bun:test";
import type { TaskEventStreamFrame } from "@openducktor/contracts";
import {
  ELECTRON_TASK_STREAM_ACKNOWLEDGE_CHANNEL,
  ELECTRON_TASK_STREAM_FRAME_CHANNEL,
  ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL,
  ELECTRON_TASK_STREAM_TERMINAL_FAILURE_CHANNEL,
  ELECTRON_TASK_STREAM_UNSUBSCRIBE_CHANNEL,
} from "../shared/electron-bridge-contract";
import { createElectronTaskStreamApi } from "./electron-task-stream-ipc";

const frame: TaskEventStreamFrame = {
  type: "snapshot_required",
  cursor: { epoch: "11111111-1111-4111-8111-111111111111", sequence: 0 },
  reason: "buffer_gap",
};
const subscriptionId = "22222222-2222-4222-8222-222222222222";
const secondSubscriptionId = "33333333-3333-4333-8333-333333333333";

describe("Electron preload task stream API", () => {
  test("registers the frame listener before subscribe and delivers an early snapshot exactly once", async () => {
    let frameListener: ((event: unknown, value: unknown) => void) | undefined;
    let frameListenerRegistered = false;
    const off = mock(() => {});
    const invoke = mock(async (channel: string) => {
      if (channel === ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL) {
        if (!frameListenerRegistered)
          throw new Error("Frame listener was not registered before subscribe.");
        frameListener?.({}, { frame, subscriptionId });
        return { subscriptionId };
      }
    });
    const on = mock((channel: string, next: (event: unknown, value: unknown) => void) => {
      if (channel === ELECTRON_TASK_STREAM_FRAME_CHANNEL) {
        frameListener = next;
        frameListenerRegistered = true;
      }
    });
    const receive = mock(() => {});
    const api = createElectronTaskStreamApi({ invoke, off, on });

    const subscription = await api.subscribe({ cursor: null }, receive);

    expect(on).toHaveBeenCalledTimes(2);
    expect(receive).toHaveBeenCalledTimes(1);
    expect(receive).toHaveBeenCalledWith(frame);
    await subscription.acknowledge(frame.cursor);
    await subscription.unsubscribe();
    expect(invoke).toHaveBeenCalledWith(ELECTRON_TASK_STREAM_ACKNOWLEDGE_CHANNEL, {
      cursor: frame.cursor,
      subscriptionId,
    });
    expect(invoke).toHaveBeenCalledWith(ELECTRON_TASK_STREAM_UNSUBSCRIBE_CHANNEL, {
      subscriptionId,
    });
    expect(off).toHaveBeenCalledWith(ELECTRON_TASK_STREAM_FRAME_CHANNEL, frameListener);
  });

  test("scopes buffered and live frames to concurrent subscriptions on one renderer channel", async () => {
    const listeners = new Map<string, Set<(event: unknown, value: unknown) => void>>();
    const resolveSubscriptions: Array<(value: { subscriptionId: string }) => void> = [];
    const invoke = mock((channel: string) => {
      if (channel !== ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL) return Promise.resolve(undefined);
      return new Promise<{ subscriptionId: string }>((resolve) => {
        resolveSubscriptions.push(resolve);
      });
    });
    const on = mock((channel: string, listener: (event: unknown, value: unknown) => void) => {
      const channelListeners = listeners.get(channel) ?? new Set();
      channelListeners.add(listener);
      listeners.set(channel, channelListeners);
    });
    const off = mock((channel: string, listener: (event: unknown, value: unknown) => void) => {
      listeners.get(channel)?.delete(listener);
    });
    const firstListener = mock(() => {});
    const secondListener = mock(() => {});
    const secondFrame: TaskEventStreamFrame = {
      ...frame,
      cursor: { ...frame.cursor, sequence: 1 },
    };
    const api = createElectronTaskStreamApi({ invoke, off, on });
    const firstSubscription = api.subscribe({ cursor: null }, firstListener);
    const secondSubscription = api.subscribe({ cursor: null }, secondListener);
    const dispatch = (value: unknown): void => {
      for (const listener of listeners.get(ELECTRON_TASK_STREAM_FRAME_CHANNEL) ?? []) {
        listener({}, value);
      }
    };

    dispatch({ frame, subscriptionId });
    dispatch({ frame: secondFrame, subscriptionId: secondSubscriptionId });
    resolveSubscriptions[0]?.({ subscriptionId });
    const first = await firstSubscription;
    resolveSubscriptions[1]?.({ subscriptionId: secondSubscriptionId });
    const second = await secondSubscription;

    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(firstListener).toHaveBeenCalledWith(frame);
    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledWith(secondFrame);

    dispatch({ frame, subscriptionId });
    dispatch({ frame: secondFrame, subscriptionId: secondSubscriptionId });

    expect(firstListener).toHaveBeenCalledTimes(2);
    expect(secondListener).toHaveBeenCalledTimes(2);
    await first.unsubscribe();
    await second.unsubscribe();
  });

  test("reports a matching terminal failure once and closes locally without main unsubscribe", async () => {
    const listeners = new Map<string, Set<(event: unknown, value: unknown) => void>>();
    const invoke = mock(async (channel: string) =>
      channel === ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL ? { subscriptionId } : undefined,
    );
    const on = mock((channel: string, listener: (event: unknown, value: unknown) => void) => {
      const channelListeners = listeners.get(channel) ?? new Set();
      channelListeners.add(listener);
      listeners.set(channel, channelListeners);
    });
    const off = mock((channel: string, listener: (event: unknown, value: unknown) => void) => {
      listeners.get(channel)?.delete(listener);
    });
    const onTerminalFailure = mock((_error: unknown) => {});
    const api = createElectronTaskStreamApi({ invoke, off, on });
    const subscription = await api.subscribe({ cursor: null }, () => {}, onTerminalFailure);
    const dispatch = (channel: string, value: unknown): void => {
      for (const listener of listeners.get(channel) ?? []) listener({}, value);
    };

    dispatch(ELECTRON_TASK_STREAM_TERMINAL_FAILURE_CHANNEL, {
      message: "Task stream delivery failed.",
      subscriptionId,
    });
    dispatch(ELECTRON_TASK_STREAM_TERMINAL_FAILURE_CHANNEL, {
      message: "Task stream delivery failed again.",
      subscriptionId,
    });
    await subscription.unsubscribe();

    expect(onTerminalFailure).toHaveBeenCalledTimes(1);
    expect(onTerminalFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Task stream delivery failed." }),
    );
    expect(off).toHaveBeenCalledWith(ELECTRON_TASK_STREAM_FRAME_CHANNEL, expect.any(Function));
    expect(off).toHaveBeenCalledWith(
      ELECTRON_TASK_STREAM_TERMINAL_FAILURE_CHANNEL,
      expect.any(Function),
    );
    expect(invoke).not.toHaveBeenCalledWith(ELECTRON_TASK_STREAM_UNSUBSCRIBE_CHANNEL, {
      subscriptionId,
    });
  });

  test("rejects an early matching terminal failure and ignores unrelated subscriptions", async () => {
    const listeners = new Map<string, Set<(event: unknown, value: unknown) => void>>();
    let resolveSubscribe!: (value: { subscriptionId: string }) => void;
    const invoke = mock((channel: string) => {
      if (channel !== ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL) return Promise.resolve(undefined);
      return new Promise<{ subscriptionId: string }>((resolve) => {
        resolveSubscribe = resolve;
      });
    });
    const on = mock((channel: string, listener: (event: unknown, value: unknown) => void) => {
      const channelListeners = listeners.get(channel) ?? new Set();
      channelListeners.add(listener);
      listeners.set(channel, channelListeners);
    });
    const off = mock((channel: string, listener: (event: unknown, value: unknown) => void) => {
      listeners.get(channel)?.delete(listener);
    });
    const onTerminalFailure = mock((_error: unknown) => {});
    const api = createElectronTaskStreamApi({ invoke, off, on });
    const pendingSubscription = api.subscribe({ cursor: null }, () => {}, onTerminalFailure);
    const dispatch = (value: unknown): void => {
      for (const listener of listeners.get(ELECTRON_TASK_STREAM_TERMINAL_FAILURE_CHANNEL) ?? []) {
        listener({}, value);
      }
    };

    dispatch({ message: "Unrelated stream failed.", subscriptionId: secondSubscriptionId });
    dispatch({ message: "Task stream delivery failed.", subscriptionId });
    resolveSubscribe({ subscriptionId });

    await expect(pendingSubscription).rejects.toThrow("Task stream delivery failed.");

    expect(onTerminalFailure).not.toHaveBeenCalled();
    expect(off).toHaveBeenCalledWith(ELECTRON_TASK_STREAM_FRAME_CHANNEL, expect.any(Function));
    expect(off).toHaveBeenCalledWith(
      ELECTRON_TASK_STREAM_TERMINAL_FAILURE_CHANNEL,
      expect.any(Function),
    );
    expect(listeners.get(ELECTRON_TASK_STREAM_FRAME_CHANNEL)?.size).toBe(0);
    expect(listeners.get(ELECTRON_TASK_STREAM_TERMINAL_FAILURE_CHANNEL)?.size).toBe(0);
    expect(invoke).not.toHaveBeenCalledWith(ELECTRON_TASK_STREAM_UNSUBSCRIBE_CHANNEL, {
      subscriptionId,
    });
  });
});
