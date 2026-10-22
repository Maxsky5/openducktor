import {
  type BrowserFrameSource,
  isBrowserFrameUrl,
  isBrowserNavigableUrl,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import { errorMessage, WebHostRequestError } from "@openducktor/remote-host/effect/web-errors";
import type { BrowserPreviewProxies } from "./browser-preview-proxy";
import { isPreviewAppHostname } from "./browser-preview-hosts";
import { BROWSER_FRAME_SOURCE_PATH } from "./browser-route-paths";

const frameSourceRequestSchema = z.strictObject({ target: z.string().min(1).max(8_192) });

export type BrowserFrameRouteContext = {
  appToken: string;
  corsHeaders: HeadersInit;
  previews: BrowserPreviewProxies;
  /** Asks a site outside the host whether the app can frame it. */
  checkSiteFraming(input: { target: string; appOrigin: string }): Promise<BrowserFrameSource>;
  request: Request;
  validateAppTokenHeader: (
    request: Request,
    expectedToken: string,
  ) => Effect.Effect<void, WebHostRequestError>;
};

/** The app origin of a request from an app on this machine. Only such an app shows frame tabs. */
const localAppOrigin = (request: Request): string | null => {
  const origin = request.headers.get("origin");
  if (origin === null || !URL.canParse(origin)) return null;
  const parsed = new URL(origin);
  return parsed.protocol === "http:" && isPreviewAppHostname(parsed.hostname) ? origin : null;
};

/**
 * Tells the app how to show a page in the iframe of a user tab: from a preview of a dev server on
 * the host, at its own URL, or not at all when the site refuses frames. Previews listen only on
 * loopback addresses, so only an app on this machine can use them.
 */
export const routeBrowserFrameHttpRequest = (
  context: BrowserFrameRouteContext,
): Effect.Effect<Response | null, WebHostRequestError> =>
  Effect.gen(function* () {
    const { request } = context;
    if (new URL(request.url).pathname !== BROWSER_FRAME_SOURCE_PATH || request.method !== "POST") {
      return null;
    }
    yield* context.validateAppTokenHeader(request, context.appToken);
    const appOrigin = localAppOrigin(request);
    if (appOrigin === null) {
      return yield* new WebHostRequestError({
        message:
          "Browser tabs need the OpenDucktor app on this machine. Open it with a localhost address.",
        status: 400,
      });
    }
    const body = yield* Effect.tryPromise({
      try: () => request.json(),
      catch: (cause) =>
        new WebHostRequestError({
          message: "The frame request needs a JSON body.",
          status: 400,
          cause,
        }),
    });
    const parsed = frameSourceRequestSchema.safeParse(body);
    if (!parsed.success || !isBrowserNavigableUrl(parsed.data.target)) {
      return yield* new WebHostRequestError({
        message: "The frame request needs an http or https page address in `target`.",
        status: 400,
      });
    }
    const { target } = parsed.data;
    const source = yield* Effect.tryPromise({
      try: async (): Promise<BrowserFrameSource> =>
        isBrowserFrameUrl(target)
          ? { kind: "preview", origin: await context.previews.originFor({ target, appOrigin }) }
          : context.checkSiteFraming({ target, appOrigin }),
      catch: (cause) =>
        new WebHostRequestError({ message: errorMessage(cause), status: 502, cause }),
    });
    return new Response(JSON.stringify(source), {
      headers: { "content-type": "application/json; charset=utf-8", ...context.corsHeaders },
    });
  });
