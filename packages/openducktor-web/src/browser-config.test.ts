import { describe, expect, test } from "bun:test";
import { getBrowserAuthToken, getBrowserBackendUrl } from "./browser-config";

describe("browser web host config", () => {
  test("requires the launcher-injected backend URL", () => {
    expect(() => getBrowserBackendUrl({ VITE_ODT_BROWSER_AUTH_TOKEN: "token" })).toThrow(
      "OpenDucktor web is missing the local web host URL",
    );
  });

  test("requires the launcher-injected auth token", () => {
    expect(() =>
      getBrowserAuthToken({ VITE_ODT_BROWSER_BACKEND_URL: "http://127.0.0.1:14327" }),
    ).toThrow("OpenDucktor web is missing the local web host app token");
  });

  test("accepts loopback http origins with explicit ports", () => {
    expect(
      getBrowserBackendUrl({
        VITE_ODT_BROWSER_BACKEND_URL: "http://127.0.0.1:14327",
      }),
    ).toBe("http://127.0.0.1:14327");
    expect(
      getBrowserBackendUrl({
        VITE_ODT_BROWSER_BACKEND_URL: "http://localhost:14327",
      }),
    ).toBe("http://localhost:14327");
  });

  test("rejects non-loopback or non-origin backend URLs", () => {
    expect(() =>
      getBrowserBackendUrl({ VITE_ODT_BROWSER_BACKEND_URL: "https://example.com:14327" }),
    ).toThrow("must use http");
    expect(() =>
      getBrowserBackendUrl({ VITE_ODT_BROWSER_BACKEND_URL: "http://example.com:14327" }),
    ).toThrow("must target 127.0.0.1");
    expect(() =>
      getBrowserBackendUrl({ VITE_ODT_BROWSER_BACKEND_URL: "http://127.0.0.1" }),
    ).toThrow("must include an explicit port");
    expect(() =>
      getBrowserBackendUrl({ VITE_ODT_BROWSER_BACKEND_URL: "http://127.0.0.1:14327/app" }),
    ).toThrow("must be an origin only");
  });
});
