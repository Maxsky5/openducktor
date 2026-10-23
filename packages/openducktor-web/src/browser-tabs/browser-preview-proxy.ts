import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { type Duplex, Transform } from "node:stream";
import { isBrowserFrameUrl } from "@openducktor/contracts";
import { isPreviewAppHostname } from "./browser-preview-hosts";
import { z } from "zod";
import {
  BROWSER_PREVIEW_LEAVE_PATH,
  BROWSER_PREVIEW_SCRIPT_PATH,
  browserPreviewFrameScript,
} from "./browser-preview-frame-script";

/** Cookies of the web runner session. The dev server never gets them. */
const SESSION_COOKIE_PREFIX = "openducktor_web_session";

/** Headers of one connection, which a proxy never forwards. */
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

const listenAddressSchema = z.object({ port: z.number().int().positive() });

const SCRIPT_TAG = Buffer.from(`<script src="${BROWSER_PREVIEW_SCRIPT_PATH}"></script>`);

export type BrowserPreviewProxies = {
  /**
   * The preview origin of a dev server on the host, for an app origin that frames its pages. The
   * first call for a dev server starts its proxy.
   */
  originFor(input: { target: string; appOrigin: string }): Promise<string>;
  close(): Promise<void>;
};

type Preview = {
  server: Server;
  port: number;
  target: URL;
  appOrigins: Set<string>;
  /** Client sockets of WebSocket upgrades. `closeAllConnections` does not close them. */
  upgrades: Set<Duplex>;
};

/**
 * Preview proxies of the web runner. Each dev server on the host gets one proxy on a loopback
 * port, so the app can show its pages in an iframe that the browser of the user draws itself.
 * The proxy accepts only loopback Host headers, which stops DNS rebinding, and lets only the app
 * frame its pages. It adds the frame script to each page and serves the dev server otherwise as
 * it is, WebSocket upgrades included.
 */
export const createBrowserPreviewProxies = (input: {
  reportFailure(message: string, cause: unknown): void;
}): BrowserPreviewProxies => {
  const previews = new Map<string, Promise<Preview>>();

  const start = (target: URL, appOrigin: string, bindHost: string): Promise<Preview> =>
    new Promise((resolve, reject) => {
      const preview: Preview = {
        server: createServer(),
        port: 0,
        target,
        appOrigins: new Set([appOrigin]),
        upgrades: new Set(),
      };
      preview.server.on("request", (request, response) =>
        handleRequest(preview, request, response),
      );
      preview.server.on("upgrade", (request, socket, head) =>
        handleUpgrade(preview, request, socket, head),
      );
      preview.server.on("clientError", (_cause, socket) => socket.destroy());
      preview.server.once("error", reject);
      preview.server.listen(0, bindHost, () => {
        const address = listenAddressSchema.safeParse(preview.server.address());
        if (!address.success) {
          reject(new Error("The preview proxy has no TCP port."));
          return;
        }
        preview.port = address.data.port;
        resolve(preview);
      });
    });

  const handleRequest = (preview: Preview, request: IncomingMessage, response: ServerResponse) => {
    if (!isPreviewHost(request.headers.host, preview.port)) {
      response.writeHead(421, { "content-type": "text/plain" }).end("Wrong host.");
      return;
    }
    const path = request.url ?? "/";
    if (path === BROWSER_PREVIEW_SCRIPT_PATH) {
      response
        .writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-store",
        })
        .end(
          browserPreviewFrameScript({
            targetOrigin: preview.target.origin,
            appOrigins: Array.from(preview.appOrigins),
          }),
        );
      return;
    }
    if (path.startsWith(`${BROWSER_PREVIEW_LEAVE_PATH}?`)) {
      sendLeavePage(response, new URL(path, preview.target).searchParams.get("url") ?? "");
      return;
    }
    const upstream = sendUpstream(preview, request, (upstreamResponse) =>
      relayResponse(preview, request, upstreamResponse, response),
    );
    // A tab that leaves the page closes the response, so the dev server stops its answer too.
    response.once("close", () => {
      if (!response.writableFinished) upstream.destroy();
    });
    upstream.on("error", (cause) => {
      if (response.headersSent) {
        response.destroy(cause);
        return;
      }
      sendErrorPage(response, preview.target, path, cause);
    });
    request.pipe(upstream);
  };

  const handleUpgrade = (
    preview: Preview,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    if (!isPreviewHost(request.headers.host, preview.port)) {
      socket.destroy();
      return;
    }
    preview.upgrades.add(socket);
    socket.once("close", () => preview.upgrades.delete(socket));
    const upstream = sendUpstream(preview, request, (upstreamResponse) => {
      // The dev server refused the upgrade, so the client gets its answer.
      socket.end(
        `HTTP/1.1 ${upstreamResponse.statusCode ?? 502} ${upstreamResponse.statusMessage ?? ""}\r\n\r\n`,
      );
      upstreamResponse.resume();
    });
    upstream.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n${headerLines(upstreamResponse.rawHeaders)}\r\n`,
      );
      if (upstreamHead.length > 0) socket.write(upstreamHead);
      if (head.length > 0) upstreamSocket.write(head);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
      const close = () => {
        socket.destroy();
        upstreamSocket.destroy();
      };
      socket.on("error", close);
      upstreamSocket.on("error", close);
      socket.on("close", close);
      upstreamSocket.on("close", close);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    // Upgrade sockets stay half-open after client EOF, so close them to cancel the handshake.
    socket.once("end", () => socket.destroy());
    socket.once("close", () => upstream.destroy());
    upstream.end();
  };

  /** Sends a client request to the dev server, as if the client had sent it there. */
  const sendUpstream = (
    preview: Preview,
    request: IncomingMessage,
    onResponse: (response: IncomingMessage) => void,
  ) => {
    const { target } = preview;
    const upgrade = request.headers.upgrade !== undefined;
    const headers = upstreamHeaders(request.headers, preview, upgrade);
    const options = {
      hostname: target.hostname.replace(/^\[|\]$/g, ""),
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method: request.method,
      path: request.url,
      headers,
    };
    // A dev server on the host often has a self-signed certificate.
    return target.protocol === "https:"
      ? httpsRequest({ ...options, rejectUnauthorized: false }, onResponse)
      : httpRequest(options, onResponse);
  };

  const relayResponse = (
    preview: Preview,
    request: IncomingMessage,
    upstream: IncomingMessage,
    response: ServerResponse,
  ) => {
    const headers = downstreamHeaders(upstream.headers, preview, request.url);
    const status = upstream.statusCode ?? 502;
    // `pipe` does not end the response when the dev server drops its answer.
    upstream.on("error", (cause) => response.destroy(cause));
    const injects =
      request.method !== "HEAD" &&
      status !== 204 &&
      status !== 304 &&
      /^text\/html\b/i.test(String(upstream.headers["content-type"] ?? "")) &&
      (upstream.headers["content-encoding"] ?? "identity") === "identity";
    if (!injects) {
      response.writeHead(status, upstream.statusMessage, headers);
      upstream.pipe(response);
      return;
    }
    // The frame script changes the length of the page.
    delete headers["content-length"];
    response.writeHead(status, upstream.statusMessage, headers);
    const nonce = scriptNonce(upstream.headers["content-security-policy"]);
    upstream.pipe(withFrameScript(nonce)).pipe(response);
  };

  const upstreamHeaders = (
    incoming: IncomingHttpHeaders,
    preview: Preview,
    upgrade: boolean,
  ): OutgoingHttpHeaders => {
    const headers: OutgoingHttpHeaders = { ...incoming, host: preview.target.host };
    if (!upgrade) {
      for (const name of HOP_BY_HOP_HEADERS) delete headers[name];
    }
    // The proxy reads each page as it is, so it can add the frame script.
    headers["accept-encoding"] = "identity";
    if (isPreviewUrl(incoming.origin, preview)) headers.origin = preview.target.origin;
    if (incoming.referer !== undefined) {
      headers.referer = toTargetUrl(incoming.referer, preview);
    }
    const cookie = withoutSessionCookies(incoming.cookie);
    if (cookie === null) delete headers.cookie;
    else headers.cookie = cookie;
    return headers;
  };

  const downstreamHeaders = (
    incoming: IncomingHttpHeaders,
    preview: Preview,
    requestPath: string | undefined,
  ) => {
    const headers: OutgoingHttpHeaders = { ...incoming };
    for (const name of HOP_BY_HOP_HEADERS) delete headers[name];
    delete headers["x-frame-options"];
    headers["content-security-policy"] = withFrameAncestors(
      incoming["content-security-policy"],
      Array.from(preview.appOrigins),
    );
    if (incoming.location !== undefined) {
      headers.location = previewLocation(incoming.location, preview, requestPath);
    }
    // The preview can use another loopback name than the dev server, such as `127.0.0.1`.
    const cookies = incoming["set-cookie"];
    if (cookies !== undefined) {
      headers["set-cookie"] = cookies.map((cookie) =>
        withoutDomainOf(cookie, preview.target.hostname),
      );
    }
    return headers;
  };

  /** True for a URL of the preview origin itself, such as the origin of a preview page request. */
  const isPreviewUrl = (url: string | undefined, preview: Preview): url is string =>
    url !== undefined && URL.canParse(url) && isPreviewHost(new URL(url).host, preview.port);

  const toTargetUrl = (url: string, preview: Preview): string => {
    if (!isPreviewUrl(url, preview)) return url;
    const parsed = new URL(url);
    return `${preview.target.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  };

  /**
   * A redirect stays in the preview for the dev server, and goes to the leave page otherwise. A
   * relative location resolves against the page that the dev server answered.
   */
  const previewLocation = (
    location: string,
    preview: Preview,
    requestPath: string | undefined,
  ): string => {
    const url = new URL(location, new URL(requestPath ?? "/", preview.target));
    if (url.origin === preview.target.origin) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return location;
    return `${BROWSER_PREVIEW_LEAVE_PATH}?url=${encodeURIComponent(url.href)}`;
  };

  return {
    originFor: async ({ target, appOrigin }) => {
      if (!isBrowserFrameUrl(target)) {
        throw new Error(`OpenDucktor previews only pages of this machine, not ${target}.`);
      }
      const targetUrl = new URL(new URL(target).origin);
      const app = new URL(appOrigin);
      const bindHost = app.hostname === "[::1]" ? "::1" : "127.0.0.1";
      const key = `${targetUrl.origin} ${bindHost}`;
      let pending = previews.get(key);
      if (!pending) {
        pending = start(targetUrl, app.origin, bindHost);
        previews.set(key, pending);
        pending.catch((cause: unknown) => {
          previews.delete(key);
          input.reportFailure(`The preview of ${targetUrl.origin} could not start.`, cause);
        });
      }
      const preview = await pending;
      preview.appOrigins.add(app.origin);
      return `http://${app.hostname}:${preview.port}`;
    },
    close: async () => {
      const all = await Promise.allSettled(previews.values());
      previews.clear();
      await Promise.all(
        all.flatMap((result) =>
          result.status === "fulfilled"
            ? [
                new Promise<void>((resolve) => {
                  for (const socket of result.value.upgrades) socket.destroy();
                  result.value.server.closeAllConnections();
                  result.value.server.close(() => resolve());
                }),
              ]
            : [],
        ),
      );
    },
  };
};

const isPreviewHost = (host: string | undefined, port: number): boolean => {
  const suffix = `:${port}`;
  return host?.endsWith(suffix) === true && isPreviewAppHostname(host.slice(0, -suffix.length));
};

const withoutSessionCookies = (cookie: string | undefined): string | null => {
  if (cookie === undefined) return null;
  const kept = cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith(SESSION_COOKIE_PREFIX));
  return kept.length > 0 ? kept.join("; ") : null;
};

/** Lets only the app frame the page. Other directives of the page stay as they are. */
const withFrameAncestors = (
  policy: string | string[] | undefined,
  appOrigins: readonly string[],
): string => {
  const ancestors = `frame-ancestors ${appOrigins.join(" ")}`;
  const policies = policy === undefined ? [] : Array.isArray(policy) ? policy : [policy];
  if (policies.length === 0) return ancestors;
  return policies
    .map((value) =>
      [
        ...value
          .split(";")
          .map((directive) => directive.trim())
          .filter((directive) => directive.length > 0 && !/^frame-ancestors\b/i.test(directive)),
        ancestors,
      ].join("; "),
    )
    .join(", ");
};

/**
 * The script nonce of the page policy, or null. The frame script gets it, so a policy that runs
 * only scripts with a nonce runs the frame script too.
 */
const scriptNonce = (policy: string | string[] | undefined): string | null =>
  /(?:^|[;,])\s*(?:script-src-elem|script-src|default-src)\s[^;,]*'nonce-([\w+/=-]+)'/i.exec(
    [policy ?? []].flat().join(", "),
  )?.[1] ?? null;

/** Drops a cookie `Domain` that names `hostname`, so the cookie belongs to the preview host. */
const withoutDomainOf = (cookie: string, hostname: string): string =>
  cookie.replace(/;\s*domain=\.?([^;]*)/gi, (attribute, domain: string) =>
    domain.trim().toLowerCase() === hostname ? "" : attribute,
  );

/** The index after the first `tag` in `html`, or null when `html` has no such tag. */
const tagEnd = (html: Buffer, tag: RegExp): number | null => {
  const match = tag.exec(html.toString("latin1"));
  return match ? match.index + match[0].length : null;
};

/**
 * Adds the frame script as the first child of `<head>`, so it runs before page scripts. The page
 * waits only until its `<head>` tag arrives, so a streamed page shows its first content at once.
 * A page without `<head>` gets the script after `<html>`, or first.
 */
const withFrameScript = (nonce: string | null): Transform => {
  let start: Buffer | null = Buffer.alloc(0);
  const script =
    nonce === null
      ? SCRIPT_TAG
      : Buffer.from(`<script nonce="${nonce}" src="${BROWSER_PREVIEW_SCRIPT_PATH}"></script>`);
  const inject = (html: Buffer, at: number) =>
    Buffer.concat([html.subarray(0, at), script, html.subarray(at)]);
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      if (start === null) {
        done(null, chunk);
        return;
      }
      start = Buffer.concat([start, chunk]);
      const at = tagEnd(start, /<head(\s[^>]*)?>/i);
      if (at === null) {
        done();
        return;
      }
      const page = inject(start, at);
      start = null;
      done(null, page);
    },
    flush(done) {
      done(
        null,
        start === null ? undefined : inject(start, tagEnd(start, /<html(\s[^>]*)?>/i) ?? 0),
      );
    },
  });
};

const headerLines = (rawHeaders: readonly string[]): string => {
  let lines = "";
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    lines += `${rawHeaders[index]}: ${rawHeaders[index + 1]}\r\n`;
  }
  return lines;
};

const escapeHtml = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );

const PAGE_STYLE = `<style>:root{color-scheme:light dark}body{margin:0;display:grid;place-items:center;min-height:100vh;font:14px/1.5 system-ui,sans-serif}main{max-width:28rem;padding:1.5rem;text-align:center}a{color:inherit}</style>`;

/** The page of a dev server that does not answer. The app shows the error in the tab. */
const sendErrorPage = (
  response: ServerResponse,
  target: URL,
  path: string,
  cause: NodeJS.ErrnoException,
) => {
  const reason =
    cause.code === "ECONNREFUSED"
      ? "nothing listens on its port"
      : cause.message || (cause.code ?? "the connection failed");
  const message = `${target.origin}${path} did not answer: ${reason}. Start the dev server, then reload.`;
  response
    .writeHead(502, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
    .end(
      `<!doctype html><html><head><script>window.__openducktorFrameError=${JSON.stringify(
        message,
      ).replace(/</g, "\\u003c")};</script>${SCRIPT_TAG.toString()}<title>${escapeHtml(
        target.host,
      )}</title>${PAGE_STYLE}</head><body><main><p>${escapeHtml(message)}</p></main></body></html>`,
    );
};

/**
 * A redirect to a site outside the host stops here, because a frame shows only pages of this
 * machine. The frame script asks the app to load the site on a host page in the same tab.
 */
const sendLeavePage = (response: ServerResponse, url: string) => {
  const host = URL.canParse(url) ? new URL(url).host : "another site";
  response
    .writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
    .end(
      `<!doctype html><html><head>${SCRIPT_TAG.toString()}<title>${escapeHtml(host)}</title>${PAGE_STYLE}</head><body><main><p>Opening ${escapeHtml(
        host,
      )}...</p></main></body></html>`,
    );
};
