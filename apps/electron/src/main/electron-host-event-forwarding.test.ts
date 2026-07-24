import { describe, expect, mock, test } from "bun:test";
import { HOST_EVENT_CHANNELS } from "@openducktor/host";
import { forwardElectronHostEvent } from "./electron-host-event-forwarding";

describe("forwardElectronHostEvent", () => {
  test("does not expose task stream frames through the generic host event channels", () => {
    expect(HOST_EVENT_CHANNELS).not.toContain("openducktor://task-event");
  });

  test("reports one failed window send and continues forwarding to later windows", () => {
    const failure = new Error("renderer destroyed during send");
    const report = mock(() => {});
    const received = mock(() => {});

    forwardElectronHostEvent(
      [
        {
          isDestroyed: () => false,
          webContents: {
            isDestroyed: () => false,
            send: () => {
              throw failure;
            },
          },
        },
        {
          isDestroyed: () => false,
          webContents: { isDestroyed: () => false, send: received },
        },
      ],
      "openducktor:host-event",
      { channel: "openducktor://run-event", payload: { type: "run" } },
      report,
    );

    expect(report).toHaveBeenCalledWith({ channel: "openducktor://run-event", cause: failure });
    expect(received).toHaveBeenCalledWith("openducktor:host-event", {
      channel: "openducktor://run-event",
      payload: { type: "run" },
    });
  });
});
