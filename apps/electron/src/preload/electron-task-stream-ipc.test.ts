import { describe, expect, mock, test } from "bun:test";
import type { TaskEventStreamFrame } from "@openducktor/contracts";
import {
  ELECTRON_TASK_STREAM_ACKNOWLEDGE_CHANNEL,
  ELECTRON_TASK_STREAM_FRAME_CHANNEL,
  ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL,
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
    let listener: ((event: unknown, value: unknown) => void) | undefined;
    let listenerRegistered = false;
    const off = mock(() => {});
    const invoke = mock(async (channel: string) => {
      if (channel === ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL) {
        if (!listenerRegistered)
          throw new Error("Frame listener was not registered before subscribe.");
        listener?.({}, { frame, subscriptionId });
        return { subscriptionId };
      }
    });
    const on = mock((_channel: string, next: (event: unknown, value: unknown) => void) => {
      listener = next;
      listenerRegistered = true;
    });
    const receive = mock(() => {});
    const api = createElectronTaskStreamApi({ invoke, off, on });

    const subscription = await api.subscribe({ cursor: null }, receive);

    expect(on).toHaveBeenCalledTimes(1);
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
    expect(off).toHaveBeenCalledWith(ELECTRON_TASK_STREAM_FRAME_CHANNEL, listener);
  });

  test("scopes buffered and live frames to concurrent subscriptions on one renderer channel", async () => {
    const listeners = new Set<(event: unknown, value: unknown) => void>();
    const resolveSubscriptions: Array<(value: { subscriptionId: string }) => void> = [];
    const invoke = mock((channel: string) => {
      if (channel !== ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL) return Promise.resolve(undefined);
      return new Promise<{ subscriptionId: string }>((resolve) => {
        resolveSubscriptions.push(resolve);
      });
    });
    const on = mock((_channel: string, listener: (event: unknown, value: unknown) => void) => {
      listeners.add(listener);
    });
    const off = mock((_channel: string, listener: (event: unknown, value: unknown) => void) => {
      listeners.delete(listener);
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
      for (const listener of listeners) listener({}, value);
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
});
