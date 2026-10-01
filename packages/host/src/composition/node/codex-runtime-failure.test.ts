import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { createCodexAppServerTransportRegistry } from "../../adapters/codex/codex-app-server-transport-registry";
import {
  processIsAlive,
  stubCommands,
  stubTools,
  waitFor,
  writeCodex,
} from "../../adapters/codex/codex-workspace-runtime-starter.test-support";
import type { McpHostBridgeServer } from "../../adapters/mcp/mcp-host-bridge-server";
import { createSourceRuntimeDistribution } from "../../adapters/runtimes/runtime-distribution";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import { createFixedRuntimeSettingsConfig } from "../../test-support/runtime-settings-config";
import { createGitPortTestDouble } from "../../test-support/service-test-doubles";
import { createTaskStoreTestDouble } from "../../test-support/task-store-test-double";
import { removeTestDirectory } from "../../test-support/temp-directory";
import type { HostLifecycleLogger } from "../host-lifecycle";
import { createNodeEffectHostCommandRouter } from "./create-node-effect-host-command-router";
import type { EffectNodeHostCommandRouter } from "./node-host-command-router-types";

describe("Codex runtime failure reporting", () => {
  test.each([
    { line: JSON.stringify({ id: 999, result: {} }), message: "unexpected id 999" },
    { line: "{invalid JSON", message: "Invalid Codex app-server JSON" },
    { line: null, message: "closed" },
  ])("keeps the host and other runtimes usable after $message", async ({ line, message }) => {
    const root = await mkdtemp(join(tmpdir(), "odt-codex-host-failure-"));
    const repo = join(root, "repo");
    const otherRepo = join(root, "other-repo");
    const errors: string[] = [];
    const fatalFailures: HostOperationErrorAggregate[] = [];
    let router: EffectNodeHostCommandRouter | undefined;
    try {
      await mkdir(repo);
      await mkdir(otherRepo);
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
      const first = await Effect.runPromise(
        router.invoke("runtime_ensure", {
          repoPath: repo,
          runtimeKind: "codex",
        }),
      );
      const other = await Effect.runPromise(
        router.invoke("runtime_ensure", {
          repoPath: otherRepo,
          runtimeKind: "codex",
        }),
      );
      const pid = Number(await readFile(join(repo, "runtime.pid"), "utf8"));
      const otherPid = Number(await readFile(join(otherRepo, "runtime.pid"), "utf8"));
      const fatalPath = join(repo, "fatal.json");
      if (line === null) process.kill(pid, "SIGTERM");
      else await writeFile(fatalPath, line);
      await waitFor(() => errors.length > 0 || fatalFailures.length > 0);
      expect(fatalFailures).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(first.runtimeId);
      expect(errors[0]).toContain(message);
      expect(processIsAlive(pid)).toBe(false);
      expect(processIsAlive(otherPid)).toBe(true);
      await expect(
        Effect.runPromise(
          codexAppServer.request({
            runtimeId: other.runtimeId,
            method: "thread/loaded/list",
            params: {},
          }),
        ),
      ).resolves.toEqual({ data: [], nextCursor: null });
      await rm(fatalPath, { force: true });
      const replacement = await Effect.runPromise(
        router.invoke("runtime_ensure", {
          repoPath: repo,
          runtimeKind: "codex",
        }),
      );
      expect(replacement.runtimeId).not.toBe(first.runtimeId);
      await expect(
        Effect.runPromise(
          codexAppServer.request({
            runtimeId: replacement.runtimeId,
            method: "thread/loaded/list",
            params: {},
          }),
        ),
      ).resolves.toEqual({ data: [], nextCursor: null });
      await expect(
        Effect.runPromise(
          router.invoke("runtime_list", {
            runtimeKind: "codex",
          }),
        ),
      ).resolves.toEqual(expect.arrayContaining([other, replacement]));
      await Effect.runPromise(router.invoke("runtime_stop", { runtimeId: replacement.runtimeId }));
      await expect(
        Effect.runPromise(
          router.invoke("runtime_list", {
            runtimeKind: "codex",
          }),
        ),
      ).resolves.toEqual([other]);
      expect(errors).toHaveLength(1);
      expect(fatalFailures).toEqual([]);
    } finally {
      if (router) await Effect.runPromise(router.dispose());
      await removeTestDirectory(root);
    }
  });

  test("reports a runtime logging failure through the host-fatal callback", async () => {
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
            }).pipe(Effect.zipRight(Effect.fail(failure))),
          info: () => Effect.void,
        },
        (error) =>
          Effect.sync(() => {
            fatalFailures.push(error);
          }),
      );
      const runtime = await Effect.runPromise(
        router.invoke("runtime_ensure", {
          repoPath: root,
          runtimeKind: "codex",
        }),
      );
      await writeFile(join(root, "fatal.json"), JSON.stringify({ id: 999, result: {} }));
      await waitFor(() => fatalFailures.length === 1);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(runtime.runtimeId);
      expect(errors[0]).toContain("unexpected id 999");
      expect(fatalFailures[0]).toMatchObject({
        operation: "host.lifecycle.log-error",
        cause: failure,
      });
      expect(processIsAlive(Number(await readFile(join(root, "runtime.pid"), "utf8")))).toBe(false);
    } finally {
      if (router) await Effect.runPromise(router.dispose());
      await removeTestDirectory(root);
    }
  });
});

const createRouter = async (
  root: string,
  codexAppServer: ReturnType<typeof createCodexAppServerTransportRegistry>,
  lifecycleLogger: HostLifecycleLogger,
  onBackgroundFailure: (failure: HostOperationErrorAggregate) => Effect.Effect<void, never>,
): Promise<EffectNodeHostCommandRouter> => {
  const binary = await writeCodex(root, {
    runtimePidPath: "runtime.pid",
    fatalMessagePath: "fatal.json",
  });
  const connection = {
    workspaceId: "repo",
    hostUrl: "http://127.0.0.1:14327",
    hostToken: "test-token",
  };
  const mcpHostBridge = {
    ensureConnection: () => Effect.succeed(connection),
    ensureExternalDiscoveryReady: () => Effect.succeed(connection),
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
      settingsConfig: createFixedRuntimeSettingsConfig("codex", binary),
      systemCommands: stubCommands(),
      taskEventPublicationReporter: { report: () => Effect.void },
      taskStore: createTaskStoreTestDouble({}),
      terminalPty: { start: () => Effect.die("Terminal PTY is not expected in this test.") },
      toolDiscovery: stubTools({ bun: process.execPath, codex: binary }),
    }),
  );
};
