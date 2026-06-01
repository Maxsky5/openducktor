import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { BeadsSharedServerContext } from "./beads-cli-context";
import { createBeadsCliContextManager } from "./beads-cli-context-manager";
import {
  createExistingTestBeadsCliContext,
  createTestToolDiscoveryPort,
  testOperationError,
} from "./beads-test-support";

describe("createBeadsCliContextManager", () => {
  test("deduplicates concurrent shared-server context resolution", async () => {
    const context = await createExistingTestBeadsCliContext({
      prefix: "odt-beads-manager-test-",
    });
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

  test("waits for in-flight context resolution before stopping owned shared servers", async () => {
    const context = await createExistingTestBeadsCliContext({
      prefix: "odt-beads-manager-test-",
    });
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
});
