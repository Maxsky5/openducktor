import { describe, expect, test } from "bun:test";
import path from "node:path";
import { __launcherTestInternals } from "./launcher";

const createHostProcess = (exited: Promise<number>): Bun.Subprocess => {
  return { exited } as Bun.Subprocess;
};

describe("launcher internals", () => {
  test("waits for the fake host health and token-authenticated session endpoints", async () => {
    const requests: Array<{ url: string; method: string | undefined; token: string | null }> = [];
    let healthAttempts = 0;
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
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
    };

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
    const fetchImpl = async (url: string | URL | Request) => {
      return new Response(null, { status: String(url).endsWith("/session") ? 403 : 200 });
    };

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
          fetch: async () => new Response(null, { status: 503 }),
          sleep: async () => {},
        },
      ),
    ).rejects.toThrow("OpenDucktor web host exited before startup completed with code 9.");
  });

  test("sends the launcher control token when shutting down the fake host", async () => {
    const requests: Array<{ url: string; token: string | null; method: string | undefined }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(url),
        method: init?.method,
        token: headers.get("x-openducktor-control-token"),
      });
      return new Response(null, { status: 202 });
    };

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

  test("detects the host exit code during the graceful shutdown wait", async () => {
    const hostExitCode = await __launcherTestInternals.waitForGracefulHostExitCode(
      createHostProcess(Promise.resolve(0)),
      async () => new Promise(() => {}),
    );

    expect(hostExitCode).toBe(0);
  });

  test("detects when the host needs force termination after graceful shutdown wait", async () => {
    const hostExitCode = await __launcherTestInternals.waitForGracefulHostExitCode(
      createHostProcess(new Promise<number>(() => {})),
      async () => {},
    );

    expect(hostExitCode).toBeNull();
  });

  test("still stops host services after shutdown request failures", async () => {
    let stopCalls = 0;
    let frontendCloseCalls = 0;
    const hostBackend = {
      exited: Promise.resolve(0),
      port: 14327,
      stop: async () => {
        stopCalls += 1;
      },
    };
    const frontendServer = {
      close: async () => {
        frontendCloseCalls += 1;
      },
    };

    await expect(
      __launcherTestInternals.stopLauncherServices(
        {
          backendUrl: "http://127.0.0.1:14327",
          controlToken: "control-token",
          frontendServer,
          hostBackend,
        },
        {
          requestShutdown: async () => {
            throw new Error("shutdown request failed");
          },
          closeServer: async (server) => {
            await server?.close();
          },
          waitForGracefulExitCode: async () => null,
        },
      ),
    ).rejects.toThrow("shutdown request failed");

    expect(frontendCloseCalls).toBe(1);
    expect(stopCalls).toBe(1);
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
      path.join("/web-shell", "assets/app.js"),
    );
    expect(
      __launcherTestInternals.resolveStaticAssetPath("/web-shell", "/../secret.txt"),
    ).toBeNull();
  });
});
