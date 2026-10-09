import { describe, expect, test } from "bun:test";
import { BROWSER_LIVE_STREAM_WARNING_EVENT_KIND } from "@/lib/browser-live/constants";
import { browserLiveControlEvent } from "./browser-live-control-events";

describe("browser-live-control-events", () => {
  test("preserves empty-string messages", () => {
    expect(browserLiveControlEvent(BROWSER_LIVE_STREAM_WARNING_EVENT_KIND, "")).toEqual({
      __openducktorBrowserLive: true,
      kind: BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
      message: "",
    });
  });
});
