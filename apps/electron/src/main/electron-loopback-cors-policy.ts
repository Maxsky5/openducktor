type OnHeadersReceivedDetails = {
  readonly responseHeaders?: Record<string, string[] | string>;
};

type OnHeadersReceivedCallback = (response: {
  responseHeaders: Record<string, string[] | string>;
}) => void;

type ElectronWebRequest = {
  onHeadersReceived(
    filter: { urls: string[] },
    listener: (details: OnHeadersReceivedDetails, callback: OnHeadersReceivedCallback) => void,
  ): void;
};

type ElectronSession = {
  webRequest: ElectronWebRequest;
};

const LOOPBACK_RESPONSE_URLS = ["http://127.0.0.1:*/*"];
const CORS_ALLOW_HEADERS =
  "content-type, x-opencode-directory, x-opencode-workspace, x-openducktor-app-token";
const CORS_ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
export const ELECTRON_PACKAGED_RENDERER_ORIGIN = "null";

export const resolveElectronLoopbackCorsOrigin = (rendererDevUrl: string | undefined): string =>
  rendererDevUrl ? new URL(rendererDevUrl).origin : ELECTRON_PACKAGED_RENDERER_ORIGIN;

/**
 * The WebSocket origin of a packaged window. Electron enables file access from files, so Chromium
 * keeps the `file://` origin of the window, and the handshake sends it serialized as `file://`.
 * HTTP fetches from the same window send the `null` origin instead.
 */
export const ELECTRON_PACKAGED_RENDERER_SOCKET_ORIGIN = "file://";

/** The origin that a desktop window sends on its host channel socket. */
export const resolveElectronRendererSocketOrigins = (
  rendererDevUrl: string | undefined,
): ReadonlySet<string> =>
  new Set([
    rendererDevUrl ? new URL(rendererDevUrl).origin : ELECTRON_PACKAGED_RENDERER_SOCKET_ORIGIN,
  ]);

export const configureElectronLoopbackCorsPolicy = (
  session: ElectronSession,
  rendererOrigin: string = ELECTRON_PACKAGED_RENDERER_ORIGIN,
): void => {
  session.webRequest.onHeadersReceived({ urls: LOOPBACK_RESPONSE_URLS }, (details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Access-Control-Allow-Origin": [rendererOrigin],
        "Access-Control-Allow-Credentials": ["true"],
        "Access-Control-Allow-Headers": [CORS_ALLOW_HEADERS],
        "Access-Control-Allow-Methods": [CORS_ALLOW_METHODS],
      },
    });
  });
};
