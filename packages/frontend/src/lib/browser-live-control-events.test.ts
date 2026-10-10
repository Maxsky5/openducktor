import { describe, expect, test } from "bun:test";
import { BROWSER_LIVE_STREAM_WARNING_EVENT_KIND } from "@/lib/browser-live/constants";
import { browserLiveStreamWarningEvent } from "./browser-live-control-events";

describe("browser-live-control-events", () => {
  test("preserves empty-string messages", () => {
    expect(browserLiveStreamWarningEvent("")).toEqual({
      __openducktorBrowserLive: true,
      kind: BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
      message: "",
    });
  });
});
