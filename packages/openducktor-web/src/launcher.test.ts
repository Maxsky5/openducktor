import { describe, expect, test } from "bun:test";
import { __launcherTestInternals } from "./launcher";

const createHostProcess = (exited: Promise<number>): Bun.Subprocess => {
  return { exited } as Bun.Subprocess;
};

const createTerminableHostProcess = (pid?: number, exited = new Promise<number>(() => {})) => {
  const killCalls: Array<number | NodeJS.Signals | undefined> = [];
  const child = {
    pid,
    exited,
    kill(signal?: number | NodeJS.Signals) {
      killCalls.push(signal);
      return true;
    },
  } as unknown as Bun.Subprocess;

  return { child, killCalls };
};

const noopWindowsProcessTreeTerminator = async () => {};

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

  test("detects when the host exits during the graceful shutdown wait", async () => {
    const hostExited = await __launcherTestInternals.waitForGracefulHostExit(
      createHostProcess(Promise.resolve(0)),
      async () => new Promise(() => {}),
    );

    expect(hostExited).toBe(true);
  });

  test("detects when the host needs force termination after graceful shutdown wait", async () => {
    const hostExited = await __launcherTestInternals.waitForGracefulHostExit(
      createHostProcess(new Promise<number>(() => {})),
      async () => {},
    );

    expect(hostExited).toBe(false);
  });

  test("uses process-group signals on non-Windows platforms", async () => {
    const { child, killCalls } = createTerminableHostProcess(1234);
    const processKillCalls: Array<{ pid: number; signal: string | number | undefined }> = [];

    await __launcherTestInternals.terminateHostProcess(child, {
      platform: "linux",
      killProcess(pid, signal) {
        processKillCalls.push({ pid, signal });
        return true;
      },
      terminateWindowsProcessTree: noopWindowsProcessTreeTerminator,
      sleep: async () => {},
    });

    expect(processKillCalls).toEqual([
      { pid: -1234, signal: "SIGTERM" },
      { pid: -1234, signal: 0 },
      { pid: -1234, signal: "SIGKILL" },
    ]);
    expect(killCalls).toEqual([undefined, 9]);
  });

  test("waits the full process-group grace window before Unix escalation", async () => {
    const { child } = createTerminableHostProcess(1234, Promise.resolve(0));
    const calls: string[] = [];

    await __launcherTestInternals.terminateHostProcess(child, {
      platform: "linux",
      killProcess(_pid, signal) {
        calls.push(`process:${signal}`);
        return true;
      },
      terminateWindowsProcessTree: noopWindowsProcessTreeTerminator,
      sleep: async (durationMs) => {
        calls.push(`sleep:${durationMs}`);
      },
    });

    expect(calls).toEqual([
      "process:SIGTERM",
      "sleep:3000",
      "process:0",
      "process:SIGKILL",
      "sleep:1000",
    ]);
  });

  test("skips Unix SIGKILL when the process group is already gone", async () => {
    const { child, killCalls } = createTerminableHostProcess(1234);
    const processKillCalls: Array<{ pid: number; signal: string | number | undefined }> = [];

    await __launcherTestInternals.terminateHostProcess(child, {
      platform: "linux",
      killProcess(pid, signal) {
        processKillCalls.push({ pid, signal });
        if (signal === 0) {
          throw new Error("process group is gone");
        }
        return true;
      },
      terminateWindowsProcessTree: noopWindowsProcessTreeTerminator,
      sleep: async () => {},
    });

    expect(processKillCalls).toEqual([
      { pid: -1234, signal: "SIGTERM" },
      { pid: -1234, signal: 0 },
    ]);
    expect(killCalls).toEqual([undefined, 9]);
  });

  test("terminates the Windows process tree without negative process-group signals", async () => {
    const { child, killCalls } = createTerminableHostProcess(1234);
    const processKillCalls: Array<{ pid: number; signal: string | number | undefined }> = [];
    const processTreeKills: number[] = [];

    await __launcherTestInternals.terminateHostProcess(child, {
      platform: "win32",
      killProcess(pid, signal) {
        processKillCalls.push({ pid, signal });
        if (pid < 0) {
          throw new Error("Windows termination must not use negative PIDs.");
        }
        return true;
      },
      terminateWindowsProcessTree(pid) {
        processTreeKills.push(pid);
        return Promise.resolve();
      },
      sleep: async () => {},
    });

    expect(processKillCalls).toEqual([]);
    expect(processTreeKills).toEqual([1234]);
    expect(killCalls).toEqual([]);
  });

  test("skips process-group signals when the host PID is invalid", async () => {
    const { child, killCalls } = createTerminableHostProcess(0);
    const processKillCalls: Array<{ pid: number; signal: string | number | undefined }> = [];

    await __launcherTestInternals.terminateHostProcess(child, {
      platform: "darwin",
      killProcess(pid, signal) {
        processKillCalls.push({ pid, signal });
        return true;
      },
      terminateWindowsProcessTree: noopWindowsProcessTreeTerminator,
      sleep: async () => {},
    });

    expect(processKillCalls).toEqual([]);
    expect(killCalls).toEqual([undefined, 9]);
  });

  test("builds runtime config JSON for the browser shell", () => {
    expect(
      __launcherTestInternals.buildBrowserRuntimeConfigJson("http://127.0.0.1:14327", "app-token"),
    ).toBe('{"backendUrl":"http://127.0.0.1:14327","appToken":"app-token"}\n');
  });

  test("points packaged hosts at the packaged MCP sidecar", () => {
    const env = __launcherTestInternals.buildArtifactHostEnv({
      kind: "artifact",
      path: "/package/bin/openducktor-web-host-darwin-arm64",
      mcpSidecarPath: "/package/bin/openducktor-mcp-darwin-arm64",
    });

    expect(env.OPENDUCKTOR_OPENDUCKTOR_MCP_PATH).toBe("/package/bin/openducktor-mcp-darwin-arm64");
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

  test("does not rely on Unix process-group signals on Windows", () => {
    expect(__launcherTestInternals.shouldSignalProcessGroup("win32")).toBe(false);
    expect(__launcherTestInternals.shouldSignalProcessGroup("darwin")).toBe(true);
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
