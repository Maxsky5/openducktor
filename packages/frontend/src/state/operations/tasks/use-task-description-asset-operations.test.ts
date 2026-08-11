import { describe, expect, mock, test } from "bun:test";
import { TASK_ASSET_MAX_FILE_BYTES, type TaskAssetStageResult } from "@openducktor/contracts";
import { createTaskDescriptionAssetOperations } from "./use-task-description-asset-operations";

const stagedAsset: TaskAssetStageResult = {
  assetId: "550e8400-e29b-41d4-a716-446655440000",
  scope: "description",
  originalName: "diagram.png",
  verifiedMediaType: "image/png",
  byteSize: 3,
};

describe("task description asset operations", () => {
  test("stages a validated image through the task asset host port", async () => {
    const taskAssetStage = mock(async () => stagedAsset);
    const operations = createTaskDescriptionAssetOperations({
      taskAssetStage,
      taskAssetDiscardStaged: async () => {},
    });
    const file = new File([new Uint8Array([1, 2, 3])], "diagram.png", {
      type: "image/png",
    });

    await expect(operations.stageImage("workspace-1", file)).resolves.toEqual(stagedAsset);
    expect(taskAssetStage).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      scope: "description",
      originalName: "diagram.png",
      declaredMediaType: "image/png",
      bytesBase64: "AQID",
    });
  });

  test("discards staged assets through the task asset host port", async () => {
    const taskAssetDiscardStaged = mock(async () => {});
    const operations = createTaskDescriptionAssetOperations({
      taskAssetStage: async () => stagedAsset,
      taskAssetDiscardStaged,
    });

    await operations.discardStaged("workspace-1", [stagedAsset.assetId]);

    expect(taskAssetDiscardStaged).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      assetIds: [stagedAsset.assetId],
    });
  });

  test("rejects disallowed browser media types before host staging", async () => {
    const taskAssetStage = mock(async () => stagedAsset);
    const operations = createTaskDescriptionAssetOperations({
      taskAssetStage,
      taskAssetDiscardStaged: async () => {},
    });
    const file = new File(["<svg/>"], "diagram.svg", { type: "image/svg+xml" });

    await expect(operations.stageImage("workspace-1", file)).rejects.toThrow(
      "PNG, JPEG, WebP, or GIF",
    );
    expect(taskAssetStage).not.toHaveBeenCalled();
  });

  test("rejects oversized images before reading or staging them", async () => {
    const taskAssetStage = mock(async () => stagedAsset);
    const operations = createTaskDescriptionAssetOperations({
      taskAssetStage,
      taskAssetDiscardStaged: async () => {},
    });
    const file = new File([new Uint8Array(TASK_ASSET_MAX_FILE_BYTES + 1)], "oversized.png", {
      type: "image/png",
    });

    await expect(operations.stageImage("workspace-1", file)).rejects.toThrow("10 MiB or smaller");
    expect(taskAssetStage).not.toHaveBeenCalled();
  });
});
