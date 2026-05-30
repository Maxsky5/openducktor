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
      }),
    ).toBe(true);
  });

  test("rejects control events with non-string messages", () => {
    expect(
      isBrowserLiveControlEvent({
        __openducktorBrowserLive: true,
        kind: BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
        message: 42,
      }),
    ).toBe(false);
  });
});
