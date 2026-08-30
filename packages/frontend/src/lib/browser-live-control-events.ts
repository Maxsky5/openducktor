import {
  BROWSER_LIVE_RECONNECTED_EVENT_KIND,
  BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
} from "@/lib/browser-live/constants";
import type { DevServerEvent } from "@openducktor/contracts";
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

  const event: BrowserLiveControlEvent = {
    __openducktorBrowserLive: true,
    kind,
  };
  if (detail !== undefined) event.message = detail;
  return event;
}

export const isBrowserLiveControlEvent = (
  payload: DevServerEvent | BrowserLiveControlEvent,
): payload is BrowserLiveControlEvent => "__openducktorBrowserLive" in payload;
