import { Effect, Stream } from "effect";
import { expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { z } from "zod";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import type { NotificationStreamFrame } from "@openducktor/contracts";
import { registerElectronNotificationStreamIpc } from "./electron-notification-stream-ipc";
import {
  NOTIFICATION_STREAM_SUBSCRIBE,
  NOTIFICATION_STREAM_UNSUBSCRIBE,
  NOTIFICATION_STREAM_FRAME,
  notificationFrameEnvelopeSchema,
  notificationFailureEnvelopeSchema,
  NOTIFICATION_STREAM_FAILURE,
  NOTIFICATION_STREAM_ACKNOWLEDGE,
} from "../shared/electron-notification-stream-contract";
type NotificationEnvelope =
  | z.input<typeof notificationFrameEnvelopeSchema>
  | z.input<typeof notificationFailureEnvelopeSchema>;
const harness = () => {
  const handlers = new Map<string, Parameters<IpcMain["handle"]>[1]>();
  const ipc = {
    handle(channel: string, callback: Parameters<IpcMain["handle"]>[1]) {
      handlers.set(channel, callback);
    },
  };
  let receive: (frame: NotificationStreamFrame) => void = () => {};
  const stop = mock(() => {});
  const reportDeliveryFailure = mock(() => {});
  // SAFETY: Registration uses only handle; the stream fake implements the host stream contract.
  registerElectronNotificationStreamIpc(
    ipc as IpcMain,
    {
      publishOccurrence() {},
      publishHealth() {},
      dispose: () => Effect.void,
      subscribe: () =>
        Stream.asyncPush<NotificationStreamFrame>(
          (emit) =>
            Effect.acquireRelease(
              Effect.sync(() => {
                receive = (frame) => {
                  emit.single(frame);
                };
              }),
              () => Effect.sync(stop),
            ),
          { bufferSize: 257, strategy: "dropping" },
        ),
    },
    reportDeliveryFailure,
  );
  const frame = {
    isDestroyed: () => false,
    send: mock((_channel: string, _envelope: NotificationEnvelope) => {}),
  };
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, mainFrame: frame });
  const senderEvents: EventEmitter = sender;
  const frameMethods: Pick<Electron.WebFrameMain, "isDestroyed" | "send"> = frame;
  // SAFETY: The handler uses only EventEmitter methods, mainFrame, isDestroyed, and frame.send.
  const event = {
    sender: senderEvents as Electron.WebContents,
    senderFrame: frameMethods as Electron.WebFrameMain,
  } as IpcMainInvokeEvent;
  const attach = async () => {
    // SAFETY: The registered handler returns its validated subscription response.
    const response = handlers.get(NOTIFICATION_STREAM_SUBSCRIBE)!(event, { cursor: null }) as {
      subscriptionId: string;
    };
    await flush();
    return response;
  };
  return {
    handlers,
    event,
    frame,
    sender,
    attach,
    stop,
    reportDeliveryFailure,
    emit: async (value: NotificationStreamFrame) => {
      receive(value);
      await flush();
    },
  };
};
test("notification IPC rejects subframes and foreign subscription owners", async () => {
  const h = harness();
  // SAFETY: This fake deliberately uses a different frame to exercise the ownership check.
  const childFrame: Pick<Electron.WebFrameMain, "isDestroyed" | "send"> = { ...h.frame };
  // SAFETY: The different frame implements the two methods used by the ownership check.
  const child = { ...h.event, senderFrame: childFrame as Electron.WebFrameMain };
  expect(() => h.handlers.get(NOTIFICATION_STREAM_SUBSCRIBE)!(child, { cursor: null })).toThrow(
    "active main frame",
  );
  const response = await h.attach();
  const other = harness();
  expect(() => h.handlers.get(NOTIFICATION_STREAM_UNSUBSCRIBE)!(other.event, response)).toThrow(
    "another renderer",
  );
  h.handlers.get(NOTIFICATION_STREAM_UNSUBSCRIBE)!(h.event, response);
  await flush();
  expect(h.stop).toHaveBeenCalledTimes(1);
});
test("navigation releases the main-frame subscription and removes its listeners", async () => {
  const h = harness();
  const response = await h.attach();
  const frame: NotificationStreamFrame = {
    type: "attached",
    reason: "new",
    cursor: { epoch: crypto.randomUUID(), sequence: 0 },
    health: [],
  };
  await h.emit(frame);
  expect(h.frame.send).toHaveBeenCalledWith(NOTIFICATION_STREAM_FRAME, {
    ...response,
    deliveryId: 1,
    frame,
  });
  h.sender.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  await flush();
  expect(h.stop).toHaveBeenCalledTimes(1);
  expect(h.sender.listenerCount("destroyed")).toBe(0);
  h.handlers.get(NOTIFICATION_STREAM_UNSUBSCRIBE)!(h.event, response);
  await flush();
  expect(h.stop).toHaveBeenCalledTimes(1);
});

const attachedFrame = (): NotificationStreamFrame => ({
  type: "attached",
  reason: "new",
  cursor: { epoch: crypto.randomUUID(), sequence: 0 },
  health: [],
});
test("frame and terminal send failures are reported and contained during teardown", async () => {
  const h = harness();
  await h.attach();
  h.frame.send.mockImplementation(() => {
    throw new Error("Frame stopped accepting messages");
  });
  await h.emit(attachedFrame());
  expect(h.reportDeliveryFailure).toHaveBeenCalledTimes(2);
  await flush();
  expect(h.stop).toHaveBeenCalledTimes(1);
  expect(h.sender.listenerCount("destroyed")).toBe(0);
  await h.emit(attachedFrame());
  expect(h.frame.send).toHaveBeenCalledTimes(2);
});
test("stalled renderer delivery fails after the bounded unacknowledged window", async () => {
  const h = harness();
  const response = await h.attach();
  for (let index = 0; index < 1001; index++) await h.emit(attachedFrame());
  expect(
    h.frame.send.mock.calls.filter(([channel]) => channel === NOTIFICATION_STREAM_FRAME),
  ).toHaveLength(257);
  expect(
    h.frame.send.mock.calls.filter(([channel]) => channel === NOTIFICATION_STREAM_FAILURE),
  ).toHaveLength(1);
  expect(h.reportDeliveryFailure).toHaveBeenCalledTimes(1);
  await flush();
  expect(h.stop).toHaveBeenCalledTimes(1);
  for (let deliveryId = 1; deliveryId <= 257; deliveryId++) {
    expect(() =>
      h.handlers.get(NOTIFICATION_STREAM_ACKNOWLEDGE)!(h.event, { ...response, deliveryId }),
    ).not.toThrow();
  }
  expect(h.reportDeliveryFailure).toHaveBeenCalledTimes(1);
});
test("acknowledgements release delivery capacity and remain bound to their renderer", async () => {
  const h = harness();
  const response = await h.attach();
  const ack = h.handlers.get(NOTIFICATION_STREAM_ACKNOWLEDGE)!;
  const other = harness();
  await h.emit(attachedFrame());
  expect(() => ack(other.event, { ...response, deliveryId: 1 })).toThrow("another renderer");
  expect(() => ack(h.event, { ...response, deliveryId: 2 })).toThrow("exceeds sent");
  ack(h.event, { ...response, deliveryId: 1 });
  for (let deliveryId = 2; deliveryId <= 500; deliveryId++) {
    await h.emit(attachedFrame());
    ack(h.event, { ...response, deliveryId });
  }
  expect(h.frame.send).toHaveBeenCalledTimes(500);
  expect(h.reportDeliveryFailure).not.toHaveBeenCalled();
  h.handlers.get(NOTIFICATION_STREAM_UNSUBSCRIBE)!(h.event, response);
});

test("attachment and a full retained replay fit before the first acknowledgement", async () => {
  const h = harness();
  const response = await h.attach();
  const first = attachedFrame();
  await h.emit(first);
  for (let sequence = 1; sequence <= 256; sequence++) {
    await h.emit({
      type: "health",
      cursor: { ...first.cursor, sequence },
      health: { scope: "/repo", source: "session", message: null },
    });
  }
  expect(h.frame.send).toHaveBeenCalledTimes(257);
  expect(h.reportDeliveryFailure).not.toHaveBeenCalled();
  h.handlers.get(NOTIFICATION_STREAM_ACKNOWLEDGE)!(h.event, { ...response, deliveryId: 257 });
  await h.emit({ ...first, cursor: { ...first.cursor, sequence: 257 } });
  expect(h.frame.send).toHaveBeenCalledTimes(258);
  h.handlers.get(NOTIFICATION_STREAM_UNSUBSCRIBE)!(h.event, response);
});

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
