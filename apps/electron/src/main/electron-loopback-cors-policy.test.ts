import { describe, expect, test } from "bun:test";
import {
  configureElectronLoopbackCorsPolicy,
  resolveElectronLoopbackCorsOrigin,
} from "./electron-loopback-cors-policy";

type CorsFilter = Parameters<
  Parameters<typeof configureElectronLoopbackCorsPolicy>[0]["webRequest"]["onHeadersReceived"]
>[0];

describe("configureElectronLoopbackCorsPolicy", () => {
  test("authorizes packaged file-origin renderer requests to loopback runtime responses", () => {
    let registeredFilter: CorsFilter | null = null;
    let listener:
      | Parameters<
          Parameters<
            typeof configureElectronLoopbackCorsPolicy
          >[0]["webRequest"]["onHeadersReceived"]
        >[1]
      | null = null;

    configureElectronLoopbackCorsPolicy({
      webRequest: {
        onHeadersReceived(filter, registeredListener) {
          registeredFilter = filter;
          listener = registeredListener;
        },
      },
    });

    expect(registeredFilter).toEqual({ urls: ["http://127.0.0.1:*/*"] });
    expect(listener).not.toBeNull();

    const responseHeaders: Array<Record<string, string[] | string>> = [];
    listener?.({ responseHeaders: { "content-type": ["application/json"] } }, (response) => {
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
