import { describe, expect, test } from "bun:test";
import {
  configureElectronLoopbackCorsPolicy,
  resolveElectronLoopbackCorsOrigin,
} from "./electron-loopback-cors-policy";

describe("configureElectronLoopbackCorsPolicy", () => {
  test("authorizes packaged file-origin renderer requests to loopback runtime responses", () => {
    let registeredFilter: { urls: string[] } | null = null;
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

    let responseHeaders: Record<string, string[] | string> | null = null;
    listener?.({ responseHeaders: { "content-type": ["application/json"] } }, (response) => {
      responseHeaders = response.responseHeaders;
    });

    expect(responseHeaders).toEqual({
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
