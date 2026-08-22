import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Cause, Effect, Exit } from "effect";
import { createNodeTaskAssetFilePort } from "./filesystem-task-asset-file-port";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const createHarness = async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "odt-task-assets-"));
  roots.push(configDir);
  const aliveProcessIds = new Set([10_001]);
  const processStartedAtMs = new Map([[10_001, 10_001]]);
  const createPort = (instanceId: string, processId: number) => {
    if (!processStartedAtMs.has(processId)) {
      processStartedAtMs.set(processId, processId);
    }
    return createNodeTaskAssetFilePort(
      { configDir },
      {
        owner: { version: 1, instanceId, processId, startedAtMs: processId },
        processIsAlive: (candidate) => aliveProcessIds.has(candidate),
        processStartedAtMs: (candidate) => {
          const startedAtMs = processStartedAtMs.get(candidate);
          if (startedAtMs === undefined) {
            return Promise.reject(new Error(`Missing process start time for ${candidate}.`));
          }
          return Promise.resolve(startedAtMs);
        },
      },
    );
  };
  return {
    aliveProcessIds,
    configDir,
    createPort,
    port: createPort("10000000-0000-4000-8000-000000000001", 10_001),
    processStartedAtMs,
  };
};

const workspaceId = "fairnest";
const taskId = "task-1";
const assetId = "550e8400-e29b-41d4-a716-446655440000";

describe("node task asset file port", () => {
  test("promotes, quarantines, restores, and purges within the dedicated namespace", async () => {
    const { configDir, port } = await createHarness();
    await Effect.runPromise(port.stage({ workspaceId, assetId, bytes: new Uint8Array([1, 2, 3]) }));
    await Effect.runPromise(port.promote({ workspaceId, taskId, assetId, operation: "update" }));
    expect(await Effect.runPromise(port.readDurable({ workspaceId, taskId, assetId }))).toEqual(
      new Uint8Array([1, 2, 3]),
    );

    const quarantineId = await Effect.runPromise(
      port.quarantineAssets({
        workspaceId,
        taskId,
        assetIds: [assetId],
        promotedAssetIds: [],
        operation: "update",
      }),
    );
    expect(quarantineId).not.toBeNull();
    expect(await Effect.runPromise(port.readDurable({ workspaceId, taskId, assetId }))).toBeNull();
    // SAFETY: This test controls the fixture and supplies `string` used by this case.
    await Effect.runPromise(port.restoreQuarantine(quarantineId as string));
    expect(
      await Effect.runPromise(port.readDurable({ workspaceId, taskId, assetId })),
    ).not.toBeNull();

    const taskQuarantineId = await Effect.runPromise(
      port.quarantineTaskDirectory({ workspaceId, taskId }),
    );
    // SAFETY: This test controls the fixture and supplies `string` used by this case.
    await Effect.runPromise(port.purgeQuarantine(taskQuarantineId as string));
    expect(
      await readFile(
        path.join(
          configDir,
          "task-asset-staging",
          "instances",
          "10000000-0000-4000-8000-000000000001",
          workspaceId,
          assetId,
        ),
      ),
    ).toEqual(Buffer.from([1, 2, 3]));
    expect(await Effect.runPromise(port.readDurable({ workspaceId, taskId, assetId }))).toBeNull();
  });

  test("restores a quarantine after the file port is recreated", async () => {
    const { aliveProcessIds, createPort, port } = await createHarness();
    await Effect.runPromise(port.stage({ workspaceId, assetId, bytes: new Uint8Array([1, 2, 3]) }));
    await Effect.runPromise(port.promote({ workspaceId, taskId, assetId, operation: "update" }));
    const quarantineId = await Effect.runPromise(
      port.quarantineAssets({
        workspaceId,
        taskId,
        assetIds: [assetId],
        promotedAssetIds: [],
        operation: "update",
      }),
    );
    if (!quarantineId) {
      throw new Error("Expected an asset quarantine.");
    }

    aliveProcessIds.delete(10_001);
    aliveProcessIds.add(10_002);
    const restartedPort = createPort("10000000-0000-4000-8000-000000000002", 10_002);
    expect(await Effect.runPromise(restartedPort.listQuarantines())).toEqual([
      {
        id: quarantineId,
        workspaceId,
        taskId,
        operation: "update",
        assetIds: [assetId],
        promotedAssetIds: [],
      },
    ]);
    await Effect.runPromise(restartedPort.restoreQuarantine(quarantineId));

    expect(
      await Effect.runPromise(restartedPort.readDurable({ workspaceId, taskId, assetId })),
    ).toEqual(new Uint8Array([1, 2, 3]));
    expect(await Effect.runPromise(restartedPort.listQuarantines())).toEqual([]);
  });

  test("cleans an empty quarantine directory left after its manifest was removed", async () => {
    const { configDir, port } = await createHarness();
    const quarantineId = "50000000-0000-4000-8000-000000000002";
    const quarantineRoot = path.join(configDir, "task-asset-quarantine", quarantineId);
    await mkdir(quarantineRoot, { recursive: true });

    expect(await Effect.runPromise(port.listQuarantines())).toEqual([]);
    expect(await readdir(path.dirname(quarantineRoot))).not.toContain(quarantineId);
  });

  test("lets only one concurrent host claim a dead-owner quarantine", async () => {
    const { aliveProcessIds, createPort, port } = await createHarness();
    await Effect.runPromise(port.stage({ workspaceId, assetId, bytes: new Uint8Array([1, 2, 3]) }));
    await Effect.runPromise(port.promote({ workspaceId, taskId, assetId, operation: "update" }));
    const quarantineId = await Effect.runPromise(
      port.quarantineAssets({
        workspaceId,
        taskId,
        assetIds: [assetId],
        promotedAssetIds: [],
        operation: "update",
      }),
    );
    if (!quarantineId) {
      throw new Error("Expected an asset quarantine.");
    }
    aliveProcessIds.delete(10_001);
    aliveProcessIds.add(10_002);
    aliveProcessIds.add(10_003);
    const firstRecoveryPort = createPort("10000000-0000-4000-8000-000000000002", 10_002);
    const secondRecoveryPort = createPort("10000000-0000-4000-8000-000000000003", 10_003);

    const results = await Promise.all([
      Effect.runPromise(firstRecoveryPort.listQuarantines()),
      Effect.runPromise(secondRecoveryPort.listQuarantines()),
    ]);

    expect(results.flat()).toEqual([
      {
        id: quarantineId,
        workspaceId,
        taskId,
        operation: "update",
        assetIds: [assetId],
        promotedAssetIds: [],
      },
    ]);
  });

  test("rejects traversal identifiers and never follows a durable symlink", async () => {
    const { configDir, port } = await createHarness();
    await expect(
      Effect.runPromise(port.readDurable({ workspaceId, taskId: "../other", assetId })),
    ).rejects.toThrow("identifiers are invalid");

    await Effect.runPromise(port.stage({ workspaceId, assetId, bytes: new Uint8Array([1]) }));
    await Effect.runPromise(port.promote({ workspaceId, taskId, assetId, operation: "update" }));
    const durablePath = path.join(configDir, "task-assets", workspaceId, taskId, assetId);
    const outsidePath = path.join(configDir, "outside.png");
    await writeFile(outsidePath, new Uint8Array([9]));
    await unlink(durablePath);
    await symlink(outsidePath, durablePath);

    expect(await Effect.runPromise(port.readDurable({ workspaceId, taskId, assetId }))).toBeNull();
  });

  test("reports invalid identifiers as typed failures without defects", async () => {
    const { port } = await createHarness();
    const exit = await Effect.runPromiseExit(
      port.readDurable({ workspaceId, taskId: "../other", assetId }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Array.from(Cause.failures(exit.cause))).toEqual([
        expect.objectContaining({
          _tag: "TaskAssetError",
          code: "validation",
          failedPhase: "validate_identifiers",
        }),
      ]);
      expect(Array.from(Cause.defects(exit.cause))).toEqual([]);
    }
  });

  test("makes staged removal safe to retry after a partial batch", async () => {
    const { port } = await createHarness();
    const missingAssetId = "750e8400-e29b-41d4-a716-446655440001";
    await Effect.runPromise(port.stage({ workspaceId, assetId, bytes: new Uint8Array([1]) }));

    await expect(
      Effect.runPromise(port.removeStaged({ workspaceId, assetIds: [assetId, missingAssetId] })),
    ).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(port.removeStaged({ workspaceId, assetIds: [assetId, missingAssetId] })),
    ).resolves.toBeUndefined();
  });

  test("keeps the caller operation on filesystem failures and validates task-only deletes", async () => {
    const { port } = await createHarness();
    await Effect.runPromise(port.stage({ workspaceId, assetId, bytes: new Uint8Array([1]) }));
    await Effect.runPromise(port.promote({ workspaceId, taskId, assetId, operation: "create" }));

    const promoteExit = await Effect.runPromiseExit(
      port.promote({ workspaceId, taskId, assetId, operation: "create" }),
    );
    expect(Exit.isFailure(promoteExit)).toBe(true);
    if (Exit.isFailure(promoteExit)) {
      expect(Array.from(Cause.failures(promoteExit.cause))).toEqual([
        expect.objectContaining({
          _tag: "TaskAssetError",
          operation: "create",
          failedPhase: "promote_staged_file",
        }),
      ]);
    }

    const deleteExit = await Effect.runPromiseExit(
      port.quarantineTaskDirectory({ workspaceId, taskId: "../other" }),
    );
    expect(Exit.isFailure(deleteExit)).toBe(true);
    if (Exit.isFailure(deleteExit)) {
      expect(Array.from(Cause.failures(deleteExit.cause))).toEqual([
        expect.objectContaining({
          _tag: "TaskAssetError",
          operation: "delete",
          failedPhase: "validate_identifiers",
          assetIds: [],
        }),
      ]);
    }
  });

  test("restores earlier files when a multi-file quarantine fails partway", async () => {
    const { configDir, port } = await createHarness();
    const missingAssetId = "750e8400-e29b-41d4-a716-446655440001";
    for (const id of [assetId, missingAssetId]) {
      await Effect.runPromise(port.stage({ workspaceId, assetId: id, bytes: new Uint8Array([1]) }));
      await Effect.runPromise(
        port.promote({ workspaceId, taskId, assetId: id, operation: "update" }),
      );
    }
    await unlink(path.join(configDir, "task-assets", workspaceId, taskId, missingAssetId));

    await expect(
      Effect.runPromise(
        port.quarantineAssets({
          workspaceId,
          taskId,
          assetIds: [assetId, missingAssetId],
          promotedAssetIds: [],
          operation: "update",
        }),
      ),
    ).rejects.toThrow(`Failed to quarantine obsolete task asset ${missingAssetId}`);
    expect(
      await Effect.runPromise(port.readDurable({ workspaceId, taskId, assetId })),
    ).not.toBeNull();
  });

  test("isolates live owners and removes dead-owner staging after recovery", async () => {
    const { aliveProcessIds, configDir, createPort, port } = await createHarness();
    await Effect.runPromise(port.stage({ workspaceId, assetId, bytes: new Uint8Array([1]) }));
    await Effect.runPromise(port.promote({ workspaceId, taskId, assetId, operation: "update" }));
    const quarantineId = await Effect.runPromise(
      port.quarantineAssets({
        workspaceId,
        taskId,
        assetIds: [assetId],
        promotedAssetIds: [],
        operation: "update",
      }),
    );
    if (!quarantineId) {
      throw new Error("Expected an asset quarantine.");
    }

    aliveProcessIds.add(10_002);
    const concurrentPort = createPort("10000000-0000-4000-8000-000000000002", 10_002);
    expect(await Effect.runPromise(concurrentPort.listQuarantines())).toEqual([]);
    expect(await Effect.runPromise(concurrentPort.clearStaging())).toBe(0);
    await expect(
      readFile(
        path.join(
          configDir,
          "task-asset-staging",
          "instances",
          "10000000-0000-4000-8000-000000000001",
          workspaceId,
          assetId,
        ),
      ),
    ).resolves.toEqual(Buffer.from([1]));

    aliveProcessIds.delete(10_001);
    aliveProcessIds.add(10_003);
    const recoveryPort = createPort("10000000-0000-4000-8000-000000000003", 10_003);
    expect(await Effect.runPromise(recoveryPort.listQuarantines())).toHaveLength(1);
    await Effect.runPromise(recoveryPort.restoreQuarantine(quarantineId));
    expect(await Effect.runPromise(recoveryPort.clearStaging())).toBe(1);
    expect(await readdir(path.join(configDir, "task-asset-owners"))).not.toContain(
      "10000000-0000-4000-8000-000000000001.json",
    );
  });

  test("keeps crash cleanup bounded across repeated owner generations", async () => {
    const { aliveProcessIds, configDir, createPort } = await createHarness();
    aliveProcessIds.clear();

    for (let index = 1; index <= 4; index += 1) {
      const instanceId = `20000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
      const processId = 20_000 + index;
      aliveProcessIds.add(processId);
      const crashPort = createPort(instanceId, processId);
      await Effect.runPromise(
        crashPort.stage({
          workspaceId,
          assetId: `30000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
          bytes: new Uint8Array([index]),
        }),
      );
      aliveProcessIds.delete(processId);

      const sweeperProcessId = 30_000 + index;
      const sweeperId = `40000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
      aliveProcessIds.add(sweeperProcessId);
      const sweeper = createPort(sweeperId, sweeperProcessId);
      await Effect.runPromise(sweeper.clearStaging());
      await Effect.runPromise(sweeper.cleanupCurrentOwner());
      aliveProcessIds.delete(sweeperProcessId);
    }

    expect(await readdir(path.join(configDir, "task-asset-owners"))).toEqual([]);
    expect(await readdir(path.join(configDir, "task-asset-staging", "instances"))).toEqual([]);
  });

  test("removes an incomplete owner publication left by a dead process", async () => {
    const { configDir, port } = await createHarness();
    const deadInstanceId = "20000000-0000-4000-8000-000000000001";
    const publicationName = `.publishing-${deadInstanceId}-20001-20001-30000000-0000-4000-8000-000000000001.json`;
    const ownersRoot = path.join(configDir, "task-asset-owners");
    await mkdir(ownersRoot, { recursive: true });
    await writeFile(path.join(ownersRoot, publicationName), '{"version":1');

    expect(await Effect.runPromise(port.clearStaging())).toBe(0);
    expect(await readdir(ownersRoot)).not.toContain(publicationName);
  });

  test("clears staging when a live process has reused a dead owner's PID", async () => {
    const { aliveProcessIds, configDir, createPort, port, processStartedAtMs } =
      await createHarness();
    await Effect.runPromise(port.stage({ workspaceId, assetId, bytes: new Uint8Array([1]) }));

    processStartedAtMs.set(10_001, 20_001);
    aliveProcessIds.add(10_002);
    const recoveryPort = createPort("10000000-0000-4000-8000-000000000002", 10_002);

    expect(await Effect.runPromise(recoveryPort.clearStaging())).toBe(1);
    expect(await readdir(path.join(configDir, "task-asset-owners"))).not.toContain(
      "10000000-0000-4000-8000-000000000001.json",
    );
  });

  test("reads the current process start time when checking owner identity", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "odt-task-assets-"));
    roots.push(configDir);
    const staleInstanceId = "10000000-0000-4000-8000-000000000003";
    const ownersRoot = path.join(configDir, "task-asset-owners");
    const staleStagingRoot = path.join(
      configDir,
      "task-asset-staging",
      "instances",
      staleInstanceId,
      workspaceId,
    );
    await mkdir(ownersRoot, { recursive: true });
    await mkdir(staleStagingRoot, { recursive: true });
    await writeFile(
      path.join(ownersRoot, `${staleInstanceId}.json`),
      JSON.stringify({
        version: 1,
        instanceId: staleInstanceId,
        processId: process.pid,
        startedAtMs: 0,
      }),
    );
    await writeFile(path.join(staleStagingRoot, assetId), Buffer.from([1]));
    const port = createNodeTaskAssetFilePort({ configDir });

    expect(await Effect.runPromise(port.clearStaging())).toBe(1);
    expect(await readdir(ownersRoot)).not.toContain(`${staleInstanceId}.json`);
    await Effect.runPromise(port.cleanupCurrentOwner());
  }, 1_000);

  test("recovers legacy ownerless quarantine data and clears legacy staging", async () => {
    const { configDir, port } = await createHarness();
    const quarantineId = "50000000-0000-4000-8000-000000000001";
    const legacyQuarantineRoot = path.join(configDir, "task-asset-quarantine", quarantineId);
    await mkdir(legacyQuarantineRoot, { recursive: true });
    await writeFile(
      path.join(legacyQuarantineRoot, "manifest.json"),
      JSON.stringify({
        version: 1,
        id: quarantineId,
        workspaceId,
        taskId,
        operation: "update",
        assetIds: [assetId],
        promotedAssetIds: [],
      }),
    );
    await writeFile(path.join(legacyQuarantineRoot, assetId), new Uint8Array([7]));
    const legacyStagingFile = path.join(configDir, "task-asset-staging", workspaceId, assetId);
    await mkdir(path.dirname(legacyStagingFile), { recursive: true });
    await writeFile(legacyStagingFile, new Uint8Array([8]));

    expect(await Effect.runPromise(port.listQuarantines())).toEqual([
      {
        id: quarantineId,
        workspaceId,
        taskId,
        operation: "update",
        assetIds: [assetId],
        promotedAssetIds: [],
      },
    ]);
    await Effect.runPromise(port.restoreQuarantine(quarantineId));
    expect(await Effect.runPromise(port.clearStaging())).toBe(1);
    expect(await Effect.runPromise(port.readDurable({ workspaceId, taskId, assetId }))).toEqual(
      new Uint8Array([7]),
    );
  });

  test("reports malformed owner records without deleting their state", async () => {
    const { configDir, port } = await createHarness();
    const malformedOwnerId = "60000000-0000-4000-8000-000000000001";
    const marker = path.join(configDir, "task-asset-owners", `${malformedOwnerId}.json`);
    const ownedState = path.join(
      configDir,
      "task-asset-staging",
      "instances",
      malformedOwnerId,
      workspaceId,
      assetId,
    );
    await mkdir(path.dirname(marker), { recursive: true });
    await writeFile(marker, "{}");
    await mkdir(path.dirname(ownedState), { recursive: true });
    await writeFile(ownedState, new Uint8Array([9]));

    const error = await Effect.runPromise(Effect.flip(port.clearStaging()));
    expect(error).toMatchObject({
      _tag: "TaskAssetError",
      failedPhase: "clear_staging",
      cause: expect.objectContaining({
        message: "Task asset owner record is invalid.",
      }),
    });
    await expect(readFile(ownedState)).resolves.toEqual(Buffer.from([9]));
  });
});
