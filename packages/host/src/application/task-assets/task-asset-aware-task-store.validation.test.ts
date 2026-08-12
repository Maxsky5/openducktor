import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { taskAssetErrorToFailure } from "../../effect/task-asset-error";
import { captureTaskAssetError, createHarness } from "./test-support/task-asset-aware-task-store";

describe("asset-aware task store", () => {
  test("reports malformed description assets with create context", async () => {
    const { repoPath, store } = await createHarness();
    const error = await captureTaskAssetError(
      store.createTask({
        repoPath,
        task: {
          title: "Malformed asset",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: "![broken](odt-asset:not-a-uuid)",
        },
      }),
    );

    expect(taskAssetErrorToFailure(error)).toEqual({
      operation: "create",
      code: "validation",
      assetIds: [],
      failedPhase: "parse_description_assets",
      durableState: "unchanged",
      retryAllowed: true,
      message:
        "The description contains an invalid odt-asset image destination: odt-asset:not-a-uuid",
    });
  });

  test("reports malformed description assets with update context", async () => {
    const { repoPath, store } = await createHarness();
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: {
          title: "Update target",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: "Before",
        },
      }),
    );
    const error = await captureTaskAssetError(
      store.updateTask({
        repoPath,
        taskId: task.id,
        patch: { description: "![broken](odt-asset:not-a-uuid)" },
      }),
    );

    expect(taskAssetErrorToFailure(error)).toEqual({
      operation: "update",
      code: "validation",
      taskId: task.id,
      assetIds: [],
      failedPhase: "parse_description_assets",
      durableState: "unchanged",
      retryAllowed: true,
      message:
        "The description contains an invalid odt-asset image destination: odt-asset:not-a-uuid",
    });
  });

  test("reports the description asset limit with create context", async () => {
    const { repoPath, store } = await createHarness();
    const assetIds = Array.from(
      { length: 51 },
      (_, index) => `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    );
    const description = assetIds.map((assetId) => `![image](odt-asset:${assetId})`).join("\n");
    const error = await captureTaskAssetError(
      store.createTask({
        repoPath,
        task: {
          title: "Too many assets",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description,
        },
        descriptionAssets: { stagedAssetIds: assetIds },
      }),
    );

    expect(taskAssetErrorToFailure(error)).toEqual({
      operation: "create",
      code: "validation",
      assetIds,
      failedPhase: "parse_description_assets",
      durableState: "unchanged",
      retryAllowed: true,
      message: "A task description may reference at most 50 distinct task assets.",
    });
  });

  test("reports the description asset limit with update context", async () => {
    const { repoPath, store } = await createHarness();
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: {
          title: "Update target",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: "Before",
        },
      }),
    );
    const assetIds = Array.from(
      { length: 51 },
      (_, index) => `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    );
    const description = assetIds.map((assetId) => `![image](odt-asset:${assetId})`).join("\n");
    const error = await captureTaskAssetError(
      store.updateTask({
        repoPath,
        taskId: task.id,
        patch: { description },
        descriptionAssets: { stagedAssetIds: assetIds },
      }),
    );

    expect(taskAssetErrorToFailure(error)).toEqual({
      operation: "update",
      code: "validation",
      taskId: task.id,
      assetIds,
      failedPhase: "parse_description_assets",
      durableState: "unchanged",
      retryAllowed: true,
      message: "A task description may reference at most 50 distinct task assets.",
    });
  });

  test("reports missing staged assets with create and update context", async () => {
    const { repoPath, store } = await createHarness();
    const missingAssetId = "550e8400-e29b-41d4-a716-446655440000";
    const description = `![missing](odt-asset:${missingAssetId})`;
    const createError = await captureTaskAssetError(
      store.createTask({
        repoPath,
        task: {
          title: "Missing staged asset",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description,
        },
        descriptionAssets: { stagedAssetIds: [missingAssetId] },
      }),
    );
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: {
          title: "Update target",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: "Before",
        },
      }),
    );
    const updateError = await captureTaskAssetError(
      store.updateTask({
        repoPath,
        taskId: task.id,
        patch: { description },
        descriptionAssets: { stagedAssetIds: [missingAssetId] },
      }),
    );

    expect(taskAssetErrorToFailure(createError)).toEqual({
      operation: "create",
      code: "validation",
      assetIds: [missingAssetId],
      failedPhase: "create_task_with_assets",
      durableState: "unchanged",
      retryAllowed: true,
      message: `Task asset ${missingAssetId} is not staged.`,
    });
    expect(taskAssetErrorToFailure(updateError)).toEqual({
      operation: "update",
      code: "validation",
      taskId: task.id,
      assetIds: [missingAssetId],
      failedPhase: "update_task_with_assets",
      durableState: "unchanged",
      retryAllowed: true,
      message: `Task asset ${missingAssetId} is not staged.`,
    });
  });
});
