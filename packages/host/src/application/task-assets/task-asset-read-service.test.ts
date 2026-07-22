import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createTaskAssetReadService } from "./task-asset-read-service";

const context = {
  workspaceId: "9f66372b-e956-47f4-af2f-77e0df2ad4e1",
  taskId: "task-1",
  scope: "description" as const,
  assetId: "550e8400-e29b-41d4-a716-446655440000",
};

describe("task asset read service", () => {
  test("authorizes the exact registry relation and returns safe response headers", async () => {
    let registryInput: unknown;
    const service = createTaskAssetReadService({
      resolveRepoPath: () => Effect.succeed("/repo"),
      registry: {
        getAsset: (input) => {
          registryInput = input;
          return Effect.succeed({
            id: context.assetId,
            taskId: context.taskId,
            scope: "description",
            originalName: '"diagram".png',
            mediaType: "image/png",
            byteSize: 3,
            createdAt: new Date(0),
          });
        },
      },
      filePort: {
        readDurable: () => Effect.succeed(new Uint8Array([1, 2, 3])),
      },
    });

    const result = await Effect.runPromise(service.read(context));

    expect(registryInput).toEqual({
      repoPath: "/repo",
      taskId: context.taskId,
      scope: "description",
      assetId: context.assetId,
    });
    expect(result?.mediaType).toBe("image/png");
    expect(result?.headers).toMatchObject({
      "Cache-Control": "private, no-store",
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
    });
    expect(result?.headers["Content-Disposition"]).not.toContain('filename=""diagram');
  });

  test("returns not found for foreign or missing registry relations without reading disk", async () => {
    let readDisk = false;
    const service = createTaskAssetReadService({
      resolveRepoPath: () => Effect.succeed("/repo"),
      registry: { getAsset: () => Effect.succeed(null) },
      filePort: {
        readDurable: () => {
          readDisk = true;
          return Effect.succeed(null);
        },
      },
    });

    expect(await Effect.runPromise(service.read(context))).toBeNull();
    expect(readDisk).toBe(false);
  });
});
