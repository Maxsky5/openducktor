import {
  BROWSER_LIVE_RECONNECTED_EVENT_KIND,
  BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
} from "@/lib/browser-live/constants";
import { hasRuntimeType } from "@openducktor/contracts";
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
    ...(detail !== undefined ? { message: detail } : undefined),
  };
}

export const isBrowserLiveControlEvent = (payload: unknown): payload is BrowserLiveControlEvent => {
  if (!hasRuntimeType(payload, "object") || payload === null) {
    return false;
  }

  if (!("__openducktorBrowserLive" in payload) || payload.__openducktorBrowserLive !== true) {
    return false;
  }

  if ("kind" in payload && payload.kind === BROWSER_LIVE_RECONNECTED_EVENT_KIND) {
    return (
      "transportEpoch" in payload &&
      hasRuntimeType(payload.transportEpoch, "string") &&
      payload.transportEpoch.length > 0
    );
  }

  return (
    "kind" in payload &&
    payload.kind === BROWSER_LIVE_STREAM_WARNING_EVENT_KIND &&
    (!("message" in payload) ||
      payload.message === undefined ||
      hasRuntimeType(payload.message, "string"))
  );
};
