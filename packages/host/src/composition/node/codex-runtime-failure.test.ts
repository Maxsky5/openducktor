import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  processIsAlive,
  stubCommands,
  stubTools,
  waitFor,
  writeCodex,
} from "../../adapters/codex/codex-runtime-starter.test-support";
import type { McpHostBridgeServer } from "../../adapters/mcp/mcp-host-bridge-server";
import { createSourceRuntimeDistribution } from "../../adapters/runtimes/runtime-distribution";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import { createFixedRuntimeSettingsConfig } from "../../test-support/runtime-settings-config";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import { createTaskStoreTestDouble } from "../../test-support/task-store-test-double";
import { removeTestDirectory } from "../../test-support/temp-directory";
import type { HostLifecycleLogger } from "../host-lifecycle";
import { createNodeEffectHostCommandRouter } from "./create-node-effect-host-command-router";
import type { EffectNodeHostCommandRouter } from "./node-host-command-router-types";

// Each case spawns real fixture processes, which start slowly when the parallel suite loads the CPU.
const PROCESS_WAIT_MS = 3_000;
const PROCESS_TEST_TIMEOUT_MS = 15_000;

const codexStatus = async (router: EffectNodeHostCommandRouter): Promise<HostRuntimeStatus> => {
  const snapshot = hostRuntimeSnapshotSchema.parse(
    await Effect.runPromise(router.invoke("runtime_status")),
  );
  const status = snapshot.runtimes.find((runtime) => runtime.kind === "codex");
  if (!status) throw new Error("runtime_status has no codex entry.");
  return status;
};

/** Initializes the host, which starts the codex runtime enabled in saved settings. */
const startHostRuntime = async (router: EffectNodeHostCommandRouter): Promise<string> => {
  await Effect.runPromise(router.initialize());
  await waitFor(async () => (await codexStatus(router)).state === "ready", PROCESS_WAIT_MS);
  const { runtimeId } = await codexStatus(router);
  if (!runtimeId) throw new Error("The ready codex runtime has no runtime ID.");
  return runtimeId;
};

describe("Codex runtime failure reporting", () => {
  test.each([
    { line: JSON.stringify({ id: 999, result: {} }), message: "unexpected id 999" },
    { line: "{invalid JSON", message: "Invalid Codex app-server JSON" },
    { line: null, message: "closed" },
  ])(
    "logs one host error and restarts the shared runtime after $message",
    async ({ line, message }) => {
      const root = await mkdtemp(join(tmpdir(), "odt-codex-host-failure-"));
      const errors: string[] = [];
      const fatalFailures: HostOperationErrorAggregate[] = [];
      let router: EffectNodeHostCommandRouter | undefined;
      try {
        const codexAppServer = createCodexAppServerTransportRegistry();
        router = await createRouter(
          root,
          codexAppServer,
          {
            error: (text) =>
              Effect.sync(() => {
                errors.push(text);
              }),
            info: () => Effect.void,
          },
          (failure) =>
            Effect.sync(() => {
              fatalFailures.push(failure);
            }),
        );
        const firstRuntimeId = await startHostRuntime(router);
        const pid = Number(await readFile(join(root, "runtime.pid"), "utf8"));
        const fatalPath = join(root, "fatal.json");
        if (line === null) process.kill(pid, "SIGTERM");
        else await writeFile(fatalPath, line);
        await waitFor(() => errors.length > 0 || fatalFailures.length > 0, PROCESS_WAIT_MS);
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
      let router: EffectNodeHostCommandRouter | undefined;
      try {
        router = await createRouter(
          root,
          createCodexAppServerTransportRegistry(),
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
            }),
        );
        const runtimeId = await startHostRuntime(router);
        const pid = Number(await readFile(join(root, "runtime.pid"), "utf8"));
        await writeFile(join(root, "fatal.json"), JSON.stringify({ id: 999, result: {} }));
        await waitFor(() => fatalFailures.length === 1, PROCESS_WAIT_MS);
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
  return Effect.runPromise(
    createNodeEffectHostCommandRouter({
      codexAppServer,
      configDirScope: "test",
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
          Effect.fail(new HostOperationError({ operation: "test.health", message: "not probed" })),
      },
      settingsConfig: createFixedRuntimeSettingsConfig("codex", binary),
      systemCommands: stubCommands(),
      taskEventPublicationReporter: { report: () => Effect.void },
      taskStore: createTaskStoreTestDouble({}),
      terminalPty: { start: () => Effect.die("Terminal PTY is not expected in this test.") },
      toolDiscovery: stubTools({ bun: process.execPath, codex: binary }),
    }),
  );
};
