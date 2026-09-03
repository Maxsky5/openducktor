import { describe, expect, mock, test } from "bun:test";
import type { RepoConfig } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { workspaceQueryKeys } from "@/state/queries/workspace";
import { createTaskCardFixture } from "./agent-studio-test-utils";
import { addTaskToWorkspaceAgentStudioState } from "./agent-studio-state-host";

const createRepoConfig = (): RepoConfig => ({
  workspaceId: "repo-a",
  workspaceName: "Repo A",
  repoPath: "/repo-a",
  defaultRuntimeKind: "opencode",
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
  test("loads the latest host snapshot and replaces it with the added task", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const repoConfig = createRepoConfig();
    const workspaceReplaceAgentStudioState = mock(
      async (_workspaceId: string, state: RepoConfig["agentStudioState"]): Promise<RepoConfig> => ({
        ...repoConfig,
        agentStudioState: state,
      }),
    );
    const hostClient = {
      workspaceGetRepoConfig: mock(async () => repoConfig),
      workspaceReplaceAgentStudioState,
    };

    await addTaskToWorkspaceAgentStudioState({
      queryClient,
      workspaceId: "repo-a",
      taskId: "task-2",
      tasks: [createTaskCardFixture({ id: "task-1" }), createTaskCardFixture({ id: "task-2" })],
      hostClient,
    });

    expect(workspaceReplaceAgentStudioState).toHaveBeenCalledWith("repo-a", {
      openTaskIds: ["task-1", "task-2"],
      activeTask: {
        taskId: "task-1",
        role: "build",
        externalSessionId: "session-1",
      },
    });
    expect(queryClient.getQueryData<RepoConfig>(workspaceQueryKeys.repoConfig("repo-a"))).toEqual({
      ...repoConfig,
      agentStudioState: {
        ...repoConfig.agentStudioState,
        openTaskIds: ["task-1", "task-2"],
      },
    });
  });

  test("does not write for duplicate, missing, or closed tasks", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const repoConfig = createRepoConfig();
    const workspaceReplaceAgentStudioState = mock(async () => repoConfig);
    const hostClient = {
      workspaceGetRepoConfig: mock(async () => repoConfig),
      workspaceReplaceAgentStudioState,
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

    expect(workspaceReplaceAgentStudioState).not.toHaveBeenCalled();
  });
});
