import { describe, expect, test } from "bun:test";
import * as contracts from "./index";

describe("contract schema defaults", () => {
  test("defaults missing chat settings to disabled thinking messages", () => {
    const parsedSnapshot = contracts.settingsSnapshotSchema.parse({
      theme: "light",
      git: {
        defaultMergeMethod: "merge_commit",
      },
      workspaces: {},
      globalPromptOverrides: {},
    });

    expect(parsedSnapshot.chat.showThinkingMessages).toBe(false);
    expect(parsedSnapshot.reusablePrompts).toEqual([]);
    expect(parsedSnapshot.kanban.doneVisibleDays).toBe(1);
    expect(parsedSnapshot.kanban.emptyColumnDisplay).toBe("show");
  });

  test("rejects settings snapshots without a theme", () => {
    expect(() =>
      contracts.settingsSnapshotSchema.parse({
        git: {
          defaultMergeMethod: "merge_commit",
        },
        workspaces: {},
        globalPromptOverrides: {},
      }),
    ).toThrow();
  });

  test("keeps odt_get_workspaces workspace-free and workspace-scoped tool inputs overrideable", () => {
    expect(contracts.GetWorkspacesInputSchema.parse({})).toEqual({});
    expect(contracts.ReadTaskInputSchema.parse({ workspaceId: "repo", taskId: "task-1" })).toEqual({
      workspaceId: "repo",
      taskId: "task-1",
    });
    expect(
      contracts.CreateTaskInputSchema.parse({
        workspaceId: "repo",
        title: "Bridge task",
        issueType: "task",
        priority: 2,
      }),
    ).toEqual({
      workspaceId: "repo",
      title: "Bridge task",
      issueType: "task",
      priority: 2,
    });
  });
});
