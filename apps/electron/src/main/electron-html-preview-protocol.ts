import type { Session } from "electron";
import { htmlPreviewBootstrapResponse } from "@openducktor/remote-host/html-preview-bootstrap";
import {
  ELECTRON_HTML_PREVIEW_PROTOCOL,
  ELECTRON_HTML_PREVIEW_URL,
} from "../shared/electron-bridge-contract";

export type ElectronPreviewPermissionRequestHandler = Parameters<
  Session["setPermissionRequestHandler"]
>[0];

export type ElectronPreviewPermissionCheckHandler = Parameters<
  Session["setPermissionCheckHandler"]
>[0];

export type ElectronPreviewDevicePermissionHandler = Parameters<
  Session["setDevicePermissionHandler"]
>[0];

type ElectronHtmlPreviewProtocolSession = {
  protocol: {
    handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): void;
  };
};

export type ElectronRendererPermissionSession = {
  setPermissionRequestHandler(handler: ElectronPreviewPermissionRequestHandler): void;
  setPermissionCheckHandler(handler: ElectronPreviewPermissionCheckHandler): void;
  setDevicePermissionHandler(handler: ElectronPreviewDevicePermissionHandler): void;
};

/**
 * Returns true only for the trusted Electron app-shell origin (the dev server origin in
 * development, or `file://` in the packaged app). Empty strings, `"null"`, `about:`, `blob:`,
 * `data:`, and isolated preview custom schemes always return false.
 */
export const isTrustedRendererOrigin = (
  value: string | undefined,
  rendererDevUrl: string | undefined,
): boolean => {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (rendererDevUrl !== undefined) {
    try {
      return new URL(trimmed).origin === new URL(rendererDevUrl).origin;
    } catch {
      return false;
    }
  }
  return trimmed.toLowerCase().startsWith("file://");
};

export const registerElectronHtmlPreviewProtocol = (
  session: ElectronHtmlPreviewProtocolSession,
): void => {
  session.protocol.handle(ELECTRON_HTML_PREVIEW_PROTOCOL, (request) => {
    // The viewer puts the app surface in the fragment. A network request drops the fragment,
    // and the split keeps the fixed-route check true if a runtime keeps it.
    const [requestUrl] = request.url.split("#", 1);
    if (request.method !== "GET" || requestUrl !== ELECTRON_HTML_PREVIEW_URL) {
      return new Response("HTML preview route not found.", { status: 404 });
    }
    return htmlPreviewBootstrapResponse();
  });
};

/**
 * Installs fail-closed permission handlers on the Electron renderer session so only the main
 * frame of the trusted app shell can pass permission checks or prompts. Subframes, isolated
 * preview schemes, `about:`, `blob:`, `data:`, `"null"`, and empty URLs are denied, and all
 * device permissions (USB, HID, Serial, Bluetooth) are denied unconditionally.
 */
export const configureElectronRendererPermissions = (
  session: ElectronRendererPermissionSession,
  rendererDevUrl: string | undefined,
): void => {
  session.setPermissionRequestHandler((_webContents, _permission, callback, details) => {
    const securityOrigin = "securityOrigin" in details ? details.securityOrigin : undefined;
    const trusted =
      details.isMainFrame === true &&
      isTrustedRendererOrigin(details.requestingUrl, rendererDevUrl) &&
      (securityOrigin === undefined || isTrustedRendererOrigin(securityOrigin, rendererDevUrl));
    callback(trusted);
  });

  session.setPermissionCheckHandler((_webContents, _permission, requestingOrigin, details) => {
    if (details.isMainFrame === false) return false;
    if (!isTrustedRendererOrigin(requestingOrigin, rendererDevUrl)) return false;
    if (
      details.requestingUrl !== undefined &&
      details.requestingUrl.length > 0 &&
      !isTrustedRendererOrigin(details.requestingUrl, rendererDevUrl)
    ) {
      return false;
    }
    if (
      details.securityOrigin !== undefined &&
      details.securityOrigin.length > 0 &&
      !isTrustedRendererOrigin(details.securityOrigin, rendererDevUrl)
    ) {
      return false;
    }
    return true;
  });

  session.setDevicePermissionHandler(() => false);
};
