import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import {
  type BrowserRuntimeConfigState,
  readBrowserRuntimeConfig,
} from "./browser-runtime-config-state";
import { errorMessage, WebDependencyError, WebResourceError } from "./effect/web-errors";
import { allowedHostnamesFor, isRequestHostAllowed, LOCALHOST } from "./http-origin";
import {
  type FrontendServer,
  indexStaticAssetPaths,
  resolveIndexedStaticAssetPath,
} from "./launcher-support";
import { startNodeFetchServer } from "./node-fetch-server";
import { nodeReadableStream } from "./node-readable-stream";
import { RUNTIME_CONFIG_PATH } from "./runtime-config";

type StaticFrontendOptions = {
  packageRoot: string;
  frontendPort: number;
  host?: string;
  externalUrl?: string;
};

const contentTypeForPath = (filePath: string): string => {
  switch (path.extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".png":
      return "image/png";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
};

// Vite emits eight-character content hashes under assets/. HTML always needs validation.
const isHashedStaticAssetPath = (staticRoot: string, filePath: string): boolean =>
  path.dirname(filePath) === path.join(staticRoot, "assets") &&
  path.extname(filePath) !== ".html" &&
  /-[A-Za-z0-9_-]{8}\.[^.]+$/.test(path.basename(filePath));

const isNotModified = (request: Request, etag: string): boolean => {
  const condition = request.headers.get("if-none-match");
  if (condition === null) return false;
  if (condition.trim() === "*") return true;
  const currentTag = etag.replace(/^W\//, "");
  return condition.split(",").some((tag) => tag.trim().replace(/^W\//, "") === currentTag);
};

const staticAssetResponse = async (
  request: Request,
  responsePath: string,
  staticRoot: string,
): Promise<Response> => {
  const immutable = isHashedStaticAssetPath(staticRoot, responsePath);
  const headers = new Headers({
    "cache-control": immutable
      ? "public, max-age=31536000, immutable"
      : "public, max-age=0, must-revalidate",
    "content-type": contentTypeForPath(responsePath),
  });
  let bytes: Buffer | null = null;
  let etag: string;
  let size: number;
  if (immutable) {
    // The filename's build hash identifies the content without reading the file.
    const hash = createHash("sha256").update(path.basename(responsePath)).digest("hex");
    etag = `W/"${hash}"`;
    size = (await stat(responsePath)).size;
  } else {
    // Read mutable files once so the validator describes the bytes we return.
    bytes = await readFile(responsePath);
    etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
    size = bytes.byteLength;
  }
  headers.set("etag", etag);
  if (isNotModified(request, etag)) return new Response(null, { status: 304, headers });
  headers.set("content-length", String(size));
  if (request.method === "HEAD") return new Response(null, { headers });
  const body =
    bytes === null ? nodeReadableStream(createReadStream(responsePath)) : new Uint8Array(bytes);
  return new Response(body, { headers });
};

export const startStaticFrontendServerEffect = (
  options: StaticFrontendOptions,
  runtimeConfigState: BrowserRuntimeConfigState,
): Effect.Effect<FrontendServer & { port: number }, WebDependencyError | WebResourceError> =>
  Effect.gen(function* () {
    const staticRoot = path.join(options.packageRoot, "dist/web-shell");
    const indexPath = path.join(staticRoot, "index.html");
    const assetPaths = yield* Effect.tryPromise({
      try: () => indexStaticAssetPaths(staticRoot),
      catch: (cause) =>
        new WebResourceError({
          resource: "web-shell-assets",
          operation: "index",
          message: errorMessage(cause),
          cause,
          details: { indexPath, staticRoot },
        }),
    });
    if (!assetPaths.has(indexPath)) {
      return yield* new WebResourceError({
        resource: "web-shell-assets",
        operation: "resolve",
        message: `OpenDucktor web shell assets were not found at ${staticRoot}. Reinstall @openducktor/web or run the package build before starting.`,
        details: { indexPath, staticRoot },
      });
    }

    const allowedHostnames = allowedHostnamesFor({
      bindHost: options.host?.trim() || LOCALHOST,
      externalUrl: options.externalUrl?.trim() || undefined,
    });

    return yield* Effect.uninterruptible(
      Effect.tryPromise({
        try: () =>
          startNodeFetchServer({
            hostname: options.host?.trim() || LOCALHOST,
            port: options.frontendPort,
            onError: (cause) =>
              console.error(`OpenDucktor web frontend request failed: ${errorMessage(cause)}`),
            async fetch(request) {
              if (!isRequestHostAllowed(request, allowedHostnames)) {
                return new Response("Host not allowed.", { status: 403 });
              }
              const requestUrl = new URL(request.url);
              if (requestUrl.pathname === RUNTIME_CONFIG_PATH) {
                const runtimeConfig = await readBrowserRuntimeConfig(runtimeConfigState);
                return new Response(runtimeConfig, {
                  headers: {
                    "cache-control": "no-store",
                    "content-type": "application/json; charset=utf-8",
                  },
                });
              }

              if (request.method !== "GET" && request.method !== "HEAD") {
                return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
              }

              const responsePath = resolveIndexedStaticAssetPath(
                staticRoot,
                indexPath,
                assetPaths,
                requestUrl.pathname,
              );
              if (!responsePath) {
                return new Response("Not found", { status: 404 });
              }

              return staticAssetResponse(request, responsePath, staticRoot);
            },
          }),
        catch: (cause) =>
          new WebDependencyError({
            dependency: "node-server",
            operation: "start-static-frontend",
            message: errorMessage(cause),
            cause,
            details: { frontendPort: options.frontendPort },
          }),
      }).pipe(Effect.map((server) => ({ close: () => server.stop(true), port: server.port }))),
    );
  });
