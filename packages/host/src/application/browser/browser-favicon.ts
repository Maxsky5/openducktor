import { BROWSER_FAVICON_MAX_LENGTH, isBrowserNavigableUrl } from "@openducktor/contracts";
import { Effect } from "effect";
import type { CdpSession } from "../../ports/browser-engine-port";
import {
  ioReadResultSchema,
  loadNetworkResourceResultSchema,
} from "../../ports/browser-cdp-schemas";

const MAX_FAVICON_BYTES = 32 * 1024;

/**
 * Loads the page icon through the network context of the page, so the host sees the same
 * `localhost` as the page. The result is a `data:` URL that a remote client can show. A page
 * without a loadable icon has no favicon, and the tab shows the default icon.
 */
export const loadBrowserFavicon = (
  session: Pick<CdpSession, "send">,
  input: { frameId: string; iconUrl: string | null; origin: string },
): Effect.Effect<string | null> =>
  Effect.gen(function* () {
    const url =
      input.iconUrl ??
      (isBrowserNavigableUrl(input.origin) ? new URL("/favicon.ico", input.origin).href : null);
    if (url === null) {
      return null;
    }
    if (url.startsWith("data:image/")) {
      return url.length <= BROWSER_FAVICON_MAX_LENGTH ? url : null;
    }
    if (!isBrowserNavigableUrl(url)) {
      return null;
    }
    const loaded = loadNetworkResourceResultSchema.parse(
      yield* session.send("Network.loadNetworkResource", {
        frameId: input.frameId,
        url,
        options: { disableCache: false, includeCredentials: true },
      }),
    );
    const { resource } = loaded;
    if (!resource.success || resource.stream === undefined) {
      return null;
    }
    const handle = resource.stream;
    const bytes = yield* readStream(session, handle).pipe(
      Effect.ensuring(session.send("IO.close", { handle }).pipe(Effect.ignore)),
    );
    const status = resource.httpStatusCode ?? 200;
    if (bytes.length === 0 || bytes.length > MAX_FAVICON_BYTES || status >= 400) {
      return null;
    }
    const contentType = headerValue(resource.headers, "content-type")?.split(";")[0]?.trim();
    const imageType = contentType?.startsWith("image/") ? contentType : imageTypeForUrl(url);
    if (imageType === null) {
      return null;
    }
    const dataUrl = `data:${imageType};base64,${bytes.toString("base64")}`;
    return dataUrl.length <= BROWSER_FAVICON_MAX_LENGTH ? dataUrl : null;
  }).pipe(Effect.catch(() => Effect.succeed(null)));

const imageTypeForUrl = (url: string): string | null => {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return null;
};

const headerValue = (headers: Record<string, string> | undefined, name: string): string | null => {
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === name) {
      return value;
    }
  }
  return null;
};

/** Reads a CDP stream until its end, or until it is larger than a favicon can be. */
const readStream = (session: Pick<CdpSession, "send">, handle: string) =>
  Effect.gen(function* () {
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= MAX_FAVICON_BYTES) {
      const chunk = ioReadResultSchema.parse(
        yield* session.send("IO.read", { handle, size: MAX_FAVICON_BYTES }),
      );
      const bytes = Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "latin1");
      chunks.push(bytes);
      total += bytes.length;
      if (chunk.eof) {
        break;
      }
    }
    return Buffer.concat(chunks);
  });
