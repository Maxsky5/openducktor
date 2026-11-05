import { describe, expect, test } from "bun:test";
import {
  configureElectronLoopbackCorsPolicy,
  resolveElectronLoopbackCorsOrigin,
} from "./electron-loopback-cors-policy";

type CorsFilter = Parameters<
  Parameters<typeof configureElectronLoopbackCorsPolicy>[0]["webRequest"]["onHeadersReceived"]
>[0];

type CorsListener = Parameters<
  Parameters<typeof configureElectronLoopbackCorsPolicy>[0]["webRequest"]["onHeadersReceived"]
>[1];

/** The filter and listener that the CORS policy registered. */
type RegisteredCorsPolicy = { filter: CorsFilter | null; listener: CorsListener | null };

describe("configureElectronLoopbackCorsPolicy", () => {
  test("authorizes packaged file-origin renderer requests to loopback runtime responses", () => {
    const registered: RegisteredCorsPolicy = { filter: null, listener: null };

    configureElectronLoopbackCorsPolicy({
      webRequest: {
        onHeadersReceived(filter, registeredListener) {
          registered.filter = filter;
          registered.listener = registeredListener;
        },
      },
    });

    expect(registered.filter).toEqual({ urls: ["http://127.0.0.1:*/*"] });
    const listener = registered.listener;
    if (!listener) throw new Error("Expected a CORS listener.");

    const responseHeaders: Array<Record<string, string[] | string>> = [];
    listener({ responseHeaders: { "content-type": ["application/json"] } }, (response) => {
      responseHeaders.push(response.responseHeaders);
    });

    expect(responseHeaders[0]).toEqual({
      "content-type": ["application/json"],
      "Access-Control-Allow-Origin": ["null"],
      "Access-Control-Allow-Credentials": ["true"],
      "Access-Control-Allow-Headers": [
        "content-type, x-opencode-directory, x-opencode-workspace, x-openducktor-app-token",
      ],
      "Access-Control-Allow-Methods": ["GET, POST, PUT, PATCH, DELETE, OPTIONS"],
    });
  });

  test("uses the dev server origin when Electron runs against Vite", () => {
    expect(resolveElectronLoopbackCorsOrigin("http://127.0.0.1:1430")).toBe(
      "http://127.0.0.1:1430",
    );
  });

  test("uses the file origin sentinel for packaged renderer builds", () => {
    expect(resolveElectronLoopbackCorsOrigin(undefined)).toBe("null");
  });
});
