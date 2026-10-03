import { expect, mock, test } from "bun:test";
import { createElectronNotificationStreamApi } from "./electron-notification-stream-ipc";
import {
  NOTIFICATION_STREAM_FRAME,
  NOTIFICATION_STREAM_FAILURE,
  NOTIFICATION_STREAM_ACKNOWLEDGE,
  NOTIFICATION_STREAM_UNSUBSCRIBE,
} from "../shared/electron-notification-stream-contract";
import type { IpcRenderer } from "electron";
import type { NotificationStreamFrame } from "@openducktor/contracts";
const id = "11111111-1111-4111-8111-111111111111";
const frame: NotificationStreamFrame = {
  type: "attached",
  reason: "new",
  cursor: { epoch: id, sequence: 0 },
  health: [],
};
const harness = () => {
  const listeners = new Map<string, Parameters<IpcRenderer["on"]>[1]>();
  let resolve!: (value: { subscriptionId: string }) => void;
  const response = new Promise<{ subscriptionId: string }>((done) => {
    resolve = done;
  });
  const invoke = mock((channel: string) =>
    channel === NOTIFICATION_STREAM_UNSUBSCRIBE || channel === NOTIFICATION_STREAM_ACKNOWLEDGE
      ? Promise.resolve()
      : response,
  );
  const ipc = {
    invoke,
    on(channel: string, callback: Parameters<IpcRenderer["on"]>[1]) {
      listeners.set(channel, callback);
      return ipc;
    },
    off(channel: string) {
      listeners.delete(channel);
      return ipc;
    },
  };
  // SAFETY: The fake implements invoke, on, and off; the API uses no other renderer methods.
  const api = createElectronNotificationStreamApi(
    ipc as Pick<IpcRenderer, "invoke" | "on" | "off">,
  );
  return {
    api,
    resolve,
    invoke,
    listeners,
    emit: (raw: { subscriptionId: string; frame: unknown; deliveryId?: number }) =>
      listeners.get(NOTIFICATION_STREAM_FRAME)?.({}, { deliveryId: 1, ...raw }),
    fail: (message: string) =>
      listeners.get(NOTIFICATION_STREAM_FAILURE)?.({}, { subscriptionId: id, message }),
  };
};
test("preload attaches before the IPC response, filters ownership, and disposes once", async () => {
  const h = harness();
  const received = mock(() => {});
  const pending = h.api.subscribe(
    { cursor: null },
    received,
    mock(() => {}),
  );
  h.emit({ subscriptionId: id, frame });
  h.emit({ subscriptionId: crypto.randomUUID(), frame });
  expect(received).not.toHaveBeenCalled();
  h.resolve({ subscriptionId: id });
  const stop = await pending;
  expect(received).toHaveBeenCalledTimes(1);
  expect(h.invoke).toHaveBeenLastCalledWith(NOTIFICATION_STREAM_ACKNOWLEDGE, {
    subscriptionId: id,
    deliveryId: 1,
  });
  stop();
  stop();
  expect(h.listeners.size).toBe(0);
  expect(
    h.invoke.mock.calls.filter(([channel]) => channel === NOTIFICATION_STREAM_UNSUBSCRIBE),
  ).toHaveLength(1);
});
test("malformed frames release an attached consumer and expose the failure", async () => {
  const h = harness();
  h.resolve({ subscriptionId: id });
  const failure = mock(() => {});
  await h.api.subscribe(
    { cursor: null },
    mock(() => {}),
    failure,
  );
  h.emit({ subscriptionId: id, frame: { type: "occurrence" } });
  expect(failure).toHaveBeenCalledTimes(1);
  expect(h.listeners.size).toBe(0);
  expect(h.invoke).toHaveBeenLastCalledWith(NOTIFICATION_STREAM_UNSUBSCRIBE, {
    subscriptionId: id,
  });
});
test("attachment overflow is bounded and releases the eventual host subscription", async () => {
  const h = harness();
  const failure = mock(() => {});
  const pending = h.api.subscribe(
    { cursor: null },
    mock(() => {}),
    failure,
  );
  for (let index = 0; index < 516; index++) h.emit({ subscriptionId: id, frame });
  h.resolve({ subscriptionId: id });
  await expect(pending).rejects.toThrow("buffer is full");
  expect(failure).toHaveBeenCalledTimes(1);
  expect(h.listeners.size).toBe(0);
  expect(h.invoke).toHaveBeenLastCalledWith(NOTIFICATION_STREAM_UNSUBSCRIBE, {
    subscriptionId: id,
  });
});

test("a full attachment buffer preserves the terminal failure before the IPC response", async () => {
  const h = harness();
  const received = mock(() => {});
  const failure = mock<Parameters<typeof h.api.subscribe>[2]>(() => {});
  const pending = h.api.subscribe({ cursor: null }, received, failure);
  for (let deliveryId = 1; deliveryId <= 514; deliveryId++)
    h.emit({ subscriptionId: id, frame, deliveryId });
  h.fail("Notification renderer cannot keep up. Reload to reconnect.");
  h.resolve({ subscriptionId: id });
  const stop = await pending;
  expect(received).toHaveBeenCalledTimes(514);
  expect(failure).toHaveBeenCalledTimes(1);
  expect(String(failure.mock.calls[0]?.[0])).toContain("renderer cannot keep up");
  expect(h.listeners.size).toBe(0);
  stop();
  expect(
    h.invoke.mock.calls.filter(([channel]) => channel === NOTIFICATION_STREAM_UNSUBSCRIBE),
  ).toHaveLength(1);
});

test("preload acknowledges only after consumption and fails a throwing consumer", async () => {
  const h = harness();
  h.resolve({ subscriptionId: id });
  const failure = mock(() => {});
  await h.api.subscribe(
    { cursor: null },
    () => {
      throw new Error("consumer failed");
    },
    failure,
  );
  expect(() => h.emit({ subscriptionId: id, frame })).not.toThrow();
  expect(failure).toHaveBeenCalledTimes(1);
  expect(h.listeners.size).toBe(0);
  expect(
    h.invoke.mock.calls.filter(([channel]) => channel === NOTIFICATION_STREAM_ACKNOWLEDGE),
  ).toHaveLength(0);
});
