import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSourceRuntimeDistribution } from "@openducktor/host";
import { Effect } from "effect";

const nativeResponse = await Bun.fetch("data:,");
(globalThis as typeof globalThis & { Response: typeof Response }).Response =
  nativeResponse.constructor as typeof Response;

const { __typescriptHostBackendTestInternals, startTypescriptHostBackend } = await import(
  "./typescript-host-backend"
);

const APP_TOKEN = "app-token";
const CONTROL_TOKEN = "control-token";
const FRONTEND_ORIGIN = "http://127.0.0.1:1420";
const SOURCE_RUNTIME_DISTRIBUTION = createSourceRuntimeDistribution(
  path.resolve(import.meta.dir, "../../.."),
);

describe("TypeScript web host backend", () => {
  test("serves health, session, invoke, and shutdown through the browser HTTP contract", async () => {
    const previousConfigDir = process.env.OPENDUCKTOR_CONFIG_DIR;
    const tempConfigDir = await mkdtemp(path.join(tmpdir(), "openducktor-web-host-"));
    process.env.OPENDUCKTOR_CONFIG_DIR = tempConfigDir;
    let backend: Awaited<ReturnType<typeof startTypescriptHostBackend>> | undefined;

    try {
      backend = await startTypescriptHostBackend({
        port: 0,
        frontendOrigin: FRONTEND_ORIGIN,
        controlToken: CONTROL_TOKEN,
        appToken: APP_TOKEN,
        runtimeDistribution: SOURCE_RUNTIME_DISTRIBUTION,
      });
      const backendUrl = `http://127.0.0.1:${backend.port}`;

      const health = await Bun.fetch(`${backendUrl}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      const session = await Bun.fetch(`${backendUrl}/session`, {
        method: "POST",
        headers: { "x-openducktor-app-token": APP_TOKEN },
      });
      expect(session.status).toBe(200);
      expect(session.headers.get("set-cookie")).toContain("openducktor_web_session=app-token");

      const invoke = await Bun.fetch(`${backendUrl}/invoke/runtime_definitions_list`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
        },
        body: JSON.stringify({}),
      });
      expect(invoke.status).toBe(200);
      expect(await invoke.json()).toMatchObject([{ kind: "opencode" }, { kind: "codex" }]);

      const theme = await Bun.fetch(`${backendUrl}/invoke/set_theme`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
        },
        body: JSON.stringify({ theme: "dark" }),
      });
      expect(theme.status).toBe(200);
      expect(await theme.json()).toBeNull();

      const shutdown = await Bun.fetch(`${backendUrl}/shutdown`, {
        method: "POST",
        headers: { "x-openducktor-control-token": CONTROL_TOKEN },
      });
      expect(shutdown.status).toBe(202);
      await expect(backend.exited).resolves.toBe(0);
    } finally {
      if (backend) {
        await backend.stop();
      }
      if (previousConfigDir === undefined) {
        delete process.env.OPENDUCKTOR_CONFIG_DIR;
      } else {
        process.env.OPENDUCKTOR_CONFIG_DIR = previousConfigDir;
      }
      await rm(tempConfigDir, { force: true, recursive: true });
    }
  }, 5_000);

  test("rejects invalid browser frontend origins before opening a host port", () => {
    const { validateWebFrontendOrigin } = __typescriptHostBackendTestInternals;

    expect(() => validateWebFrontendOrigin("https://127.0.0.1:1420")).toThrow(
      "browser frontend origin must use http",
    );
    expect(() => validateWebFrontendOrigin("http://example.com:1420")).toThrow(
      "browser frontend origin must target 127.0.0.1, localhost, or [::1]",
    );
  });

  test("keeps the backend server alive until host disposal finishes", async () => {
    const { stopTypescriptHostBackendServices } = __typescriptHostBackendTestInternals;
    const calls: string[] = [];
    let releaseDispose: () => void = () => {};
    const disposeReleased = new Promise<void>((resolve) => {
      releaseDispose = resolve;
    });
    let disposeStarted: () => void = () => {};
    const disposeStartedPromise = new Promise<void>((resolve) => {
      disposeStarted = resolve;
    });

    const stopPromise = stopTypescriptHostBackendServices({
      disposeHost: () =>
        Effect.promise(async () => {
          calls.push("dispose-started");
          disposeStarted();
          await disposeReleased;
          calls.push("dispose-finished");
        }),
      resolveExited: (exitCode) => {
        calls.push(`exited-${exitCode}`);
      },
      stopServer: () => {
        calls.push("server-stopped");
      },
    });

    await disposeStartedPromise;
    expect(calls).toEqual(["dispose-started"]);

    releaseDispose();
    await stopPromise;
    expect(calls).toEqual(["dispose-started", "dispose-finished", "server-stopped", "exited-0"]);
  });
});
