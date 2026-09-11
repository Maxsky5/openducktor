import { describe, expect, test } from "bun:test";
import type { WorkspaceCatalog } from "@openducktor/contracts";
import { Effect } from "effect";
import type { WorkspaceLifecycleService } from "../../application/workspaces/workspace-lifecycle-service";
import { createWorkspaceSettingsServiceTestDouble } from "../../test-support/service-test-doubles";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";
import { createWorkspaceLifecycleCommandHandlers } from "./workspace-lifecycle-command-handlers";

const catalog: WorkspaceCatalog = {
  openWorkspaces: [],
  closedWorkspaces: [],
  onboardingCompleted: true,
};

const createRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

describe("createWorkspaceLifecycleCommandHandlers", () => {
  test("routes catalog and resolve-path reads through the settings service", async () => {
    const resolvedPaths: string[] = [];
    const settingsService = createWorkspaceSettingsServiceTestDouble({
      getWorkspaceCatalog: () => Effect.succeed(catalog),
      resolveWorkspacePath: (repoPath) => {
        resolvedPaths.push(repoPath);
        return Effect.succeed({ kind: "new" });
      },
    });
    const lifecycleService: Pick<WorkspaceLifecycleService, "closeWorkspace" | "removeWorkspace"> =
      {
        closeWorkspace: () => Effect.succeed(catalog),
        removeWorkspace: () => Effect.succeed({ catalog, result: { removedWorktrees: [] } }),
      };
    const router = createRouter({
      handlers: createWorkspaceLifecycleCommandHandlers(settingsService, lifecycleService),
    });

    await expect(router.invoke("workspace_catalog_get")).resolves.toEqual(catalog);
    await expect(router.invoke("workspace_resolve_path", { repoPath: "/repo" })).resolves.toEqual({
      kind: "new",
    });
    expect(resolvedPaths).toEqual(["/repo"]);
  });

  test("routes close and reopen with the expected repository target", async () => {
    const closeInputs: Array<{ workspaceId: string; expectedRepoPath: string }> = [];
    const reopenInputs: Array<{ workspaceId: string; expectedRepoPath: string }> = [];
    const settingsService = createWorkspaceSettingsServiceTestDouble({
      reopenWorkspace: (workspaceId, expectedRepoPath) => {
        reopenInputs.push({ workspaceId, expectedRepoPath });
        return Effect.succeed(catalog);
      },
    });
    const lifecycleService: Pick<WorkspaceLifecycleService, "closeWorkspace" | "removeWorkspace"> =
      {
        closeWorkspace: (input) => {
          closeInputs.push(input);
          return Effect.succeed(catalog);
        },
        removeWorkspace: () => Effect.succeed({ catalog, result: { removedWorktrees: [] } }),
      };
    const router = createRouter({
      handlers: createWorkspaceLifecycleCommandHandlers(settingsService, lifecycleService),
    });

    await expect(
      router.invoke("workspace_close", {
        workspaceId: "repo",
        expectedRepoPath: "/repo",
      }),
    ).resolves.toEqual(catalog);
    await expect(
      router.invoke("workspace_reopen", {
        workspaceId: "repo",
        expectedRepoPath: "/repo",
      }),
    ).resolves.toEqual(catalog);
    expect(closeInputs).toEqual([{ workspaceId: "repo", expectedRepoPath: "/repo" }]);
    expect(reopenInputs).toEqual([{ workspaceId: "repo", expectedRepoPath: "/repo" }]);
  });

  test("routes remove and maps the removal result", async () => {
    const removeInputs: Array<{
      workspaceId: string;
      expectedRepoPath: string;
      removeTaskWorktrees: boolean;
    }> = [];
    const settingsService = createWorkspaceSettingsServiceTestDouble({});
    const lifecycleService: Pick<WorkspaceLifecycleService, "closeWorkspace" | "removeWorkspace"> =
      {
        closeWorkspace: () => Effect.succeed(catalog),
        removeWorkspace: (input) => {
          removeInputs.push(input);
          return Effect.succeed({ catalog, result: { removedWorktrees: ["/worktrees/task-1"] } });
        },
      };
    const router = createRouter({
      handlers: createWorkspaceLifecycleCommandHandlers(settingsService, lifecycleService),
    });

    await expect(
      router.invoke("workspace_remove", {
        workspaceId: "repo",
        expectedRepoPath: "/repo",
        removeTaskWorktrees: true,
      }),
    ).resolves.toEqual({ catalog, removedWorktrees: ["/worktrees/task-1"] });
    expect(removeInputs).toEqual([
      { workspaceId: "repo", expectedRepoPath: "/repo", removeTaskWorktrees: true },
    ]);

    await expect(
      router.invoke("workspace_remove", {
        workspaceId: "repo",
        expectedRepoPath: "/repo",
        removeTaskWorktrees: "yes",
      }),
    ).rejects.toThrow("workspace_remove input is invalid");
  });
});
