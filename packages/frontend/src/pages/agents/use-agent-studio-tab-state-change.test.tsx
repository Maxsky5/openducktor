import { expect, mock, test } from "bun:test";
import type { RepoConfig, WorkspaceAgentStudioStateAction } from "@openducktor/contracts";
import { createQueryClient } from "@/lib/query-client";
import { workspaceQueryKeys } from "@/state/queries/workspace";
import {
  createDeferred,
  createHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioTabStateChange } from "./use-agent-studio-tab-state-change";

enableReactActEnvironment();

const createRepoConfig = (openTaskIds: string[]): RepoConfig => ({
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
  agentStudioState: { openTaskIds },
});

test("does not retry an old tab change after a newer change succeeds", async () => {
  const firstSave = createDeferred<RepoConfig>();
  const workspaceApplyAgentStudioStateAction = mock(
    async (_workspaceId: string, action: WorkspaceAgentStudioStateAction) =>
      action.type === "change_tabs" && action.openTaskIds[0] === "task-2"
        ? firstSave.promise
        : createRepoConfig(["task-3", "task-1", "task-2"]),
  );
  const queryClient = createQueryClient();
  const harness = createHookHarness(
    useAgentStudioTabStateChange,
    {
      workspaceId: "repo-a",
      hostClient: { workspaceApplyAgentStudioStateAction },
    },
    { queryClient },
  );

  await harness.mount();
  await harness.run((state) => {
    void state.onTabChange(["task-1", "task-2", "task-3"], {
      openTaskIds: ["task-2", "task-1", "task-3"],
      activeTaskId: "task-2",
    });
  });
  await harness.waitFor(() => workspaceApplyAgentStudioStateAction.mock.calls.length === 1);
  await harness.run(() => {
    firstSave.reject(new Error("The first tab change failed."));
  });
  await harness.waitFor((state) => state.saveError?.message === "The first tab change failed.");
  await harness.run((state) => {
    void state.onTabChange(["task-2", "task-1", "task-3"], {
      openTaskIds: ["task-3", "task-1", "task-2"],
      activeTaskId: "task-3",
    });
  });
  await harness.waitFor(() => workspaceApplyAgentStudioStateAction.mock.calls.length === 2);
  await harness.waitFor(
    () =>
      queryClient.getQueryData<RepoConfig>(workspaceQueryKeys.repoConfig("repo-a"))
        ?.agentStudioState.openTaskIds[0] === "task-3",
  );

  expect(harness.getLatest().saveError).toBeNull();

  await harness.run((state) => state.retry());
  expect(workspaceApplyAgentStudioStateAction).toHaveBeenCalledTimes(2);
  await harness.unmount();
});
