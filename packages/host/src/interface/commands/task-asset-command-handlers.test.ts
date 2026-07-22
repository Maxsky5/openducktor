import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { TaskAssetStagingService } from "../../application/task-assets/task-asset-staging-service";
import { createTaskAssetCommandHandlers } from "./task-asset-command-handlers";

const assetId = "550e8400-e29b-41d4-a716-446655440000";
const workspaceId = "9f66372b-e956-47f4-af2f-77e0df2ad4e1";

describe("task asset command handlers", () => {
  test("validates and forwards stage and discard inputs", async () => {
    const inputs: unknown[] = [];
    const service: TaskAssetStagingService = {
      stage: (input) => {
        inputs.push(input);
        return Effect.succeed({
          assetId,
          scope: "description",
          originalName: input.originalName,
          verifiedMediaType: input.declaredMediaType,
          byteSize: 3,
        });
      },
      discard: (input) => {
        inputs.push(input);
        return Effect.void;
      },
      getStagedAssets: () => Effect.succeed([]),
      startupSweep: () => Effect.succeed(0),
    };
    const handlers = createTaskAssetCommandHandlers(service);

    await Effect.runPromise(
      handlers.task_asset_stage?.(
        {
          workspaceId,
          scope: "description",
          originalName: "diagram.png",
          declaredMediaType: "image/png",
          bytesBase64: "YWJj",
        },
        { command: "task_asset_stage", args: undefined },
      ) ?? Effect.die("missing stage handler"),
    );
    await Effect.runPromise(
      handlers.task_asset_discard_staged?.(
        { workspaceId, assetIds: [assetId] },
        { command: "task_asset_discard_staged", args: undefined },
      ) ?? Effect.die("missing discard handler"),
    );

    expect(inputs).toEqual([
      {
        workspaceId,
        scope: "description",
        originalName: "diagram.png",
        declaredMediaType: "image/png",
        bytesBase64: "YWJj",
      },
      { workspaceId, assetIds: [assetId] },
    ]);
  });

  test("rejects malformed input before calling the service", () => {
    const service = {
      stage: () => Effect.die("must not run"),
      discard: () => Effect.die("must not run"),
      getStagedAssets: () => Effect.succeed([]),
      startupSweep: () => Effect.succeed(0),
    } as TaskAssetStagingService;
    const handler = createTaskAssetCommandHandlers(service).task_asset_stage;

    expect(() =>
      handler?.(
        { workspaceId, scope: "description" },
        { command: "task_asset_stage", args: undefined },
      ),
    ).toThrow("task_asset_stage input is invalid");
  });
});
