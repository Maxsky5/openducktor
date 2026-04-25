import { describe, expect, test } from "bun:test";
import { __launcherTestInternals } from "./launcher";

const createHostProcess = (exited: Promise<number>): Bun.Subprocess => {
  return { exited } as Bun.Subprocess;
};

describe("launcher internals", () => {
  test("waits for the fake host health and token-authenticated session endpoints", async () => {
    const requests: Array<{ url: string; method: string | undefined; token: string | null }> = [];
    let healthAttempts = 0;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(url),
        method: init?.method,
        token: headers.get("x-openducktor-app-token"),
      });
      if (String(url).endsWith("/health")) {
        healthAttempts += 1;
        return new Response(null, { status: healthAttempts === 1 ? 503 : 200 });
      }
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    await __launcherTestInternals.waitForBackend(
      "http://127.0.0.1:14327",
      "app-token",
      1_000,
      createHostProcess(new Promise<number>(() => {})),
      { fetch: fetchImpl, sleep: async () => {} },
    );

    expect(requests).toEqual([
      { url: "http://127.0.0.1:14327/health", method: undefined, token: null },
      { url: "http://127.0.0.1:14327/health", method: undefined, token: null },
      { url: "http://127.0.0.1:14327/session", method: "POST", token: "app-token" },
    ]);
  });

  test("rejects stale hosts that do not know the launcher app token", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      return new Response(null, { status: String(url).endsWith("/session") ? 403 : 200 });
    }) as typeof fetch;

    await expect(
      __launcherTestInternals.verifyBackendReadiness(
        "http://127.0.0.1:14327",
        "fresh-app-token",
        fetchImpl,
      ),
    ).rejects.toThrow("Session endpoint rejected the launcher app token with status 403.");
  });

  test("fails fast when the fake host exits before readiness", async () => {
    const exited = Promise.resolve(9);
    await exited;

    await expect(
      __launcherTestInternals.waitForBackend(
        "http://127.0.0.1:14327",
        "app-token",
        1_000,
        createHostProcess(exited),
        {
          fetch: (async () => new Response(null, { status: 503 })) as unknown as typeof fetch,
          sleep: async () => {},
        },
      ),
    ).rejects.toThrow("OpenDucktor web host exited before startup completed with code 9.");
  });

  test("sends the launcher control token when shutting down the fake host", async () => {
    const requests: Array<{ url: string; token: string | null; method: string | undefined }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(url),
        method: init?.method,
        token: headers.get("x-openducktor-control-token"),
      });
      return new Response(null, { status: 202 });
    }) as typeof fetch;

    await __launcherTestInternals.requestHostShutdown(
      "http://127.0.0.1:14327",
      "control-token",
      fetchImpl,
    );

    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:14327/shutdown",
        method: "POST",
        token: "control-token",
      },
    ]);
  });

  test("builds runtime config JSON for the browser shell", () => {
    expect(
      __launcherTestInternals.buildBrowserRuntimeConfigJson("http://127.0.0.1:14327", "app-token"),
    ).toBe('{"backendUrl":"http://127.0.0.1:14327","appToken":"app-token"}\n');
  });

  test("prints localhost first in the frontend availability URLs", () => {
    expect(__launcherTestInternals.buildFrontendDisplayUrls(1420)).toEqual([
      "http://localhost:1420/",
      "http://127.0.0.1:1420/",
    ]);
  });

  test("keeps graceful shutdown alive for immediate duplicate signals", () => {
    expect(__launcherTestInternals.shouldForceExitForRepeatedSignal(1_000, 2_000)).toBe(false);
    expect(__launcherTestInternals.shouldForceExitForRepeatedSignal(1_000, 2_500)).toBe(true);
  });

  test("rejects static asset paths that escape the web shell root", () => {
    expect(__launcherTestInternals.resolveStaticAssetPath("/web-shell", "/assets/app.js")).toBe(
      "/web-shell/assets/app.js",
    );
    expect(
      __launcherTestInternals.resolveStaticAssetPath("/web-shell", "/../secret.txt"),
    ).toBeNull();
  });
});
