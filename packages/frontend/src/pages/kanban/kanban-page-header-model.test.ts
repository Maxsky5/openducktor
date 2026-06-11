import { describe, expect, test } from "bun:test";
import { createTaskStoreCheckFixture } from "@/test-utils/shared-test-fixtures";
import { isKanbanTaskCreationDisabled } from "./kanban-page-header-model";

describe("isKanbanTaskCreationDisabled", () => {
  test("disables task creation when no repository is active", () => {
    expect(isKanbanTaskCreationDisabled(null, null)).toBe(true);
  });

  test("disables task creation when the task store is unavailable", () => {
    expect(
      isKanbanTaskCreationDisabled(
        {
          workspaceId: "workspace-repo",
          workspaceName: "Repo",
          repoPath: "/repo",
        },
        createTaskStoreCheckFixture(
          {},
          {
            taskStoreOk: false,
            taskStorePath: null,
            taskStoreError: "task store unavailable",
            repoStoreHealth: {
              category: "database_unavailable",
              status: "blocking",
              isReady: false,
              detail: "task store unavailable",
            },
          },
        ),
      ),
    ).toBe(true);
  });

  test("enables task creation when the task store is ready", () => {
    expect(
      isKanbanTaskCreationDisabled(
        {
          workspaceId: "workspace-repo",
          workspaceName: "Repo",
          repoPath: "/repo",
        },
        createTaskStoreCheckFixture(
          {},
          {
            taskStorePath: "/tmp/task-store/database.sqlite",
            repoStoreHealth: {
              databasePath: "/tmp/task-store/database.sqlite",
            },
          },
        ),
      ),
    ).toBe(false);
  });
});
