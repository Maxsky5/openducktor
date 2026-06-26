import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createLocalAttachmentAdapter,
  createSourceRuntimeDistribution,
  type EffectHostCommandRouter,
} from "@openducktor/host";
import { Effect } from "effect";
import {
  BufferedHostEventBus,
  stopTypescriptHostBackendServices,
  validateWebFrontendOrigin,
} from "./typescript-host-backend-support";

const nativeResponse = await Bun.fetch("data:,");
(globalThis as typeof globalThis & { Response: typeof Response }).Response =
  nativeResponse.constructor as typeof Response;

const { handleTypescriptHostBackendRequest, startTypescriptHostBackend } = await import(
  "./typescript-host-backend"
);

const APP_TOKEN = "app-token";
const CONTROL_TOKEN = "control-token";
const FRONTEND_ORIGIN = "http://127.0.0.1:1420";
const SOURCE_RUNTIME_DISTRIBUTION = createSourceRuntimeDistribution(
  path.resolve(import.meta.dir, "../../.."),
);

class StructuredHostCommandFailure extends Error {
  readonly details: { readonly command: string; readonly failureKind: "timeout" };

  constructor(command: string) {
    super(`Failed to invoke ${command}.`);
    this.name = "StructuredHostCommandFailure";
    this.details = { command, failureKind: "timeout" };
  }
}

const createTestHostCommandRouter = (
  invoke: (
    command: string,
    args?: Record<string, unknown>,
  ) => Effect.Effect<unknown, unknown> = () => Effect.succeed(null),
): EffectHostCommandRouter => ({
  dispose: () => Effect.void,
  initialize: () => Effect.void,
  invoke: (command, args) => invoke(command, args) as ReturnType<EffectHostCommandRouter["invoke"]>,
});

const handleTestRequest = (
  request: Request,
  options: Partial<{
    appToken: string;
    controlToken: string;
    hostCommandRouter: EffectHostCommandRouter;
    stop: () => Promise<void>;
  }> = {},
): Promise<Response> =>
  Effect.runPromise(
    handleTypescriptHostBackendRequest({
      allowedOrigins: new Set(),
      appToken: options.appToken ?? APP_TOKEN,
      controlToken: options.controlToken ?? CONTROL_TOKEN,
      eventBus: new BufferedHostEventBus(),
      hostCommandRouter: options.hostCommandRouter ?? createTestHostCommandRouter(),
      localAttachments: createLocalAttachmentAdapter(),
      request,
      shutdownStarted: false,
      stop: options.stop ?? (async () => {}),
    }),
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
    expect(() => validateWebFrontendOrigin("https://127.0.0.1:1420")).toThrow(
      "browser frontend origin must use http",
    );
    expect(() => validateWebFrontendOrigin("http://example.com:1420")).toThrow(
      "browser frontend origin must target 127.0.0.1, localhost, or [::1]",
    );
  });

  test("preserves structured host command failure kind in invoke error responses", async () => {
    const hostCommandRouter = createTestHostCommandRouter((command) =>
      Effect.fail(new StructuredHostCommandFailure(command)),
    );

    const response = await handleTestRequest(
      new Request("http://127.0.0.1/invoke/runtime_ensure", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": APP_TOKEN,
        },
        body: JSON.stringify({}),
      }),
      { hostCommandRouter },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to invoke runtime_ensure.",
      failureKind: "timeout",
      message: "Failed to invoke runtime_ensure.",
    });
  });

  test("rejects missing or invalid backend auth through typed route errors", async () => {
    const sessionMissing = await handleTestRequest(
      new Request("http://127.0.0.1/session", { method: "POST" }),
    );
    expect(sessionMissing.status).toBe(401);
    expect(await sessionMissing.json()).toEqual({
      error: "Missing OpenDucktor web host app token.",
      message: "Missing OpenDucktor web host app token.",
    });

    const sessionInvalid = await handleTestRequest(
      new Request("http://127.0.0.1/session", {
        method: "POST",
        headers: { "x-openducktor-app-token": "wrong" },
      }),
    );
    expect(sessionInvalid.status).toBe(403);
    expect(await sessionInvalid.json()).toEqual({
      error: "Invalid OpenDucktor web host app token.",
      message: "Invalid OpenDucktor web host app token.",
    });

    let stopCalls = 0;
    const stop = async () => {
      stopCalls += 1;
    };
    const shutdownMissing = await handleTestRequest(
      new Request("http://127.0.0.1/shutdown", { method: "POST" }),
      { stop },
    );
    expect(shutdownMissing.status).toBe(401);
    expect(await shutdownMissing.json()).toEqual({
      error: "Missing OpenDucktor web host control token.",
      message: "Missing OpenDucktor web host control token.",
    });
    expect(stopCalls).toBe(0);

    const shutdownInvalid = await handleTestRequest(
      new Request("http://127.0.0.1/shutdown", {
        method: "POST",
        headers: { "x-openducktor-control-token": "wrong" },
      }),
      { stop },
    );
    expect(shutdownInvalid.status).toBe(403);
    expect(await shutdownInvalid.json()).toEqual({
      error: "Invalid OpenDucktor web host control token.",
      message: "Invalid OpenDucktor web host control token.",
    });
    expect(stopCalls).toBe(0);

    const previewUrl = "http://127.0.0.1/local-attachment-preview?path=/tmp/file";
    const previewMissing = await handleTestRequest(new Request(previewUrl));
    expect(previewMissing.status).toBe(401);
    expect(await previewMissing.json()).toEqual({
      error: "Missing OpenDucktor web host app token.",
      message: "Missing OpenDucktor web host app token.",
    });

    const previewInvalid = await handleTestRequest(
      new Request(previewUrl, { headers: { cookie: "openducktor_web_session=wrong" } }),
    );
    expect(previewInvalid.status).toBe(403);
    expect(await previewInvalid.json()).toEqual({
      error: "Invalid OpenDucktor web host app token.",
      message: "Invalid OpenDucktor web host app token.",
    });
  });

  test("keeps the backend server alive until host disposal finishes", async () => {
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
