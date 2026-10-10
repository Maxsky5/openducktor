import {
  BROWSER_LIVE_RECONNECTED_EVENT_KIND,
  BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
} from "./browser-live/constants";
import type { BrowserLiveControlEvent } from "../types";

export const browserLiveReconnectedEvent = (missedEvents: boolean): BrowserLiveControlEvent => ({
  __openducktorBrowserLive: true,
  kind: BROWSER_LIVE_RECONNECTED_EVENT_KIND,
  missedEvents,
});

export const browserLiveStreamWarningEvent = (message?: string): BrowserLiveControlEvent => {
  const event: Extract<
    BrowserLiveControlEvent,
    { kind: typeof BROWSER_LIVE_STREAM_WARNING_EVENT_KIND }
  > = {
    __openducktorBrowserLive: true,
    kind: BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
  };
  if (message !== undefined) {
    event.message = message;
  }
  return event;
};
