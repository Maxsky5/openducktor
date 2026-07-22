import { describe, expect, test } from "bun:test";
import {
  hostInvokeFailureSchema,
  TASK_ASSET_MAX_DESCRIPTION_ASSETS,
  TASK_ASSET_MAX_FILE_BYTES,
  taskAssetDescriptionMutationSchema,
  taskAssetIdSchema,
  taskAssetMediaTypeSchema,
  taskAssetRenderContextSchema,
  taskAssetScopeSchema,
  taskAssetStageInputSchema,
  taskAssetStageResultSchema,
} from "./index";

const assetId = "550e8400-e29b-41d4-a716-446655440000";

describe("task asset contracts", () => {
  test("locks the initial scope and upload policy", () => {
    expect(taskAssetScopeSchema.parse("description")).toBe("description");
    expect(taskAssetScopeSchema.safeParse("plan").success).toBe(false);
    expect(taskAssetMediaTypeSchema.options).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ]);
    expect(TASK_ASSET_MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
    expect(TASK_ASSET_MAX_DESCRIPTION_ASSETS).toBe(50);
  });

  test("accepts only UUID asset IDs that are safe as one path segment", () => {
    expect(taskAssetIdSchema.parse(assetId)).toBe(assetId);
    expect(taskAssetIdSchema.safeParse("../foreign").success).toBe(false);
    expect(taskAssetIdSchema.safeParse("asset/child").success).toBe(false);
  });

  test("rejects duplicate staged IDs and more than the description limit", () => {
    expect(
      taskAssetDescriptionMutationSchema.safeParse({ stagedAssetIds: [assetId, assetId] }).success,
    ).toBe(false);
    expect(
      taskAssetDescriptionMutationSchema.safeParse({
        stagedAssetIds: Array.from(
          { length: 51 },
          (_, index) => `550e8400-e29b-41d4-a716-${String(index).padStart(12, "0")}`,
        ),
      }).success,
    ).toBe(false);
  });

  test("keeps filesystem paths and runtime URLs out of staging results", () => {
    const input = taskAssetStageInputSchema.parse({
      workspaceId: "workspace-1",
      scope: "description",
      originalName: "diagram.png",
      declaredMediaType: "image/png",
      bytesBase64: "iVBORw0KGgo=",
    });
    expect(input.bytesBase64).toBe("iVBORw0KGgo=");

    const result = taskAssetStageResultSchema.parse({
      assetId,
      scope: "description",
      originalName: "diagram.png",
      verifiedMediaType: "image/png",
      byteSize: 8,
    });
    expect(result).not.toHaveProperty("path");
    expect(result).not.toHaveProperty("url");
  });

  test("validates the full ownership context used for runtime resolution", () => {
    expect(
      taskAssetRenderContextSchema.parse({
        workspaceId: "workspace-1",
        taskId: "openduckto-hlry",
        scope: "description",
        assetId,
      }),
    ).toEqual({
      workspaceId: "workspace-1",
      taskId: "openduckto-hlry",
      scope: "description",
      assetId,
    });
    expect(
      taskAssetRenderContextSchema.safeParse({
        workspaceId: "../workspace",
        taskId: "task-1",
        scope: "description",
        assetId,
      }).success,
    ).toBe(false);
  });

  test("parses structured task asset partial-state failures", () => {
    expect(
      hostInvokeFailureSchema.parse({
        kind: "task_asset",
        taskAssetFailure: {
          operation: "create",
          code: "partial_state",
          taskId: "task-1",
          assetIds: [assetId],
          failedPhase: "delete_created_task",
          durableState: "created_partial",
          retryAllowed: false,
          message: "The task was created, but cleanup failed. Refresh before continuing.",
        },
      }),
    ).toMatchObject({ kind: "task_asset" });
  });
});
