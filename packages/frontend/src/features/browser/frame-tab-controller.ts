import {
  BROWSER_BLANK_URL,
  BROWSER_FAVICON_MAX_LENGTH,
  BROWSER_FRAME_COMMAND_FIELD,
  BROWSER_TITLE_MAX_LENGTH,
  type BrowserFrameCommand,
  type BrowserTabFrameStateRequest,
  browserFrameMessageSchema,
  isBrowserBlankUrl,
  isBrowserFrameUrl,
  isBrowserNavigableUrl,
  limitBrowserUrl,
} from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { BrowserFrameBridge } from "@/lib/shell-bridge";
import type { BrowserFocusRegistry } from "./browser-focus-registry";
import type { BrowserFrameControls } from "./browser-frame-display";
import type { BrowserSurfaceRegistry } from "./browser-surface-registry";

export type BrowserFrameState = Omit<BrowserTabFrameStateRequest, "tabId">;
type FrameState = BrowserFrameState;

/**
 * What the iframe shows: a preview of a host page, whose frame script reports its state, a site
 * at its own URL, which reports nothing, or no page.
 */
type FramePage = { kind: "preview"; origin: string } | { kind: "direct" } | { kind: "none" };

/**
 * Runs the page of a web runner tab in its iframe: the history of the address bar and page links,
 * the frame check of each site, the messages of the frame script, and the toolbar commands. It
 * reports each page state. Returns the stop.
 */
export const startFrameTabController = ({
  element,
  frames,
  focus,
  controls,
  tabId,
  startUrl,
  setChecking,
  reportState,
}: {
  element: HTMLIFrameElement;
  frames: BrowserFrameBridge;
  focus: Pick<BrowserFocusRegistry, "registerPage" | "focusAddressBar">;
  controls: BrowserSurfaceRegistry<BrowserFrameControls>;
  tabId: string;
  startUrl: string;
  /** True while a site loads before the host allowed frames for it. */
  setChecking(checking: boolean): void;
  reportState(state: BrowserFrameState): void;
}): (() => void) => {
  let disposed = false;
  let loadId = 0;
  let page: FramePage = { kind: "none" };
  /** The history of the preview page, which its frame script reports. */
  let previewHistory = { canGoBack: false, canGoForward: false };
  /**
   * True after the frame script of the current document reported. A document without it, such as
   * JSON or an image, takes no commands, so the toolbar uses the history of the tab.
   */
  let scripted = false;
  /** The address of the document that the preview page started to load. */
  let pendingUrl: string | null = null;
  /** The pages that the address bar and page links opened, for Back and Forward between sites. */
  let history = { urls: [startUrl], index: 0 };
  let state: FrameState = {
    url: startUrl,
    title: null,
    favicon: null,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
  };

  const previewCan = (command: BrowserFrameCommand): boolean => {
    if (page.kind !== "preview" || !scripted) return false;
    if (command === "back") return previewHistory.canGoBack;
    if (command === "forward") return previewHistory.canGoForward;
    return true;
  };

  const report = (change: Partial<FrameState>): void => {
    state = {
      ...state,
      ...change,
      canGoBack: previewCan("back") || history.index > 0,
      canGoForward: previewCan("forward") || history.index < history.urls.length - 1,
    };
    reportState(state);
  };

  const showNothing = (change: Partial<FrameState>): void => {
    page = { kind: "none" };
    setChecking(false);
    element.src = BROWSER_BLANK_URL;
    report({ loading: false, ...change });
  };

  /** Loads the current history entry. */
  const load = async (): Promise<void> => {
    const id = ++loadId;
    const target = history.urls[history.index] ?? BROWSER_BLANK_URL;
    previewHistory = { canGoBack: false, canGoForward: false };
    scripted = false;
    pendingUrl = null;
    if (isBrowserBlankUrl(target)) {
      showNothing({ url: BROWSER_BLANK_URL, title: null, favicon: null, error: null });
      return;
    }
    // A `javascript:` URL in this frame runs on the origin of the app, so only web pages load.
    if (!isBrowserNavigableUrl(target)) {
      showNothing({
        url: BROWSER_BLANK_URL,
        title: null,
        favicon: null,
        error: {
          kind: "load_failed",
          url: limitBrowserUrl(target),
          message: "Only http and https pages can load in a tab.",
        },
      });
      return;
    }
    const local = isBrowserFrameUrl(target);
    if (!local) {
      page = { kind: "direct" };
      setChecking(true);
      element.src = target;
    }
    report({
      url: limitBrowserUrl(target),
      title: null,
      favicon: null,
      loading: true,
      error: null,
    });
    try {
      const source = await frames.source(target);
      if (disposed || id !== loadId) return;
      switch (source.kind) {
        case "preview": {
          const url = new URL(target);
          page = { kind: "preview", origin: source.origin };
          element.src = `${source.origin}${url.pathname}${url.search}${url.hash}`;
          return;
        }
        case "direct":
          setChecking(false);
          return;
        case "refused":
          showNothing({ error: { kind: "frame_refused", url: target, message: source.message } });
          return;
      }
    } catch (cause) {
      if (disposed || id !== loadId) return;
      showNothing({ error: { kind: "load_failed", url: target, message: errorMessage(cause) } });
    }
  };

  const open = (url: string): Promise<void> => {
    history = {
      urls: [...history.urls.slice(0, history.index + 1), url],
      index: history.index + 1,
    };
    return load();
  };

  const move = (step: number): void => {
    const index = history.index + step;
    if (index < 0 || index >= history.urls.length) return;
    history = { ...history, index };
    void load();
  };

  const onMessage = (event: MessageEvent): void => {
    if (page.kind !== "preview" || event.source !== element.contentWindow) return;
    if (event.origin !== page.origin) return;
    const parsed = browserFrameMessageSchema.safeParse(event.data);
    if (!parsed.success) return;
    const message = parsed.data;
    switch (message.type) {
      case "state": {
        scripted = true;
        pendingUrl = null;
        const pageUrl = limitBrowserUrl(message.url);
        previewHistory = { canGoBack: message.canGoBack, canGoForward: message.canGoForward };
        history.urls[history.index] = pageUrl;
        report({
          url: pageUrl,
          title: message.title === null ? null : message.title.slice(0, BROWSER_TITLE_MAX_LENGTH),
          favicon:
            message.favicon !== null && message.favicon.length <= BROWSER_FAVICON_MAX_LENGTH
              ? message.favicon
              : null,
          error:
            message.error === null
              ? null
              : { kind: "load_failed", url: pageUrl, message: message.error },
        });
        return;
      }
      case "loading":
        scripted = false;
        pendingUrl = limitBrowserUrl(message.url);
        report({ loading: true });
        return;
      case "leave":
        void open(message.url);
        return;
      case "focus_address_bar":
        focus.focusAddressBar(tabId);
        return;
    }
  };
  const onLoad = (): void => {
    // The frame script reports before the load ends, so a silent document has no script.
    if (page.kind === "preview" && !scripted && pendingUrl !== null) {
      history = {
        urls: [...history.urls.slice(0, history.index + 1), pendingUrl],
        index: history.index + 1,
      };
      report({ url: pendingUrl, title: null, favicon: null, loading: false, error: null });
      pendingUrl = null;
      return;
    }
    if (state.loading) report({ loading: false });
  };

  window.addEventListener("message", onMessage);
  element.addEventListener("load", onLoad);
  const unregisterControls = controls.register(tabId, {
    load: open,
    run: (command) => {
      if (page.kind === "preview" && previewCan(command)) {
        element.contentWindow?.postMessage({ [BROWSER_FRAME_COMMAND_FIELD]: command }, page.origin);
        if (command === "stop") report({ loading: false });
        return;
      }
      switch (command) {
        case "back":
          move(-1);
          return;
        case "forward":
          move(1);
          return;
        case "reload":
          void load();
          return;
        case "stop":
          // The page of another site does not take commands, so it loads to its end.
          report({ loading: false });
          return;
      }
    },
  });
  const unregisterFocus = focus.registerPage(tabId, () => element.focus());
  void load();
  return () => {
    disposed = true;
    window.removeEventListener("message", onMessage);
    element.removeEventListener("load", onLoad);
    unregisterControls();
    unregisterFocus();
  };
};
