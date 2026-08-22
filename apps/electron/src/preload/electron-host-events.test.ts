import { describe, expect, mock, spyOn, test } from "bun:test";
import type { IpcRendererEvent } from "electron";
import { ELECTRON_HOST_EVENT_CHANNEL } from "../shared/electron-bridge-contract";
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

      // SAFETY: This test controls the fixture and supplies `IpcRendererEvent` used by this case.
      receive(
        {} as IpcRendererEvent,
        JSON.parse(
          '{"channel":"openducktor://dev-server-event","payload":{"type":"not-a-dev-event"}}',
        ),
      );
      // SAFETY: This test controls the fixture and supplies `IpcRendererEvent` used by this case.
      receive({} as IpcRendererEvent, {
        channel: "openducktor://run-event",
        payload: { runId: "run-1" },
      });

      expect(listener).toHaveBeenCalledWith({ runId: "run-1" });
      expect(error).toHaveBeenCalledTimes(1);
      unsubscribe();
      expect(ipcRenderer.off).toHaveBeenCalledWith(ELECTRON_HOST_EVENT_CHANNEL, receive);
    } finally {
      error.mockRestore();
    }
  });
});
