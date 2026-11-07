import { browserUrlScheme, isBrowserTabLoadableUrl } from "@openducktor/contracts";
import { ELECTRON_DEVTOOLS_PARTITION } from "../../shared/electron-browser-partitions";

/** The `Origin` that the bundled DevTools frontend sends. Web pages cannot send it. */
export const DEVTOOLS_FRONTEND_ORIGIN = "devtools://devtools";
const DEVTOOLS_FRONTEND_PATH = "/bundled/devtools_app.html";

/**
 * The scheme of a URL that a browser tab must not load as its page, or `null` when the tab may
 * load it. Tabs load only `http`, `https`, and the blank page.
 */
export const refusedBrowserPageScheme = (url: string): string | null =>
  isBrowserTabLoadableUrl(url) ? null : (browserUrlScheme(url) ?? "invalid");

const isDevToolsFrontendUrl = (url: string): boolean => {
  try {
    // `devtools:` is not a special URL scheme, so its URL origin is opaque. Compare the parts.
    const parsed = new URL(url);
    return (
      `${parsed.protocol}//${parsed.host}` === DEVTOOLS_FRONTEND_ORIGIN &&
      parsed.pathname === DEVTOOLS_FRONTEND_PATH
    );
  } catch {
    return false;
  }
};

export type WebviewAttachDecision =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: string };

/**
 * Decides whether the OpenDucktor window may attach a `<webview>`. Browser tabs are
 * `WebContentsView` pages that the engine creates, so only the bundled DevTools frontend attaches.
 */
export const decideWebviewAttach = (params: {
  readonly src: string;
  readonly partition: string;
}): WebviewAttachDecision => {
  if (params.partition !== ELECTRON_DEVTOOLS_PARTITION) {
    return {
      allow: false,
      reason: `A webview cannot use the partition "${params.partition}".`,
    };
  }
  return isDevToolsFrontendUrl(params.src)
    ? { allow: true }
    : { allow: false, reason: "A DevTools webview can load only the bundled DevTools frontend." };
};

/** The security preferences of every guest page, webview or native view. */
export const HARDENED_GUEST_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
} as const;

/** The `<webview>` preferences that the attach hardening changes. */
export type WebviewPreferences = {
  preload?: string;
  preloadURL?: string;
  sandbox?: boolean;
  contextIsolation?: boolean;
  nodeIntegration?: boolean;
  nodeIntegrationInSubFrames?: boolean;
  webSecurity?: boolean;
};

/** Removes preload scripts and forces the hardened guest preferences for every guest page. */
export const hardenWebviewPreferences = (preferences: WebviewPreferences): void => {
  delete preferences.preload;
  delete preferences.preloadURL;
  Object.assign(preferences, HARDENED_GUEST_PREFERENCES);
};
