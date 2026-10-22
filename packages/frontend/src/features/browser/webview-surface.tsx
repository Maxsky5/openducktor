import { BROWSER_BLANK_URL } from "@openducktor/contracts";
import { createElement, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { WebviewBrowserBridge } from "@/lib/shell-bridge";
import type { BrowserChannel } from "./browser-channel";
import type { BrowserFocusRegistry } from "./browser-focus-registry";

/** An Electron `<webview>` element. The renderer has no Electron types. */
type ElectronWebviewElement = HTMLElement & { getWebContentsId(): number };

/** The focus move of a press can reach the renderer a little after the reply of the press. */
const AGENT_PRESS_SETTLE_MS = 300;
/** Ends the guard when the end of a press never comes, for example after a lost connection. */
const AGENT_PRESS_LIMIT_MS = 10_000;

/**
 * The `<webview>` of one browser tab. It starts blank, and its first `dom-ready` binds the guest
 * to the tab. The engine then takes control of the page and loads the tab URL, so the page never
 * runs without the host and loads once.
 */
export function WebviewBrowserSurface({
  bridge,
  channel,
  focus,
  tabId,
  workspaceId,
}: {
  bridge: WebviewBrowserBridge;
  channel: BrowserChannel;
  focus: Pick<BrowserFocusRegistry, "registerPage">;
  tabId: string;
  workspaceId: string;
}) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const bound = useRef(false);
  useAgentFocusGuard(element, channel, tabId);
  useEffect(
    () => (element === null ? undefined : focus.registerPage(tabId, () => element.focus())),
    [element, focus, tabId],
  );

  useEffect(() => {
    if (element === null) return;
    const webview = asWebview(element);
    const onReady = (): void => {
      if (bound.current) return;
      bound.current = true;
      bridge.bindGuest(tabId, webview.getWebContentsId()).catch((cause: unknown) => {
        bound.current = false;
        toast.error("Could not connect the browser tab", { description: errorMessage(cause) });
      });
    };
    webview.addEventListener("dom-ready", onReady);
    return () => webview.removeEventListener("dom-ready", onReady);
  }, [element, bridge, tabId]);

  return createElement("webview", {
    ref: setElement,
    partition: bridge.partition(workspaceId),
    src: BROWSER_BLANK_URL,
    allowpopups: "",
    // Electron sizes the guest frame through the `display: flex` of the `<webview>`. Another
    // display value leaves the page at the default iframe height of 150 px. A page without a
    // background is white, as in a browser.
    className: "flex h-full w-full bg-white",
    "data-testid": "browser-webview",
  });
}

/** The bundled Electron DevTools frontend of one browser tab. */
export function DevToolsWebviewSurface({ frontendUrl }: { frontendUrl: string }) {
  return createElement("webview", {
    partition: "persist:openducktor-devtools",
    src: frontendUrl,
    className: "flex h-full w-full bg-background",
    "data-testid": "browser-devtools-webview",
  });
}

/**
 * Keeps the keyboard focus of the user while an agent presses the mouse in the page. Electron
 * moves the focus to the `<webview>` element when a press reaches its guest, and that focus event
 * names no previous element, so the guard follows the focus of the user itself. The host reports
 * each agent press with `agent_press`, from the command to its reply. When the focus moves to the
 * `<webview>` during a press, the element that the user had focused takes it back. With no such
 * element, the `<webview>` gives up the focus. The guard does not change user input at other times.
 */
const useAgentFocusGuard = (
  element: HTMLElement | null,
  channel: Pick<BrowserChannel, "subscribe">,
  tabId: string,
): void => {
  useEffect(() => {
    if (element === null) return;
    let guardUntil = 0;
    let userFocus = focusedElement() === element ? null : focusedElement();
    const unsubscribe = channel.subscribe((message) => {
      if (message.type !== "agent_press" || message.tabId !== tabId) return;
      guardUntil = Date.now() + (message.pressing ? AGENT_PRESS_LIMIT_MS : AGENT_PRESS_SETTLE_MS);
    });
    const onFocusIn = (event: FocusEvent): void => {
      if (event.target instanceof HTMLElement && event.target !== element) {
        userFocus = event.target;
      }
    };
    // The focus leaves for nothing, for example after a click on empty space.
    const onFocusOut = (): void => {
      queueMicrotask(() => {
        if (focusedElement() === null) userFocus = null;
      });
    };
    const onFocus = (): void => {
      if (Date.now() > guardUntil) return;
      if (userFocus?.isConnected) {
        userFocus.focus({ preventScroll: true });
        return;
      }
      element.blur();
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    element.addEventListener("focus", onFocus);
    return () => {
      unsubscribe();
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      element.removeEventListener("focus", onFocus);
    };
  }, [element, channel, tabId]);
};

const asWebview = (element: HTMLElement): ElectronWebviewElement =>
  // SAFETY: the element is a `<webview>` tag, which Electron gives `getWebContentsId`.
  element as ElectronWebviewElement;

/** The element that has the focus, or null when nothing has it. */
const focusedElement = (): HTMLElement | null => {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
};
