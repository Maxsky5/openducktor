import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  buildBrowserRuntimeConfigJson,
  buildFrontendDisplayUrls,
  closeFrontendServer,
  keepProcessAliveDuring,
  resolveStaticAssetPath,
  stopLauncherServices,
  waitForBackend,
} from "./launcher-support";

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

    await waitForBackend(
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

  test("fails fast when the fake host exits before readiness", async () => {
    const exited = Promise.resolve(9);
    await exited;

    await expect(
      waitForBackend("http://127.0.0.1:14327", "app-token", 1_000, createHostProcess(exited), {
        fetch: async () => new Response(null, { status: 503 }),
        sleep: async () => {},
      }),
    ).rejects.toThrow("OpenDucktor web host exited before startup completed with code 9.");
    await expect(
      waitForBackend("http://127.0.0.1:14327", "app-token", 1_000, createHostProcess(exited), {
        fetch: async () => new Response(null, { status: 503 }),
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ _tag: "WebOperationError" });
  });

  test("stops frontend and host services directly", async () => {
    let stopCalls = 0;
    let frontendCloseCalls = 0;
    let resolveExited: (exitCode: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExited = resolve;
    });
    const hostBackend = {
      exited,
      port: 14327,
      stop: async () => {
        stopCalls += 1;
        resolveExited(0);
      },
    };
    const frontendServer = {
      close: async () => {
        frontendCloseCalls += 1;
      },
    };

    await stopLauncherServices(
      {
        frontendServer,
        hostBackend,
      },
      {
        closeServer: async (server) => {
          await server?.close();
        },
        stopHost: async (backend) => {
          await backend.stop();
        },
      },
    );

    expect(frontendCloseCalls).toBe(1);
    expect(stopCalls).toBe(1);
  });

  test("forces open frontend server connections during Vite shutdown", async () => {
    let closeAllConnectionsCalls = 0;
    let closeIdleConnectionsCalls = 0;
    let closeCalls = 0;
    let resolveClose: () => void = () => {};
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const frontendServer = {
      httpServer: {
        closeAllConnections: () => {
          closeAllConnectionsCalls += 1;
          resolveClose();
        },
        closeIdleConnections: () => {
          closeIdleConnectionsCalls += 1;
        },
      },
      close: () => {
        closeCalls += 1;
        return closePromise;
      },
    };

    await closeFrontendServer(frontendServer);

    expect(closeCalls).toBe(1);
    expect(closeIdleConnectionsCalls).toBe(1);
    expect(closeAllConnectionsCalls).toBe(1);
  });

  test("forces open frontend connections even when close throws synchronously", async () => {
    let closeAllConnectionsCalls = 0;
    let closeIdleConnectionsCalls = 0;
    const frontendServer = {
      httpServer: {
        closeAllConnections: () => {
          closeAllConnectionsCalls += 1;
        },
        closeIdleConnections: () => {
          closeIdleConnectionsCalls += 1;
        },
      },
      close: () => {
        throw new Error("close failed");
      },
    };

    const result = await closeFrontendServer(frontendServer).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    if (result.ok) {
      throw new Error("Expected closeFrontendServer to reject");
    }

    expect(result.error).toMatchObject({ _tag: "WebDependencyError" });
    expect(result.error).toEqual(expect.objectContaining({ message: "close failed" }));
    expect(closeIdleConnectionsCalls).toBe(1);
    expect(closeAllConnectionsCalls).toBe(1);
  });

  test("keeps frontend shutdown bounded when close never resolves", async () => {
    let timeoutMs = 0;
    const frontendServer = {
      close: () => new Promise<void>(() => {}),
    };

    await closeFrontendServer(frontendServer, async (durationMs) => {
      timeoutMs = durationMs;
    });

    expect(timeoutMs).toBe(3_000);
  });

  test("keeps the process alive while shutdown work is pending", async () => {
    let intervalCallback: (() => void) | null = null;
    const timer = Symbol("timer") as unknown as ReturnType<typeof setInterval>;
    const clearedTimers: Array<ReturnType<typeof setInterval>> = [];
    let finishOperation: () => void = () => {};
    const operation = new Promise<void>((resolve) => {
      finishOperation = resolve;
    });

    const keepAlivePromise = keepProcessAliveDuring(operation, {
      clearInterval: (nextTimer) => {
        clearedTimers.push(nextTimer);
      },
      setInterval: (callback) => {
        intervalCallback = callback;
        return timer;
      },
    });

    expect(intervalCallback).not.toBeNull();
    expect(clearedTimers).toEqual([]);

    finishOperation();
    await keepAlivePromise;
    expect(clearedTimers).toEqual([timer]);
  });

  test("keeps signal handlers registered while shutdown is pending", async () => {
    const source = await Bun.file(new URL("./launcher.ts", import.meta.url)).text();

    expect(source).toContain('process.on("SIGINT"');
    expect(source).toContain('process.on("SIGTERM"');
    expect(source).toContain("OpenDucktor web shutdown is already in progress");
  });

  test("does not wait for the host exit code when host stop fails", async () => {
    const hostBackend = {
      exited: new Promise<number>(() => {}),
      port: 14327,
      stop: async () => {},
    };

    await expect(
      stopLauncherServices(
        {
          frontendServer: null,
          hostBackend,
        },
        {
          closeServer: async () => {},
          stopHost: async () => {
            throw new Error("host stop failed");
          },
        },
      ),
    ).rejects.toThrow("host stop failed");
    await expect(
      stopLauncherServices(
        {
          frontendServer: null,
          hostBackend,
        },
        {
          closeServer: async () => {},
          stopHost: async () => {
            throw new Error("host stop failed");
          },
        },
      ),
    ).rejects.toMatchObject({ _tag: "WebOperationError" });
  });

  test("builds runtime config JSON for the browser shell", () => {
    expect(buildBrowserRuntimeConfigJson("http://127.0.0.1:14327", "app-token")).toBe(
      '{"backendUrl":"http://127.0.0.1:14327","appToken":"app-token"}\n',
    );
  });

  test("prints localhost first in the frontend availability URLs", () => {
    expect(buildFrontendDisplayUrls(1420)).toEqual([
      "http://localhost:1420/",
      "http://127.0.0.1:1420/",
    ]);
  });

  test("rejects static asset paths that escape the web shell root", () => {
    expect(resolveStaticAssetPath("/web-shell", "/assets/app.js")).toBe(
      path.join("/web-shell", "assets/app.js"),
    );
    expect(resolveStaticAssetPath("/web-shell", "/../secret.txt")).toBeNull();
  });
});
