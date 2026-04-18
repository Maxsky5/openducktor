import { describe, expect, test } from "bun:test";
import { createBeadsCheckFixture } from "@/test-utils/shared-test-fixtures";
import { isKanbanTaskCreationDisabled } from "./kanban-page-header-model";

describe("isKanbanTaskCreationDisabled", () => {
  test("disables task creation when no repository is active", () => {
    expect(isKanbanTaskCreationDisabled(null, null)).toBe(true);
  });

  test("disables task creation when beads is unavailable", () => {
    expect(
      isKanbanTaskCreationDisabled(
        {
          workspaceId: "workspace-repo",
          workspaceName: "Repo",
          repoPath: "/repo",
        },
        createBeadsCheckFixture(
          {},
          {
            beadsOk: false,
            beadsPath: null,
            beadsError: "beads unavailable",
            repoStoreHealth: {
              category: "shared_server_unavailable",
              status: "blocking",
              isReady: false,
              detail: "beads unavailable",
            },
          },
        ),
      ),
    ).toBe(true);
  });

  test("enables task creation when beads is ready", () => {
    expect(
      isKanbanTaskCreationDisabled(
        {
          workspaceId: "workspace-repo",
          workspaceName: "Repo",
          repoPath: "/repo",
        },
        createBeadsCheckFixture(
          {},
          {
            beadsPath: "/tmp/beads",
            repoStoreHealth: {
              attachment: {
                path: "/tmp/beads",
              },
            },
          },
        ),
      ),
    ).toBe(false);
  });
});
