import { describe, expect, test } from "bun:test";
import { parseCreateTaskInput, parseUpdateTaskInput } from "./task-command-inputs";

const assetId = "550e8400-e29b-41d4-a716-446655440000";

describe("task description asset command inputs", () => {
  test("keeps staged intent beside durable create input", () => {
    expect(
      parseCreateTaskInput({
        repoPath: "/repo",
        input: { title: "Task", issueType: "task", description: `![x](odt-asset:${assetId})` },
        descriptionAssets: { stagedAssetIds: [assetId] },
      }),
    ).toMatchObject({
      task: { title: "Task", description: `![x](odt-asset:${assetId})` },
      descriptionAssets: { stagedAssetIds: [assetId] },
    });
  });

  test("rejects asset intent when update omits description", () => {
    expect(() =>
      parseUpdateTaskInput({
        repoPath: "/repo",
        taskId: "task-1",
        patch: { title: "Rename only" },
        descriptionAssets: { stagedAssetIds: [assetId] },
      }),
    ).toThrow("descriptionAssets requires a description patch");
  });
});
