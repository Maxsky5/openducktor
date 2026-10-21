import { browserUrlScheme, isBrowserTabLoadableUrl } from "@openducktor/contracts";
import {
  ELECTRON_DEVTOOLS_PARTITION,
  workspaceIdOfBrowserPartition,
} from "../../shared/electron-browser-partitions";

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
  | { readonly allow: true; readonly kind: "browser"; readonly workspaceId: string }
  | { readonly allow: true; readonly kind: "devtools" }
  | { readonly allow: false; readonly reason: string };

/**
 * Decides whether the OpenDucktor window may attach a `<webview>`. Only two guest kinds exist: a
 * browser tab in the partition of its workspace, and the bundled DevTools frontend.
 */
export const decideWebviewAttach = (params: {
  readonly src: string;
  readonly partition: string;
}): WebviewAttachDecision => {
  if (params.partition === ELECTRON_DEVTOOLS_PARTITION) {
    return isDevToolsFrontendUrl(params.src)
      ? { allow: true, kind: "devtools" }
      : { allow: false, reason: "A DevTools webview can load only the bundled DevTools frontend." };
  }
  const workspaceId = workspaceIdOfBrowserPartition(params.partition);
  if (workspaceId === null) {
    return {
      allow: false,
      reason: `A webview cannot use the partition "${params.partition}".`,
    };
  }
  if (refusedBrowserPageScheme(params.src) !== null) {
    return {
      allow: false,
      reason: "A browser webview can start only with an http, https, or about:blank source.",
    };
  }
  return { allow: true, kind: "browser", workspaceId };
};

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

/** Removes preload scripts and forces the sandbox for every guest page. */
export const hardenWebviewPreferences = (preferences: WebviewPreferences): void => {
  delete preferences.preload;
  delete preferences.preloadURL;
  preferences.sandbox = true;
  preferences.contextIsolation = true;
  preferences.nodeIntegration = false;
  preferences.nodeIntegrationInSubFrames = false;
  preferences.webSecurity = true;
};
