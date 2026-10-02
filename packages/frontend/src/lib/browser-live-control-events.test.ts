import { describe, expect, test } from "bun:test";
import {
  BROWSER_LIVE_RECONNECTED_EVENT_KIND,
  BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
} from "@/lib/browser-live/constants";
import { browserLiveControlEvent, isBrowserLiveControlEvent } from "./browser-live-control-events";

describe("browser-live-control-events", () => {
  test("preserves empty-string messages", () => {
    expect(browserLiveControlEvent(BROWSER_LIVE_STREAM_WARNING_EVENT_KIND, "")).toEqual({
      __openducktorBrowserLive: true,
      kind: BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
      message: "",
    });
  });

  test("accepts valid control events", () => {
    expect(
      isBrowserLiveControlEvent({
        __openducktorBrowserLive: true,
        kind: BROWSER_LIVE_RECONNECTED_EVENT_KIND,
        transportEpoch: "test:1",
      }),
    ).toBe(true);
  });

  test("rejects dev server events", () => {
    expect(
      isBrowserLiveControlEvent({
        type: "script_status_changed",
        repoPath: "/repo",
        owner: { kind: "task", taskId: "task-1" },
        revision: 1,
        updatedAt: "now",
        script: {
          scriptId: "dev",
          name: "Dev",
          command: "dev",
          startedCommand: null,
          terminalId: null,
          status: "stopped",
          pid: null,
          startedAt: null,
          exitCode: null,
          lastError: null,
        },
      }),
    ).toBe(false);
  });
});
