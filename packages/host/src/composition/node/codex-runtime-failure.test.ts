import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type HostRuntimeStatus,
  hostRuntimeSnapshotSchema,
  runtimeLifecycleImpactSchema,
  runtimeRestartResultSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createCodexAppServerTransportRegistry } from "../../adapters/codex/codex-app-server-transport-registry";
import {
  PROCESS_TEST_TIMEOUT_MS,
  PROCESS_WAIT_MS,
  processIsAlive,
  stubCommands,
  stubTools,
  waitFor,
  writeCodex,
} from "../../adapters/codex/codex-runtime-starter.test-support";
import type { McpHostBridgeServer } from "../../adapters/mcp/mcp-host-bridge-server";
import { createSourceRuntimeDistribution } from "../../adapters/runtimes/runtime-distribution";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import { createHostEventBus, type HostEventBusPort } from "../../events/host-event-bus";
import { createBrowserEngineTestDouble } from "../../test-support/browser-engine-test-double";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import { createTaskStoreTestDouble } from "../../test-support/task-store-test-double";
import { removeTestDirectory } from "../../test-support/temp-directory";
import type { HostLifecycleLogger } from "../host-lifecycle";
import { createNodeEffectHostCommandRouter } from "./create-node-effect-host-command-router";
import type { EffectNodeHostCommandRouter } from "./node-host-command-router-types";

const codexStatus = async (router: EffectNodeHostCommandRouter): Promise<HostRuntimeStatus> => {
  const snapshot = hostRuntimeSnapshotSchema.parse(
    await Effect.runPromise(router.invoke("runtime_status")),
  );
  const status = snapshot.runtimes.find((runtime) => runtime.kind === "codex");
  if (!status) throw new Error("runtime_status has no codex entry.");
  return status;
};

const awaitSignal = <T>(signal: Promise<T>): Promise<T> =>
  Effect.runPromise(Effect.promise(() => signal).pipe(Effect.timeout(PROCESS_WAIT_MS)));

const createRuntimeEventBus = () =>
  createHostEventBus({
    report: ({ cause }) => {
      throw new Error("Host event delivery failed.", { cause });
    },
  });

/** Initializes the host and waits for the enabled Codex runtime to publish readiness. */
const startHostRuntime = async (
  router: EffectNodeHostCommandRouter,
  eventBus: HostEventBusPort,
): Promise<string> => {
  const ready = Promise.withResolvers<HostRuntimeStatus>();
  const stop = eventBus.subscribe("openducktor://runtime-changed", (event) => {
    if (event.channel !== "openducktor://runtime-changed") return;
    const { payload } = event;
    if (payload.type !== "runtime_changed" || payload.status.kind !== "codex") return;
    if (payload.status.state === "ready" || payload.status.state === "error")
      ready.resolve(payload.status);
  });
  try {
    await Effect.runPromise(router.initialize());
    const status = await awaitSignal(ready.promise);
    if (status.state === "error")
      throw new Error(status.failure?.message ?? "Codex failed to start.");
    if (!status.runtimeId) throw new Error("The ready Codex runtime has no runtime ID.");
    return status.runtimeId;
  } finally {
    stop();
  }
};

describe("Codex runtime failure reporting", () => {
  test(
    "logs one host error and restarts the shared runtime after malformed app-server output",
    async () => {
      const message = "Invalid Codex app-server JSON";
      const root = await mkdtemp(join(tmpdir(), "odt-codex-host-failure-"));
      const errors: string[] = [];
      const fatalFailures: HostOperationErrorAggregate[] = [];
      const reported = Promise.withResolvers<void>();
      const eventBus = createRuntimeEventBus();
      let router: EffectNodeHostCommandRouter | undefined;
      try {
        const codexAppServer = createCodexAppServerTransportRegistry();
        router = await createRouter(
          root,
          codexAppServer,
          eventBus,
          {
            error: (text) =>
              Effect.sync(() => {
                errors.push(text);
                reported.resolve();
              }),
            info: () => Effect.void,
          },
          (failure) =>
            Effect.sync(() => {
              fatalFailures.push(failure);
              reported.resolve();
            }),
        );
        const firstRuntimeId = await startHostRuntime(router, eventBus);
        const pid = Number(await readFile(join(root, "runtime.pid"), "utf8"));
        const fatalPath = join(root, "fatal.json");
        await writeFile(fatalPath, "{invalid JSON");
        await awaitSignal(reported.promise);
        expect(fatalFailures).toEqual([]);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain(firstRuntimeId);
        expect(errors[0]).toContain(message);
        await waitFor(() => !processIsAlive(pid), PROCESS_WAIT_MS);
        expect(await codexStatus(router)).toMatchObject({
          state: "error",
          runtimeId: firstRuntimeId,
          failure: { trigger: "crash", phase: "run", message: expect.stringContaining(message) },
        });
        await expect(
          Effect.runPromise(router.invoke("runtime_require", { runtimeKind: "codex" })),
        ).rejects.toThrow();

        await rm(fatalPath, { force: true });
        const impact = runtimeLifecycleImpactSchema.parse(
          await Effect.runPromise(
            router.invoke("runtime_restart_impact", { runtimeKind: "codex" }),
          ),
        );
        expect(impact.kinds).toEqual([
          expect.objectContaining({ kind: "codex", runtimeId: firstRuntimeId, effect: "restart" }),
        ]);
        expect(impact.workspaces).toEqual([]);
        const restart = runtimeRestartResultSchema.parse(
          await Effect.runPromise(
            router.invoke("runtime_restart", {
              runtimeKind: "codex",
              confirmation: impact.confirmation,
            }),
          ),
        );
        expect(restart).toMatchObject({
          type: "completed",
          status: { kind: "codex", state: "ready", failure: null },
        });
        if (restart.type !== "completed")
          throw new Error(`Codex restart ended as ${restart.type}.`);
        const replacementId = restart.status.runtimeId;
        if (!replacementId) throw new Error("The restarted codex runtime has no runtime ID.");
        expect(replacementId).not.toBe(firstRuntimeId);
        await expect(
          Effect.runPromise(
            codexAppServer.request({
              runtimeId: replacementId,
              method: "thread/loaded/list",
              params: {},
            }),
          ),
        ).resolves.toEqual({ data: [], nextCursor: null });
        expect(errors).toHaveLength(1);
        expect(fatalFailures).toEqual([]);
      } finally {
        if (router) await Effect.runPromise(router.dispose());
        await removeTestDirectory(root);
      }
    },
    PROCESS_TEST_TIMEOUT_MS,
  );

  test(
    "reports a runtime logging failure through the host-fatal callback",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "odt-codex-host-log-failure-"));
      const failure = new Error("runtime error log failed");
      const errors: string[] = [];
      const fatalFailures: HostOperationErrorAggregate[] = [];
      const reported = Promise.withResolvers<void>();
      const eventBus = createRuntimeEventBus();
      let router: EffectNodeHostCommandRouter | undefined;
      try {
        router = await createRouter(
          root,
          createCodexAppServerTransportRegistry(),
          eventBus,
          {
            error: (text) =>
              Effect.sync(() => {
                errors.push(text);
              }).pipe(Effect.andThen(Effect.fail(failure))),
            info: () => Effect.void,
          },
          (error) =>
            Effect.sync(() => {
              fatalFailures.push(error);
              reported.resolve();
            }),
        );
        const runtimeId = await startHostRuntime(router, eventBus);
        const pid = Number(await readFile(join(root, "runtime.pid"), "utf8"));
        await writeFile(join(root, "fatal.json"), JSON.stringify({ id: 999, result: {} }));
        await awaitSignal(reported.promise);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain(runtimeId);
        expect(errors[0]).toContain("unexpected id 999");
        expect(fatalFailures[0]).toMatchObject({
          operation: "host.lifecycle.log-error",
          cause: failure,
        });
        await waitFor(() => !processIsAlive(pid), PROCESS_WAIT_MS);
      } finally {
        if (router) await Effect.runPromise(router.dispose());
        await removeTestDirectory(root);
      }
    },
    PROCESS_TEST_TIMEOUT_MS,
  );
});

const createRouter = async (
  root: string,
  codexAppServer: ReturnType<typeof createCodexAppServerTransportRegistry>,
  eventBus: HostEventBusPort,
  lifecycleLogger: HostLifecycleLogger,
  onBackgroundFailure: (failure: HostOperationErrorAggregate) => Effect.Effect<void, never>,
): Promise<EffectNodeHostCommandRouter> => {
  // The shared runtime starts in the user home directory, so fixture paths must be absolute.
  const binary = await writeCodex(root, {
    runtimePidPath: join(root, "runtime.pid"),
    fatalMessagePath: join(root, "fatal.json"),
  });
  const connection = {
    workspaceId: "repo",
    hostUrl: "http://127.0.0.1:14327",
    hostToken: "test-token",
  };
  const mcpHostBridge = {
    ensureConnection: () => Effect.succeed(connection),
    ensureExternalDiscoveryReady: () => Effect.succeed(connection),
    status: () => ({
      state: "ready",
      hostUrl: "http://127.0.0.1:5000",
      failure: null,
      updatedAt: "2026-10-03T10:00:00.000Z",
      revision: 1,
    }),
    close: () => Effect.succeed({ baseUrl: null, closed: false }),
  } satisfies McpHostBridgeServer;
  const config = createDefaultGlobalConfig();
  config.agentRuntimes.codex = {
    ...config.agentRuntimes.codex,
    enabled: true,
    executablePath: binary,
  };
  await mkdir(join(root, "config"));
  await writeFile(join(root, "config", "config.json"), JSON.stringify(config));
  return Effect.runPromise(
    createNodeEffectHostCommandRouter({
      codexAppServer,
      configDirScope: "test",
      eventBus,
      git: createGitPortTestDouble({
        canonicalizePath: (path) => Effect.succeed(path),
        isGitRepository: () => Effect.succeed(true),
      }),
      lifecycleLogger,
      mcpBridgeDiscoveryMode: "production",
      mcpHostBridge,
      onBackgroundFailure,
      processEnv: { ...process.env, OPENDUCKTOR_CONFIG_DIR: join(root, "config") },
      runtimeDistribution: createSourceRuntimeDistribution(join(import.meta.dir, "../../../../..")),
      // A real version read runs the fixture again, which rewrites the runtime PID file.
      runtimeHealth: {
        readVersion: () => Effect.succeed(null),
        getRuntimeHealth: () =>
          Effect.die(new Error("The runtime health probe must not run in this test.")),
      },
      systemCommands: stubCommands(),
      taskEventPublicationReporter: { report: () => Effect.void },
      taskStore: createTaskStoreTestDouble({}),
      terminalPty: { start: () => Effect.die("Terminal PTY is not expected in this test.") },
      processNativeDirectory: "/missing-process-native",
      processInspector: {
        listProcesses: () => Effect.die("Process reads are not expected in this test."),
        inspectProcesses: () => Effect.die("Process reads are not expected in this test."),
        stopMode: () => Effect.die("Process reads are not expected in this test."),
        stopProcess: () => Effect.die("Process stops are not expected in this test."),
        readStandardInputs: () => Effect.die("Process reads are not expected in this test."),
      },
      browserEngine: () => Effect.succeed(createBrowserEngineTestDouble().engine),
      toolDiscovery: stubTools({ bun: process.execPath, codex: binary }),
    }),
  );
};
