import { BROWSER_BLANK_URL } from "@openducktor/contracts";
import {
  createElement,
  type ReactElement,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
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

type WebviewBrowserSurfaceProps = {
  bridge: WebviewBrowserBridge;
  channel: BrowserChannel;
  focus: Pick<BrowserFocusRegistry, "registerPage">;
  isShown: boolean;
  tabId: string;
  workspaceId: string;
};

/**
 * The `<webview>` of one browser tab. It starts blank, and its first `dom-ready` binds the guest
 * to the tab. The engine then takes control of the page and loads the tab URL, so the page never
 * runs without the host and loads once.
 */
export function WebviewBrowserSurface({
  bridge,
  channel,
  focus,
  isShown,
  tabId,
  workspaceId,
}: WebviewBrowserSurfaceProps): ReactElement {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const bound = useRef(false);
  useAgentFocusGuard(element, channel, tabId, isShown);
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
 * Keeps user focus outside hidden pages, and outside shown pages during an agent press.
 * Electron can focus a guest without a webview focus event. The window blur event also reports
 * that move, after its active element changes to the webview. Hidden pages stay guarded even
 * before the press notification arrives or after it ends.
 */
const useAgentFocusGuard = (
  element: HTMLElement | null,
  channel: Pick<BrowserChannel, "subscribe">,
  tabId: string,
  isShown: boolean,
): void => {
  const isShownNow = useEffectEvent(() => isShown);
  useEffect(() => {
    if (element === null) return;
    let guardUntil = 0;
    let userFocus = focusedElement() === element ? null : focusedElement();
    const unsubscribe = channel.subscribe((message) => {
      if (message.type !== "agent_press" || message.tabId !== tabId) return;
      guardUntil = Date.now() + (message.pressing ? AGENT_PRESS_LIMIT_MS : AGENT_PRESS_SETTLE_MS);
    });
    const onFocusIn = (event: FocusEvent): void => {
      const active = focusedElement();
      // A nested focus restore can finish before the original focusin event reaches this guard.
      if (active !== null && active !== element && event.target === active) {
        userFocus = active;
      }
    };
    // The focus leaves for nothing, for example after a click on empty space.
    const onFocusOut = (): void => {
      queueMicrotask(() => {
        if (focusedElement() === null) userFocus = null;
      });
    };
    const onFocus = (): void => {
      if (focusedElement() !== element || (isShownNow() && Date.now() > guardUntil)) return;
      if (userFocus?.isConnected) {
        userFocus.focus({ preventScroll: true });
        return;
      }
      element.blur();
    };
    // Wait until Chromium finishes moving focus into the guest before restoring the field.
    const onWindowBlur = (): void => queueMicrotask(onFocus);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    element.addEventListener("focus", onFocus);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      unsubscribe();
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      element.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onWindowBlur);
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
