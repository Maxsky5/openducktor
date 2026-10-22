import type { BrowserEngineState } from "@openducktor/contracts";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type { HostConnection } from "@openducktor/frontend-core/connection/host-connection";
import {
  type FrameBrowserBridge,
  getShellBridge,
  type WebviewBrowserBridge,
} from "@/lib/shell-bridge";
import { type BrowserChannel, createBrowserChannel } from "./browser-channel";
import { type BrowserTabRequests, createBrowserTabRequests } from "./browser-tab-requests";
import {
  type BrowserSlot,
  type BrowserSurfaceRegistry,
  createBrowserSurfaceRegistry,
} from "./browser-surface-registry";
import {
  type BrowserTabsSnapshot,
  type BrowserTabsStore,
  createBrowserTabsStore,
} from "@openducktor/frontend-core/browser/browser-tabs-store";
import { type BrowserFocusRegistry, createBrowserFocusRegistry } from "./browser-focus-registry";
import type { BrowserFrameControls } from "./browser-frame-display";

type BrowserRuntimeBase = {
  readonly store: BrowserTabsStore;
  readonly slots: BrowserSurfaceRegistry<BrowserSlot>;
  readonly focus: BrowserFocusRegistry;
  readonly requests: BrowserTabRequests;
};

/** Electron: each tab page is a `<webview>`, with the browser channel and page overlays. */
export type WebviewBrowserRuntime = BrowserRuntimeBase & {
  readonly surface: "webview";
  readonly bridge: WebviewBrowserBridge;
  readonly channel: BrowserChannel;
  /** The overlay element of each surface, for prompts and markers above the page. */
  readonly overlays: BrowserSurfaceRegistry<HTMLElement>;
};

/** The web runner: each user tab page is an iframe of this browser. */
export type FrameBrowserRuntime = BrowserRuntimeBase & {
  readonly surface: "frame";
  readonly bridge: FrameBrowserBridge;
  /** The iframe controls of the frame tabs, by tab ID. */
  readonly frameControls: BrowserSurfaceRegistry<BrowserFrameControls>;
};

export type BrowserRuntime = WebviewBrowserRuntime | FrameBrowserRuntime;

const BrowserRuntimeContext = createContext<BrowserRuntime | null>(null);

const createBrowserRuntime = (host: HostConnection): BrowserRuntime => {
  const bridge = getShellBridge().browser;
  const hostClient = host.client;
  const hostPage = bridge.surface === "webview";
  // Electron shows host pages. The web runner shows its frame pages: its user tabs. Its agent tabs
  // run in a browser on the host that the user does not watch.
  const store = createBrowserTabsStore({
    shows: (tab) => tab.page === (hostPage ? "host" : "frame"),
    readTabs: () => hostClient.browserTabsList().then((result) => result.tabs),
    readEngine: () => hostClient.browserStateRead(),
    subscribe: (listener) => host.subscribeBrowserTabEvents(listener),
  });
  const base: BrowserRuntimeBase = {
    store,
    slots: createBrowserSurfaceRegistry<BrowserSlot>(),
    focus: createBrowserFocusRegistry(),
    requests: createBrowserTabRequests(store, {
      hostPage,
      open: ({ owner, tabId, address }) =>
        hostClient.browserTabOpen({ owner, tabId, address }).then(() => undefined),
      start: (tabId) => hostClient.browserTabStart({ tabId }).then(() => undefined),
      close: (tabId) => hostClient.browserTabClose({ tabId }),
    }),
  };
  return bridge.surface === "webview"
    ? {
        ...base,
        surface: "webview",
        bridge,
        channel: createBrowserChannel(bridge),
        overlays: createBrowserSurfaceRegistry<HTMLElement>(),
      }
    : {
        ...base,
        surface: "frame",
        bridge,
        frameControls: createBrowserSurfaceRegistry<BrowserFrameControls>(),
      };
};

/** Owns the browser tab state and the browser channel for the whole app shell. */
export function BrowserRuntimeProvider({ children }: { children: ReactNode }) {
  const { host } = useClientConnection();
  const [runtime] = useState(() => createBrowserRuntime(host));
  useEffect(() => {
    void runtime.store.start();
    if (runtime.surface === "webview") void runtime.channel.connect();
    return () => {
      runtime.store.stop();
      if (runtime.surface === "webview") void runtime.channel.stop();
    };
  }, [runtime]);
  return (
    <BrowserRuntimeContext.Provider value={runtime}>{children}</BrowserRuntimeContext.Provider>
  );
}

export const useBrowserRuntime = (): BrowserRuntime => {
  const runtime = useContext(BrowserRuntimeContext);
  if (runtime === null) {
    throw new Error("Browser tabs need BrowserRuntimeProvider in the app shell.");
  }
  return runtime;
};

export const useBrowserTabs = (): BrowserTabsSnapshot => {
  const { store } = useBrowserRuntime();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
};

export const useBrowserEngineState = (): BrowserEngineState | null => useBrowserTabs().engine;

/** The state of the browser channel of an Electron window. */
export const useBrowserChannelStatus = (channel: BrowserChannel) =>
  useSyncExternalStore(channel.onStatus, channel.status);

/** The overlay element of a surface frame, for prompts and markers above the page. */
export const useBrowserOverlayHost = (
  overlays: BrowserSurfaceRegistry<HTMLElement>,
  key: string,
): HTMLElement | null => {
  useSyncExternalStore(overlays.subscribe, overlays.version);
  return overlays.get(key) ?? null;
};
