import {
  type BrowserFrameSource,
  browserFrameSourceSchema,
  isBrowserFrameUrl,
} from "@openducktor/contracts";
import type {
  BrowserFrameBridge,
  FrameBrowserBridge,
} from "@openducktor/frontend/lib/shell-bridge";
import { Effect } from "effect";
import { getBrowserAuthTokenEffect, getBrowserBackendUrlEffect } from "../browser-config";
import {
  errorMessage,
  runWebBoundary,
  WebDependencyError,
  type WebError,
  WebHostRequestError,
} from "@openducktor/remote-host/effect/web-errors";
import { readLocalHostErrorPayloadEffect } from "../local-host-errors";
import { APP_TOKEN_HEADER, ensureLocalHostSessionDedupedEffect } from "../local-host-transport";
import { isPreviewAppHostname } from "./browser-preview-hosts";
import { BROWSER_FRAME_SOURCE_PATH } from "./browser-route-paths";

const frameSourceEffect = (target: string): Effect.Effect<BrowserFrameSource, WebError> =>
  Effect.gen(function* () {
    yield* ensureLocalHostSessionDedupedEffect();
    const baseUrl = (yield* getBrowserBackendUrlEffect()).replace(/\/$/, "");
    const appToken = yield* getBrowserAuthTokenEffect();
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${baseUrl}${BROWSER_FRAME_SOURCE_PATH}`, {
          method: "POST",
          credentials: "include",
          headers: { [APP_TOKEN_HEADER]: appToken, "content-type": "application/json" },
          body: JSON.stringify({ target }),
        }),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "local-web-host",
          operation: "browser-frame-source",
          message: errorMessage(cause),
          cause,
        }),
    });
    if (!response.ok) {
      const { message } = yield* readLocalHostErrorPayloadEffect(response);
      return yield* new WebHostRequestError({ message, status: response.status });
    }
    const body = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        new WebHostRequestError({
          message: "The frame source answer is not JSON.",
          status: response.status,
          cause,
        }),
    });
    return browserFrameSourceSchema.parse(body);
  });

/**
 * Browser tabs exist only when this app runs on the host machine at a host name that previews
 * serve, because the previews of host pages listen only on loopback addresses. They need plain
 * HTTP, because an HTTPS app cannot frame them.
 */
export const createBrowserFrameBridge = (
  location: Pick<Location, "protocol" | "hostname">,
): BrowserFrameBridge | null => {
  if (location.protocol !== "http:" || !isPreviewAppHostname(location.hostname)) return null;
  // One preview serves every page of a dev server, so the app asks once for each server origin.
  const previews = new Map<string, Promise<BrowserFrameSource>>();
  return {
    source: (url) => {
      if (!isBrowserFrameUrl(url)) return runWebBoundary(frameSourceEffect(url));
      const origin = new URL(url).origin;
      let source = previews.get(origin);
      if (!source) {
        source = runWebBoundary(frameSourceEffect(origin));
        previews.set(origin, source);
        // A failed request asks again next time, for example after the dev server starts.
        source.catch(() => previews.delete(origin));
      }
      return source;
    },
  };
};

/** The web runner shows each user tab in an iframe that the browser of the user draws itself. */
export const createBrowserTabBridge = (): FrameBrowserBridge => {
  let frames: BrowserFrameBridge | null | undefined;
  return {
    surface: "frame",
    // The app location exists only in the browser, so the frame support starts on first use.
    get frames() {
      if (frames === undefined) frames = createBrowserFrameBridge(globalThis.location);
      return frames;
    },
  };
};
