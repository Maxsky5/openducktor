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
        type: "terminal_chunk",
        repoPath: "/repo",
        taskId: "task-1",
        terminalChunk: {
          scriptId: "dev",
          runIdentity: {
            runId: "run-1",
            runOrder: { hostInstanceId: "host-1", generation: 1 },
          },
          sequence: 0,
          data: "ready",
          timestamp: "2026-08-30T10:00:00.000Z",
        },
      }),
    ).toBe(false);
  });
});
