import { afterEach, describe, expect, test } from "bun:test";
import type { JSONType } from "zod";
import {
  configureBrowserRuntimeConfig,
  getBrowserAuthToken,
  getBrowserBackendUrl,
} from "./browser-config";
import { loadBrowserRuntimeConfig, RUNTIME_CONFIG_PATH } from "./runtime-config";
import { createFetchFixture } from "./test-support";

const response = (body: JSONType, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });

describe("runtime config loader", () => {
  afterEach(() => {
    configureBrowserRuntimeConfig({});
  });

  test("loads the launcher runtime config before the web shell starts", async () => {
    const requests: Array<{ cache: RequestCache | undefined; url: string }> = [];
    const fetchImpl = createFetchFixture((url, init) => {
      requests.push({ cache: init?.cache, url: url.toString() });
      return Promise.resolve(
        response({ backendUrl: "http://127.0.0.1:14327", appToken: "app-token" }),
      );
    });

    await loadBrowserRuntimeConfig(fetchImpl);

    expect(requests).toEqual([{ cache: "no-store", url: RUNTIME_CONFIG_PATH }]);
    expect(getBrowserBackendUrl(undefined, "http://localhost:1420")).toBe("http://localhost:14327");
    expect(getBrowserAuthToken()).toBe("app-token");
  });

  test("surfaces runtime config HTTP failures", async () => {
    const fetchImpl = createFetchFixture(() =>
      Promise.resolve(response({ error: "missing" }, 503)),
    );

    await expect(loadBrowserRuntimeConfig(fetchImpl)).rejects.toThrow(
      `OpenDucktor web failed to load runtime config from ${RUNTIME_CONFIG_PATH}: HTTP 503.`,
    );
    await expect(loadBrowserRuntimeConfig(fetchImpl)).rejects.toMatchObject({
      _tag: "WebDependencyError",
    });
  });

  test("rejects malformed runtime config payloads", async () => {
    const fetchImpl = createFetchFixture(() =>
      Promise.resolve(response({ backendUrl: "http://127.0.0.1:14327" })),
    );

    await expect(loadBrowserRuntimeConfig(fetchImpl)).rejects.toThrow(
      `OpenDucktor web runtime config from ${RUNTIME_CONFIG_PATH} is missing backendUrl or appToken.`,
    );
    await expect(loadBrowserRuntimeConfig(fetchImpl)).rejects.toMatchObject({
      _tag: "WebValidationError",
    });
  });
});
