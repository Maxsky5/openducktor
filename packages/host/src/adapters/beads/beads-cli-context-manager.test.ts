import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createToolDiscoveryAdapter } from "../system/tool-discovery";
import type { BeadsSharedServerContext } from "./beads-cli-context";
import { createBeadsCliContextManager } from "./beads-cli-context-manager";

const TEST_BEADS_TOOL_PATHS = {
  beads: "bd",
};

const TEST_SHARED_DOLT_TOOL_PATHS = {
  dolt: "dolt",
};

const createToolDiscoveryPort = () =>
  createToolDiscoveryAdapter({
    systemCommands: {
      resolveCommandPath: (command) => Effect.succeed(command),
      runCommandAllowFailure: () => Effect.succeed({ ok: false, stdout: "", stderr: "" }),
      versionCommand: () => Effect.succeed(null),
    },
  });

const createBeadsCliContext = (beadsDir: string): BeadsSharedServerContext => ({
  repoPath: "/repo",
  repoId: "repo-12345678",
  databaseName: "odt_repo_123456789abc",
  attachmentRoot: path.dirname(beadsDir),
  beadsDir,
  workingDir: path.dirname(beadsDir),
  serverStatePath: "/config/beads/shared-server/server.json",
  sharedServer: {
    pid: process.pid,
    host: "127.0.0.1",
    port: 36000,
    user: "root",
    ownerPid: process.pid,
    acquisition: "started_by_owner",
    sharedServerRoot: "/config/beads/shared-server",
    doltDataDir: "/config/beads/shared-server/dolt",
    startedAt: "2026-05-10T00:00:00Z",
  },
  env: {
    BEADS_DIR: beadsDir,
    BEADS_DOLT_SERVER_MODE: "1",
    BEADS_DOLT_SERVER_HOST: "127.0.0.1",
    BEADS_DOLT_SERVER_PORT: "36000",
    BEADS_DOLT_SERVER_USER: "root",
  },
  tools: TEST_BEADS_TOOL_PATHS,
  sharedDoltTools: TEST_SHARED_DOLT_TOOL_PATHS,
});

const createExistingBeadsCliContext = async (): Promise<BeadsSharedServerContext> => {
  const attachmentRoot = await mkdtemp(path.join(tmpdir(), "odt-beads-manager-test-"));
  const beadsDir = path.join(attachmentRoot, ".beads");
  await mkdir(beadsDir);
  return createBeadsCliContext(beadsDir);
};

const testOperationError = (cause: unknown) =>
  new HostOperationError({
    operation: "test.effect",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

describe("createBeadsCliContextManager", () => {
  test("deduplicates concurrent shared-server context resolution", async () => {
    const context = await createExistingBeadsCliContext();
    let resolveContextRequested: () => void = () => {};
    const contextRequested = new Promise<void>((resolve) => {
      resolveContextRequested = resolve;
    });
    let resolveContext: (context: BeadsSharedServerContext) => void = () => {};
    const contextResolution = new Promise<BeadsSharedServerContext>((resolve) => {
      resolveContext = resolve;
    });
    let contextResolutionAttempts = 0;
    const manager = createBeadsCliContextManager({
      processEnv: {},
      toolDiscovery: createToolDiscoveryPort(),
      resolveCliContext(_repoPath, options) {
        return Effect.tryPromise({
          try: async () => {
            expect(options.requireSharedServer).toBe(true);
            contextResolutionAttempts += 1;
            resolveContextRequested();
            return contextResolution;
          },
          catch: testOperationError,
        });
      },
    });

    const first = Effect.runPromise(
      manager.resolveCliContext("/repo", { requireSharedServer: true }),
    );
    const second = Effect.runPromise(
      manager.resolveCliContext("/repo", { requireSharedServer: true }),
    );

    await contextRequested;
    resolveContext(context);

    await expect(Promise.all([first, second])).resolves.toEqual([context, context]);
    expect(contextResolutionAttempts).toBe(1);
  });

  test("waits for in-flight context resolution before stopping owned shared servers", async () => {
    const context = await createExistingBeadsCliContext();
    let resolveContextRequested: () => void = () => {};
    const contextRequested = new Promise<void>((resolve) => {
      resolveContextRequested = resolve;
    });
    let resolveContext: (context: BeadsSharedServerContext) => void = () => {};
    const contextResolution = new Promise<BeadsSharedServerContext>((resolve) => {
      resolveContext = resolve;
    });
    const stoppedServers: Array<{
      pid: number;
      serverStatePath: string;
    }> = [];
    const manager = createBeadsCliContextManager({
      processEnv: {},
      toolDiscovery: createToolDiscoveryPort(),
      resolveCliContext() {
        return Effect.tryPromise({
          try: async () => {
            resolveContextRequested();
            return contextResolution;
          },
          catch: testOperationError,
        });
      },
      stopSharedDoltServer(sharedServer, serverStatePath) {
        return Effect.sync(() => {
          stoppedServers.push({ pid: sharedServer.pid, serverStatePath });
        });
      },
    });

    const resolution = Effect.runPromise(
      manager.resolveCliContext("/repo", { requireSharedServer: true }),
    );
    await contextRequested;
    const close = Effect.runPromise(manager.close());
    resolveContext(context);

    await expect(resolution).resolves.toBe(context);
    await expect(close).resolves.toEqual({ stoppedSharedDoltServers: 1 });
    expect(stoppedServers).toEqual([
      {
        pid: process.pid,
        serverStatePath: "/config/beads/shared-server/server.json",
      },
    ]);
  });
});
