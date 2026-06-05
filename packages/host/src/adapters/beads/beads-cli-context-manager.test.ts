import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import type { BeadsSharedServerContext } from "./beads-cli-context";
import { createBeadsCliContextManager } from "./beads-cli-context-manager";
import {
  createExistingTestBeadsCliContext,
  createFakeDolt,
  createTestToolDiscoveryPort,
  testOperationError,
} from "./test-support/beads-test-support";

const tempDirectories = new Set<string>();

const missingRepoPath = () =>
  path.join(tmpdir(), `odt-missing-repo-${Date.now()}-${Math.random().toString(16).slice(2)}`);

const createProcessEnvWithFakeDolt = async (): Promise<NodeJS.ProcessEnv> => {
  const binDir = await mkdtemp(path.join(tmpdir(), "odt-beads-manager-bin-"));
  tempDirectories.add(binDir);
  await createFakeDolt(binDir);
  return { PATH: binDir };
};

afterEach(async () => {
  await Promise.all(
    Array.from(tempDirectories, (tempDirectory) =>
      rm(tempDirectory, { force: true, recursive: true }),
    ),
  );
  tempDirectories.clear();
});

describe("createBeadsCliContextManager", () => {
  test("deduplicates concurrent shared-server context resolution", async () => {
    const context = await createExistingTestBeadsCliContext({
      prefix: "odt-beads-manager-test-",
    });
    const processEnv = await createProcessEnvWithFakeDolt();
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
      processEnv,
      toolDiscovery: createTestToolDiscoveryPort(),
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

  test("evicts failed shared-server context flights before retrying", async () => {
    const context = await createExistingTestBeadsCliContext({
      prefix: "odt-beads-manager-test-",
    });
    const processEnv = await createProcessEnvWithFakeDolt();
    let contextResolutionAttempts = 0;
    const manager = createBeadsCliContextManager({
      processEnv,
      toolDiscovery: createTestToolDiscoveryPort(),
      resolveCliContext(_repoPath, options) {
        return Effect.gen(function* () {
          expect(options.requireSharedServer).toBe(true);
          contextResolutionAttempts += 1;
          if (contextResolutionAttempts === 1) {
            return yield* Effect.fail(testOperationError(new Error("first context failed")));
          }
          return context;
        });
      },
    });

    await expect(
      Effect.runPromise(manager.resolveCliContext("/repo", { requireSharedServer: true })),
    ).rejects.toThrow("first context failed");
    await expect(
      Effect.runPromise(manager.resolveCliContext("/repo", { requireSharedServer: true })),
    ).resolves.toBe(context);
    expect(contextResolutionAttempts).toBe(2);
  });

  test("waits for in-flight context resolution before stopping owned shared servers", async () => {
    const context = await createExistingTestBeadsCliContext({
      prefix: "odt-beads-manager-test-",
    });
    const processEnv = await createProcessEnvWithFakeDolt();
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
      processEnv,
      toolDiscovery: createTestToolDiscoveryPort(),
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

  test("does not create non-shared context flights after close begins", async () => {
    const context = await createExistingTestBeadsCliContext({
      prefix: "odt-beads-manager-test-",
    });
    const processEnv = await createProcessEnvWithFakeDolt();
    let contextResolutionAttempts = 0;
    const manager = createBeadsCliContextManager({
      processEnv,
      toolDiscovery: createTestToolDiscoveryPort(),
      resolveCliContext() {
        contextResolutionAttempts += 1;
        return Effect.succeed(context);
      },
    });
    const repoPath = missingRepoPath();

    const resolution = Effect.runPromise(manager.resolveCliContext(repoPath)).then(
      () => null,
      (error: unknown) => error,
    );
    await expect(Effect.runPromise(manager.close())).resolves.toEqual({
      stoppedSharedDoltServers: 0,
    });

    expect(String(await resolution)).toContain("Beads task store is closing.");
    expect(contextResolutionAttempts).toBe(0);
  });

  test("does not reserve shared-server context flights after close begins", async () => {
    const context = await createExistingTestBeadsCliContext({
      prefix: "odt-beads-manager-test-",
    });
    const processEnv = await createProcessEnvWithFakeDolt();
    let contextResolutionAttempts = 0;
    const manager = createBeadsCliContextManager({
      processEnv,
      toolDiscovery: createTestToolDiscoveryPort(),
      resolveCliContext() {
        contextResolutionAttempts += 1;
        return Effect.succeed(context);
      },
    });
    const repoPath = missingRepoPath();

    const resolution = Effect.runPromise(
      manager.resolveCliContext(repoPath, { requireSharedServer: true }),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    await expect(Effect.runPromise(manager.close())).resolves.toEqual({
      stoppedSharedDoltServers: 0,
    });

    expect(String(await resolution)).toContain("Beads task store is closing.");
    expect(contextResolutionAttempts).toBe(0);
  });
});
