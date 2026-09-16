import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { TaskAssetQuarantine } from "../../ports/task-asset-file-port";
import { createTaskAssetRecoveryService } from "./task-asset-recovery-service";

const updateQuarantine: TaskAssetQuarantine = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  workspaceId: "fairnest",
  taskId: "task-1",
  operation: "update",
  assetIds: ["550e8400-e29b-41d4-a716-446655440001", "550e8400-e29b-41d4-a716-446655440002"],
  promotedAssetIds: [],
};

describe("task asset recovery service", () => {
  test("restores an interrupted update whose asset rows are still registered", async () => {
    const restored: string[] = [];
    const purged: string[] = [];
    const service = createTaskAssetRecoveryService({
      filePort: {
        durableExists: () => Effect.succeed(false),
        listQuarantines: () => Effect.succeed([updateQuarantine]),
        removeDurable: () => Effect.void,
        restoreQuarantine: (id) => Effect.sync(() => restored.push(id)),
        purgeQuarantine: (id) => Effect.sync(() => purged.push(id)),
      },
      registry: {
        listAssets: () =>
          Effect.succeed(
            updateQuarantine.assetIds.map((id) => ({
              id,
              taskId: updateQuarantine.taskId,
              scope: "description" as const,
              originalName: `${id}.png`,
              mediaType: "image/png",
              byteSize: 1,
              createdAt: new Date(0),
            })),
          ),
        taskExists: () => Effect.succeed(true),
      },
      taskStore: { deleteTask: () => Effect.succeed(true) },
      resolveRepoPath: () => Effect.succeed("/repo"),
    });

    expect(await Effect.runPromise(service.startupSweep())).toBe(1);
    expect(restored).toEqual([updateQuarantine.id]);
    expect(purged).toEqual([]);
  });

  test("purges committed update and delete quarantines", async () => {
    const deleteQuarantine: TaskAssetQuarantine = {
      id: "550e8400-e29b-41d4-a716-446655440003",
      workspaceId: "fairnest",
      taskId: "task-2",
      operation: "delete",
      assetIds: [],
      promotedAssetIds: [],
    };
    const restored: string[] = [];
    const purged: string[] = [];
    const service = createTaskAssetRecoveryService({
      filePort: {
        durableExists: () => Effect.succeed(false),
        listQuarantines: () => Effect.succeed([updateQuarantine, deleteQuarantine]),
        removeDurable: () => Effect.void,
        restoreQuarantine: (id) => Effect.sync(() => restored.push(id)),
        purgeQuarantine: (id) => Effect.sync(() => purged.push(id)),
      },
      registry: {
        listAssets: () => Effect.succeed([]),
        taskExists: () => Effect.succeed(false),
      },
      taskStore: { deleteTask: () => Effect.succeed(true) },
      resolveRepoPath: () => Effect.succeed("/repo"),
    });

    expect(await Effect.runPromise(service.startupSweep())).toBe(2);
    expect(restored).toEqual([]);
    expect(purged).toEqual([updateQuarantine.id, deleteQuarantine.id]);
  });

  test("removes a partially promoted create and its uncommitted task", async () => {
    const createQuarantine: TaskAssetQuarantine = {
      id: "550e8400-e29b-41d4-a716-446655440004",
      workspaceId: "fairnest",
      taskId: "task-3",
      operation: "create",
      assetIds: [],
      promotedAssetIds: ["550e8400-e29b-41d4-a716-446655440005"],
    };
    const deleted: string[] = [];
    const removed: string[][] = [];
    const purged: string[] = [];
    const service = createTaskAssetRecoveryService({
      filePort: {
        durableExists: () => Effect.succeed(true),
        listQuarantines: () => Effect.succeed([createQuarantine]),
        removeDurable: (input) => Effect.sync(() => removed.push(input.assetIds)),
        restoreQuarantine: () => Effect.die("Create recovery must not restore a quarantine."),
        purgeQuarantine: (id) => Effect.sync(() => purged.push(id)),
      },
      registry: {
        listAssets: () => Effect.succeed([]),
        taskExists: () => Effect.succeed(true),
      },
      taskStore: {
        deleteTask: (input) => Effect.sync(() => deleted.push(input.taskId)).pipe(Effect.as(true)),
      },
      resolveRepoPath: () => Effect.succeed("/repo"),
    });

    expect(await Effect.runPromise(service.startupSweep())).toBe(1);
    expect(deleted).toEqual([createQuarantine.taskId]);
    expect(removed).toEqual([createQuarantine.promotedAssetIds]);
    expect(purged).toEqual([createQuarantine.id]);
  });

  test("removes promoted files after an interrupted create transaction rolls back", async () => {
    const createQuarantine: TaskAssetQuarantine = {
      id: "550e8400-e29b-41d4-a716-446655440006",
      workspaceId: "fairnest",
      taskId: "task-4",
      operation: "create",
      assetIds: [],
      promotedAssetIds: ["550e8400-e29b-41d4-a716-446655440007"],
    };
    const deleted: string[] = [];
    const removed: string[][] = [];
    const purged: string[] = [];
    const service = createTaskAssetRecoveryService({
      filePort: {
        durableExists: () => Effect.succeed(true),
        listQuarantines: () => Effect.succeed([createQuarantine]),
        removeDurable: (input) => Effect.sync(() => removed.push(input.assetIds)),
        restoreQuarantine: () => Effect.die("Create recovery must not restore a quarantine."),
        purgeQuarantine: (id) => Effect.sync(() => purged.push(id)),
      },
      registry: {
        listAssets: () => Effect.succeed([]),
        taskExists: () => Effect.succeed(false),
      },
      taskStore: {
        deleteTask: (input) => Effect.sync(() => deleted.push(input.taskId)).pipe(Effect.as(true)),
      },
      resolveRepoPath: () => Effect.succeed("/repo"),
    });

    expect(await Effect.runPromise(service.startupSweep())).toBe(1);
    expect(deleted).toEqual([]);
    expect(removed).toEqual([createQuarantine.promotedAssetIds]);
    expect(purged).toEqual([createQuarantine.id]);
  });

  test("purges an interrupted create manifest after its transaction commits", async () => {
    const createQuarantine: TaskAssetQuarantine = {
      id: "550e8400-e29b-41d4-a716-446655440008",
      workspaceId: "fairnest",
      taskId: "task-5",
      operation: "create",
      assetIds: [],
      promotedAssetIds: ["550e8400-e29b-41d4-a716-446655440009"],
    };
    const purged: string[] = [];
    const service = createTaskAssetRecoveryService({
      filePort: {
        durableExists: () => Effect.die("Committed create recovery must not inspect files."),
        listQuarantines: () => Effect.succeed([createQuarantine]),
        removeDurable: () => Effect.die("Committed create recovery must not remove files."),
        restoreQuarantine: () => Effect.die("Committed create recovery must not restore files."),
        purgeQuarantine: (id) => Effect.sync(() => purged.push(id)),
      },
      registry: {
        listAssets: () =>
          Effect.succeed(
            createQuarantine.promotedAssetIds.map((id) => ({
              id,
              taskId: createQuarantine.taskId,
              scope: "description" as const,
              originalName: `${id}.png`,
              mediaType: "image/png",
              byteSize: 1,
              createdAt: new Date(0),
            })),
          ),
        taskExists: () => Effect.die("Committed create recovery must not inspect the task row."),
      },
      taskStore: {
        deleteTask: () => Effect.die("Committed create recovery must not delete the task."),
      },
      resolveRepoPath: () => Effect.succeed("/repo"),
    });

    expect(await Effect.runPromise(service.startupSweep())).toBe(1);
    expect(purged).toEqual([createQuarantine.id]);
  });
});
