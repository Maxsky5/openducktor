import type {
  BROWSER_LIVE_RECONNECTED_EVENT_KIND,
  BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
} from "@/lib/browser-live/constants";

export type BrowserLiveControlEventKind =
  | typeof BROWSER_LIVE_RECONNECTED_EVENT_KIND
  | typeof BROWSER_LIVE_STREAM_WARNING_EVENT_KIND;

export type BrowserLiveControlEvent =
  | {
      __openducktorBrowserLive: true;
      kind: typeof BROWSER_LIVE_RECONNECTED_EVENT_KIND;
      transportEpoch: string;
    }
  | {
      __openducktorBrowserLive: true;
      kind: typeof BROWSER_LIVE_STREAM_WARNING_EVENT_KIND;
      message?: string;
    };
