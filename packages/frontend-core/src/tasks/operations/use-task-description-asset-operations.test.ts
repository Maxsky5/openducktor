import { describe, expect, mock, test } from "bun:test";
import { TASK_ASSET_MAX_FILE_BYTES, type TaskAssetStageResult } from "@openducktor/contracts";
import {
  createTaskDescriptionAssetOperations,
  type TaskDescriptionImageFile,
  taskDescriptionImageError,
} from "./use-task-description-asset-operations";

const stagedAsset: TaskAssetStageResult = {
  assetId: "550e8400-e29b-41d4-a716-446655440000",
  scope: "description",
  originalName: "diagram.png",
  verifiedMediaType: "image/png",
  byteSize: 3,
};

const imageFile = (name: string, type: string, size: number): TaskDescriptionImageFile => ({
  name,
  type,
  size,
});

const readBase64 = mock(async (_file: TaskDescriptionImageFile) => "AQID");

describe("task description asset operations", () => {
  test("stages a validated image through the task asset host port", async () => {
    const taskAssetStage = mock(async () => stagedAsset);
    const operations = createTaskDescriptionAssetOperations(
      { taskAssetStage, taskAssetDiscardStaged: async () => {} },
      readBase64,
    );
    const file = imageFile("diagram.png", "image/png", 3);

    await expect(operations.stageImage("workspace-1", file)).resolves.toEqual(stagedAsset);
    expect(readBase64).toHaveBeenCalledWith(file);
    expect(taskAssetStage).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      scope: "description",
      originalName: "diagram.png",
      declaredMediaType: "image/png",
      bytesBase64: "AQID",
    });
  });

  test("names an unnamed image", async () => {
    const taskAssetStage = mock(async () => stagedAsset);
    const operations = createTaskDescriptionAssetOperations(
      { taskAssetStage, taskAssetDiscardStaged: async () => {} },
      readBase64,
    );

    await operations.stageImage("workspace-1", imageFile("", "image/jpeg", 3));
    expect(taskAssetStage).toHaveBeenCalledWith(expect.objectContaining({ originalName: "image" }));
  });

  test("discards staged assets through the task asset host port", async () => {
    const taskAssetDiscardStaged = mock(async () => {});
    const operations = createTaskDescriptionAssetOperations(
      { taskAssetStage: async () => stagedAsset, taskAssetDiscardStaged },
      readBase64,
    );

    await operations.discardStaged("workspace-1", [stagedAsset.assetId]);

    expect(taskAssetDiscardStaged).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      assetIds: [stagedAsset.assetId],
    });
  });

  test("rejects disallowed media types before reading or staging them", async () => {
    const taskAssetStage = mock(async () => stagedAsset);
    const read = mock(async (_file: TaskDescriptionImageFile) => "");
    const operations = createTaskDescriptionAssetOperations(
      { taskAssetStage, taskAssetDiscardStaged: async () => {} },
      read,
    );

    await expect(
      operations.stageImage("workspace-1", imageFile("diagram.svg", "image/svg+xml", 6)),
    ).rejects.toThrow("PNG, JPEG, WebP, or GIF");
    expect(read).not.toHaveBeenCalled();
    expect(taskAssetStage).not.toHaveBeenCalled();
  });

  test("rejects oversized images before reading or staging them", async () => {
    const taskAssetStage = mock(async () => stagedAsset);
    const read = mock(async (_file: TaskDescriptionImageFile) => "");
    const operations = createTaskDescriptionAssetOperations(
      { taskAssetStage, taskAssetDiscardStaged: async () => {} },
      read,
    );

    await expect(
      operations.stageImage(
        "workspace-1",
        imageFile("oversized.png", "image/png", TASK_ASSET_MAX_FILE_BYTES + 1),
      ),
    ).rejects.toThrow("10 MiB or smaller");
    expect(read).not.toHaveBeenCalled();
    expect(taskAssetStage).not.toHaveBeenCalled();
  });
});

describe("taskDescriptionImageError", () => {
  test("accepts PNG, JPEG, WebP, and GIF images up to the size limit", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      expect(taskDescriptionImageError({ type, size: TASK_ASSET_MAX_FILE_BYTES })).toBeNull();
    }
  });

  test("names the accepted formats for another media type", () => {
    expect(taskDescriptionImageError({ type: "image/heic", size: 10 })).toBe(
      "Task images must be PNG, JPEG, WebP, or GIF files.",
    );
  });

  test("names the size limit for a larger image", () => {
    expect(
      taskDescriptionImageError({ type: "image/png", size: TASK_ASSET_MAX_FILE_BYTES + 1 }),
    ).toBe("Task description images must be 10 MiB or smaller.");
  });
});
