import { describe, expect, mock, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { HostEventEnvelope, HostEventPayload } from "@openducktor/contracts";
import type { IpcRendererEvent } from "electron";
import { electronHostEventChannel } from "../shared/electron-host-event-channel";
import { forwardElectronHostEvent } from "../main/electron-host-event-forwarding";
import { type ElectronHostEventListener, subscribeElectronHostEvent } from "./electron-host-events";

describe("subscribeElectronHostEvent", () => {
  test("validates incoming envelopes before forwarding matching payloads", () => {
    let receive: ElectronHostEventListener | undefined;
    const ipcRenderer = {
      off: mock(() => {}),
      on: mock((_channel: string, listener: ElectronHostEventListener) => {
        receive = listener;
      }),
    };
    const listener = mock(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});

    try {
      const unsubscribe = subscribeElectronHostEvent(
        ipcRenderer,
        "openducktor://run-event",
        listener,
      );
      if (!receive) {
        throw new Error("Expected Electron host event listener.");
      }

      receive(
        {} satisfies IpcRendererEvent,
        JSON.parse(
          '{"channel":"openducktor://dev-server-event","payload":{"type":"not-a-dev-event"}}',
        ),
      );
      receive({} satisfies IpcRendererEvent, {
        channel: "openducktor://run-event",
        payload: { runId: "run-1" },
      });

      expect(listener).toHaveBeenCalledWith({ runId: "run-1" });
      expect(error).toHaveBeenCalledTimes(1);
      unsubscribe();
      expect(ipcRenderer.off).toHaveBeenCalledWith(
        electronHostEventChannel("openducktor://run-event"),
        receive,
      );
    } finally {
      error.mockRestore();
    }
  });

  test("routes main-process events to the matching repository and ignores unobserved channels", () => {
    const ipcRenderer = new EventEmitter();
    const first = mock(() => {});
    const second = mock(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});
    const report = mock(() => {});
    const stopFirst = subscribeElectronHostEvent(
      ipcRenderer,
      "openducktor://agent-session-live-event",
      first,
      "/repo:a",
    );
    const stopSecond = subscribeElectronHostEvent(
      ipcRenderer,
      "openducktor://agent-session-live-event",
      second,
      "/repo:a/b",
    );
    const payload = { type: "snapshot", repoPath: "/repo:a", sessions: [] } as const;
    try {
      const envelope: HostEventEnvelope = {
        channel: "openducktor://agent-session-live-event",
        payload: { ...payload, sessions: [] },
      };
      forwardElectronHostEvent(
        [
          {
            isDestroyed: () => false,
            webContents: {
              isDestroyed: () => false,
              send: (channel, event) => {
                ipcRenderer.emit(channel, {}, event);
              },
            },
          },
        ],
        envelope,
        report,
      );
      expect(first).toHaveBeenCalledWith(payload);
      expect(second).not.toHaveBeenCalled();
      expect(report).not.toHaveBeenCalled();
      expect(
        ipcRenderer.emit(
          electronHostEventChannel("openducktor://run-event"),
          {},
          { invalid: true },
        ),
      ).toBe(false);
      expect(
        ipcRenderer.emit(
          electronHostEventChannel("openducktor://agent-session-live-event", "/other"),
          {},
          { invalid: true },
        ),
      ).toBe(false);
      expect(error).not.toHaveBeenCalled();
      ipcRenderer.emit(
        electronHostEventChannel("openducktor://agent-session-live-event", "/repo:a/b"),
        {},
        envelope,
      );
      expect(second).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      stopFirst();
      stopSecond();
      error.mockRestore();
    }
    expect(ipcRenderer.eventNames()).toEqual([]);
  });

  test("shares validation across duplicate subscriptions and removes the route after the last unsubscribe", () => {
    const ipcRenderer = new EventEmitter();
    const channel = electronHostEventChannel("openducktor://run-event");
    const received: unknown[] = [];
    const listener = (payload: HostEventPayload<"openducktor://run-event">) =>
      received.push(payload);
    const stopFirst = subscribeElectronHostEvent(ipcRenderer, "openducktor://run-event", listener);
    const stopSecond = subscribeElectronHostEvent(ipcRenderer, "openducktor://run-event", listener);
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(ipcRenderer.listenerCount(channel)).toBe(1);
      ipcRenderer.emit(
        channel,
        {},
        { channel: "openducktor://run-event", payload: { runId: "first" } },
      );
      expect(received).toEqual([{ runId: "first" }, { runId: "first" }]);
      ipcRenderer.emit(channel, {}, { channel: "openducktor://run-event", payload: null });
      expect(error).toHaveBeenCalledTimes(1);
      stopFirst();
      stopFirst();
      expect(ipcRenderer.listenerCount(channel)).toBe(1);
      ipcRenderer.emit(
        channel,
        {},
        { channel: "openducktor://run-event", payload: { runId: "second" } },
      );
      expect(received).toEqual([{ runId: "first" }, { runId: "first" }, { runId: "second" }]);
      stopSecond();
      expect(ipcRenderer.listenerCount(channel)).toBe(0);
      const stopThird = subscribeElectronHostEvent(
        ipcRenderer,
        "openducktor://run-event",
        listener,
      );
      expect(ipcRenderer.listenerCount(channel)).toBe(1);
      stopSecond();
      expect(ipcRenderer.listenerCount(channel)).toBe(1);
      stopThird();
    } finally {
      stopFirst();
      stopSecond();
      error.mockRestore();
    }
    expect(ipcRenderer.eventNames()).toEqual([]);
  });

  test("keeps the current dispatch order when a callback replaces another subscription", () => {
    const ipcRenderer = new EventEmitter();
    const channel = electronHostEventChannel("openducktor://run-event");
    const calls: string[] = [];
    const stops: Array<() => void> = [];
    let replaceSecond = () => {};
    stops.push(
      subscribeElectronHostEvent(ipcRenderer, "openducktor://run-event", () => {
        calls.push("first");
        replaceSecond();
      }),
    );
    const stopSecond = subscribeElectronHostEvent(ipcRenderer, "openducktor://run-event", () =>
      calls.push("second"),
    );
    stops.push(stopSecond);
    replaceSecond = () => {
      stopSecond();
      stops.push(
        subscribeElectronHostEvent(ipcRenderer, "openducktor://run-event", () =>
          calls.push("third"),
        ),
      );
      replaceSecond = () => {};
    };
    try {
      const envelope = { channel: "openducktor://run-event", payload: {} };
      ipcRenderer.emit(channel, {}, envelope);
      expect(calls).toEqual(["first", "second"]);
      ipcRenderer.emit(channel, {}, envelope);
      expect(calls).toEqual(["first", "second", "first", "third"]);
    } finally {
      for (const stop of stops) stop();
    }
    expect(ipcRenderer.eventNames()).toEqual([]);
  });
});
