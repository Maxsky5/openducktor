import {
  BROWSER_LIVE_RECONNECTED_EVENT_KIND,
  BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
} from "@/lib/browser-live/constants";
import type { BrowserLiveControlEvent, BrowserLiveControlEventKind } from "@/types";

export const browserLiveControlEvent = (
  kind: BrowserLiveControlEventKind,
  message?: string,
): BrowserLiveControlEvent => ({
  __openducktorBrowserLive: true,
  kind,
  ...(message !== undefined ? { message } : {}),
});

export const isBrowserLiveControlEvent = (payload: unknown): payload is BrowserLiveControlEvent => {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    record.__openducktorBrowserLive === true &&
    (record.kind === BROWSER_LIVE_RECONNECTED_EVENT_KIND ||
      record.kind === BROWSER_LIVE_STREAM_WARNING_EVENT_KIND) &&
    (record.message === undefined || typeof record.message === "string")
  );
};
