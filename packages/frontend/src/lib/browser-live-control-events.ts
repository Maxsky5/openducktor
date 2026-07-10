import {
  BROWSER_LIVE_RECONNECTED_EVENT_KIND,
  BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
} from "@/lib/browser-live/constants";
import type { BrowserLiveControlEvent, BrowserLiveControlEventKind } from "@/types";

export function browserLiveControlEvent(
  kind: typeof BROWSER_LIVE_RECONNECTED_EVENT_KIND,
  transportEpoch: string,
): BrowserLiveControlEvent;
export function browserLiveControlEvent(
  kind: typeof BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
  message?: string,
): BrowserLiveControlEvent;
export function browserLiveControlEvent(
  kind: BrowserLiveControlEventKind,
  detail?: string,
): BrowserLiveControlEvent {
  if (kind === BROWSER_LIVE_RECONNECTED_EVENT_KIND) {
    if (!detail) {
      throw new Error("Browser live reconnect events require a transport epoch.");
    }
    return {
      __openducktorBrowserLive: true,
      kind,
      transportEpoch: detail,
    };
  }

  return {
    __openducktorBrowserLive: true,
    kind,
    ...(detail !== undefined ? { message: detail } : {}),
  };
}

export const isBrowserLiveControlEvent = (payload: unknown): payload is BrowserLiveControlEvent => {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  if (record.__openducktorBrowserLive !== true) {
    return false;
  }

  if (record.kind === BROWSER_LIVE_RECONNECTED_EVENT_KIND) {
    return typeof record.transportEpoch === "string" && record.transportEpoch.length > 0;
  }

  return (
    record.kind === BROWSER_LIVE_STREAM_WARNING_EVENT_KIND &&
    (record.message === undefined || typeof record.message === "string")
  );
};
