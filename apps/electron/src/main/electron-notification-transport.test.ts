import { Effect, Stream } from "effect";
import { expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { NotificationCursor, NotificationStreamFrame } from "@openducktor/contracts";
import type { IpcMain, IpcMainInvokeEvent, IpcRenderer } from "electron";
import type { z } from "zod";
import { createNotificationStream } from "../../../../packages/host/src/application/notifications/notification-stream";
import { createElectronNotificationStreamApi } from "../preload/electron-notification-stream-ipc";
import {
  NOTIFICATION_STREAM_SUBSCRIBE,
  notificationFrameEnvelopeSchema,
  notificationFailureEnvelopeSchema,
} from "../shared/electron-notification-stream-contract";
import { registerElectronNotificationStreamIpc } from "./electron-notification-stream-ipc";

test("a stalled renderer fails without interrupting another renderer's delivery", async () => {
  const h = harness();
  const healthy = h.renderer();
  const stalled = h.renderer();
  const stopHealthy = await healthy.attach();
  const stopStalled = await stalled.attach();
  try {
    stalled.pause();
    for (let sequence = 1; sequence <= 600; sequence++) {
      h.stream.publishHealth({ scope: "/repo", source: "session", message: null });
      // Let the host drain each batch so this tests renderer acknowledgement capacity.
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(healthy.frames).toHaveLength(601);
    expect(healthy.failures).toEqual([]);
    expect(stalled.frames).toHaveLength(1);
    expect(stalled.pending()).toBe(515);
    expect(h.active()).toBe(1);
    expect(h.deliveryFailure).toHaveBeenCalledTimes(1);

    stalled.resume();
    await new Promise((resolve) => setImmediate(resolve));
    expect(stalled.frames).toHaveLength(515);
    expect(stalled.failures).toHaveLength(1);
    expect(String(stalled.failures[0])).toContain("renderer cannot keep up");
    expect(stalled.listeners()).toBe(0);

    h.stream.publishHealth({ scope: "/repo", source: "session", message: null });
    await new Promise((resolve) => setImmediate(resolve));
    expect(healthy.frames).toHaveLength(602);
    expect(stalled.frames).toHaveLength(515);
    stopHealthy();
    stopHealthy();
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.active()).toBe(0);
  } finally {
    stopHealthy();
    stopStalled();
    await Effect.runPromise(h.stream.dispose());
  }
});

test("full replay and queued live frames survive a delayed IPC response and acknowledgements", async () => {
  const h = harness();
  const first = h.renderer();
  const stopFirst = await first.attach();
  const cursor = first.frames[0]!.cursor;
  stopFirst();
  for (let sequence = 1; sequence <= 256; sequence++)
    h.stream.publishHealth({ scope: "/repo", source: "session", message: null });
  const response = Promise.withResolvers<void>();
  const replay = h.renderer(response.promise);
  const pending = replay.attach(cursor);
  try {
    await new Promise((resolve) => setImmediate(resolve));
    for (let sequence = 1; sequence <= 257; sequence++)
      h.stream.publishHealth({ scope: "/repo", source: "session", message: null });
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.deliveryFailure).not.toHaveBeenCalled();
    expect(replay.failures).toEqual([]);
    expect(replay.frames).toEqual([]);
    response.resolve();
    const stopReplay = await pending;
    expect(replay.frames).toHaveLength(514);
    expect(replay.frames[0]).toMatchObject({ type: "attached", reason: "replay", cursor });
    expect(replay.frames.slice(1).map((frame) => frame.cursor.sequence)).toEqual(
      Array.from({ length: 513 }, (_, index) => index + 1),
    );
    expect(replay.failures).toEqual([]);
    h.stream.publishHealth({ scope: "/repo", source: "session", message: null });
    await new Promise((resolve) => setImmediate(resolve));
    expect(replay.frames.at(-1)?.cursor.sequence).toBe(514);
    expect(replay.frames).toHaveLength(515);
    expect(first.frames).toHaveLength(1);
    expect(h.deliveryFailure).not.toHaveBeenCalled();
    stopReplay();
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.active()).toBe(0);
    expect(replay.listeners()).toBe(0);
  } finally {
    response.resolve();
    await pending.then(
      (stop) => stop(),
      () => {},
    );
    await Effect.runPromise(h.stream.dispose());
  }
});

test.each(["unsubscribe", "navigation", "destroyed", "render-process-gone"] as const)(
  "%s releases a renderer with host frames still queued",
  async (cause) => {
    const h = harness();
    const renderer = h.renderer();
    const stop = await renderer.attach();
    try {
      h.stream.publishHealth({ scope: "/repo", source: "session", message: null });
      if (cause === "unsubscribe") stop();
      else if (cause === "navigation")
        renderer.sender.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      else renderer.sender.emit(cause);
      h.stream.publishHealth({ scope: "/repo", source: "session", message: null });
      await new Promise((resolve) => setImmediate(resolve));
      expect(h.active()).toBe(0);
      expect(renderer.frames).toHaveLength(1);
      expect(renderer.failures).toEqual([]);
      expect(h.deliveryFailure).not.toHaveBeenCalled();
      for (const event of ["destroyed", "render-process-gone", "did-start-navigation"])
        expect(renderer.sender.listenerCount(event)).toBe(0);
    } finally {
      stop();
      await Effect.runPromise(h.stream.dispose());
    }
  },
);

/** Wire the production stream, main handlers, and preload API through local IPC fakes. */
const harness = () => {
  const stream = createNotificationStream();
  const handlers = new Map<string, Parameters<IpcMain["handle"]>[1]>();
  const deliveryFailure = mock(() => {});
  let active = 0;
  // SAFETY: The registrar uses only handle on IpcMain.
  registerElectronNotificationStreamIpc(
    { handle: (channel, handler) => handlers.set(channel, handler) } as IpcMain,
    {
      ...stream,
      subscribe(input) {
        return Stream.unwrapScoped(
          Effect.acquireRelease(
            Effect.sync(() => {
              active += 1;
              return stream.subscribe(input);
            }),
            () =>
              Effect.sync(() => {
                active -= 1;
              }),
          ),
        );
      },
    },
    deliveryFailure,
    () => false,
  );
  return {
    stream,
    deliveryFailure,
    active: () => active,
    renderer(response?: Promise<void>) {
      const listeners = new EventEmitter();
      const pending: Array<() => void> = [];
      const frames: NotificationStreamFrame[] = [];
      const failures: unknown[] = [];
      let paused = false;
      const frame = {
        isDestroyed: () => false,
        send(
          channel: string,
          value:
            | z.input<typeof notificationFrameEnvelopeSchema>
            | z.input<typeof notificationFailureEnvelopeSchema>,
        ) {
          const deliver = () => listeners.emit(channel, {}, value);
          if (paused) pending.push(deliver);
          else deliver();
        },
      };
      const sender = Object.assign(new EventEmitter(), {
        mainFrame: frame,
        isDestroyed: () => false,
      });
      // SAFETY: The handlers use the sender's event methods, mainFrame, and frame methods above.
      const event = {
        sender: sender as Electron.WebContents,
        senderFrame: frame as Electron.WebFrameMain,
      } as IpcMainInvokeEvent;
      const ipc = {
        async invoke(channel: string, ...args: unknown[]) {
          const handler = handlers.get(channel);
          if (!handler) throw new Error(`No test IPC handler for ${channel}`);
          const result = handler(event, ...args);
          if (channel === NOTIFICATION_STREAM_SUBSCRIBE && response) await response;
          return result;
        },
        on(channel: string, listener: Parameters<IpcRenderer["on"]>[1]) {
          listeners.on(channel, listener);
          return ipc;
        },
        off(channel: string, listener: Parameters<IpcRenderer["off"]>[1]) {
          listeners.off(channel, listener);
          return ipc;
        },
      };
      // SAFETY: Preload uses only invoke, on, and off from IpcRenderer.
      const api = createElectronNotificationStreamApi(
        ipc as Pick<IpcRenderer, "invoke" | "on" | "off">,
      );
      return {
        sender,
        frames,
        failures,
        async attach(cursor: NotificationCursor | null = null) {
          let attached = () => {};
          const ready = new Promise<void>((resolve) => {
            attached = resolve;
          });
          const stop = await api.subscribe(
            { cursor },
            (value) => {
              frames.push(value);
              if (value.type === "attached") attached();
            },
            (cause) => {
              failures.push(cause);
              attached();
            },
          );
          await ready;
          return stop;
        },
        pause() {
          paused = true;
        },
        resume() {
          paused = false;
          for (const deliver of pending.splice(0)) deliver();
        },
        pending: () => pending.length,
        listeners: () => listeners.eventNames().length,
      };
    },
  };
};
