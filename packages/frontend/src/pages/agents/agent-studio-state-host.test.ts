import { describe, expect, mock, test } from "bun:test";
import type { RepoConfig } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { workspaceQueryKeys } from "@/state/queries/workspace";
import { createDeferred, createTaskCardFixture } from "./agent-studio-test-utils";
import { addTaskToWorkspaceAgentStudioState } from "./agent-studio-state-host";

const createRepoConfig = (): RepoConfig => ({
  workspaceId: "repo-a",
  workspaceName: "Repo A",
  repoPath: "/repo-a",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  agentStudioState: {
    openTaskIds: ["task-1"],
    activeTask: {
      taskId: "task-1",
      role: "build",
      externalSessionId: "session-1",
    },
  },
});

describe("addTaskToWorkspaceAgentStudioState", () => {
  test("asks the host to open the task and publishes the saved state", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const repoConfig = createRepoConfig();
    const updatedRepoConfig = {
      ...repoConfig,
      agentStudioState: { ...repoConfig.agentStudioState, openTaskIds: ["task-1", "task-2"] },
    };
    const workspaceApplyAgentStudioStateAction = mock(async () => updatedRepoConfig);
    const hostClient = {
      workspaceApplyAgentStudioStateAction,
    };

    await addTaskToWorkspaceAgentStudioState({
      queryClient,
      workspaceId: "repo-a",
      taskId: "task-2",
      tasks: [createTaskCardFixture({ id: "task-1" }), createTaskCardFixture({ id: "task-2" })],
      hostClient,
    });

    expect(workspaceApplyAgentStudioStateAction).toHaveBeenCalledWith("repo-a", {
      type: "ensure_tab",
      taskId: "task-2",
    });
    expect(queryClient.getQueryData<RepoConfig>(workspaceQueryKeys.repoConfig("repo-a"))).toEqual(
      updatedRepoConfig,
    );
  });

  test("keeps a saved tab when an older repo-config read finishes later", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const repoConfig = createRepoConfig();
    const updatedRepoConfig = {
      ...repoConfig,
      agentStudioState: { ...repoConfig.agentStudioState, openTaskIds: ["task-1", "task-2"] },
    };
    const oldRead = createDeferred<RepoConfig>();
    const read = queryClient
      .fetchQuery({
        queryKey: workspaceQueryKeys.repoConfig("repo-a"),
        queryFn: () => oldRead.promise,
      })
      .catch(() => undefined);

    await addTaskToWorkspaceAgentStudioState({
      queryClient,
      workspaceId: "repo-a",
      taskId: "task-2",
      tasks: [createTaskCardFixture({ id: "task-2" })],
      hostClient: { workspaceApplyAgentStudioStateAction: async () => updatedRepoConfig },
    });
    oldRead.resolve(repoConfig);
    await read;

    expect(queryClient.getQueryData<RepoConfig>(workspaceQueryKeys.repoConfig("repo-a"))).toEqual(
      updatedRepoConfig,
    );
  });

  test("checks a duplicate task with the host and skips missing or closed tasks", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const repoConfig = createRepoConfig();
    const workspaceApplyAgentStudioStateAction = mock(async () => repoConfig);
    const hostClient = {
      workspaceApplyAgentStudioStateAction,
    };
    const tasks = [
      createTaskCardFixture({ id: "task-1" }),
      createTaskCardFixture({ id: "closed", status: "closed" }),
    ];

    for (const taskId of ["task-1", "missing", "closed"]) {
      await addTaskToWorkspaceAgentStudioState({
        queryClient,
        workspaceId: "repo-a",
        taskId,
        tasks,
        hostClient,
      });
    }

    expect(workspaceApplyAgentStudioStateAction).toHaveBeenCalledTimes(1);
    expect(workspaceApplyAgentStudioStateAction).toHaveBeenCalledWith("repo-a", {
      type: "ensure_tab",
      taskId: "task-1",
    });
  });
});
