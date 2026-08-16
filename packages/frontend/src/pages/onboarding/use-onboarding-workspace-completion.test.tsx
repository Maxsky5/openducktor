import { describe, expect, mock, test } from "bun:test";
import { DEFAULT_AGENT_RUNTIMES } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { createQueryClient } from "@/lib/query-client";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { platformQueryOptions } from "@/state/queries/system";
import { repoTaskDataQueryOptions } from "@/state/queries/tasks";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { useOnboardingWorkspaceCompletion } from "./use-onboarding-workspace-completion";

describe("useOnboardingWorkspaceCompletion", () => {
  test("creates the first workspace with an enabled coding agent as its default", async () => {
    const settingsSnapshot = createSettingsSnapshotFixture({
      agentRuntimes: {
        ...DEFAULT_AGENT_RUNTIMES,
        codex: {
          ...DEFAULT_AGENT_RUNTIMES.codex,
          enabled: true,
          executablePath: "/tools/codex",
        },
      },
    });
    const addWorkspace = mock(async () => {});
    const onComplete = mock(() => {});
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      repoTaskDataQueryOptions("/repos/project", settingsSnapshot.kanban.doneVisibleDays).queryKey,
      { tasks: [] },
    );
    queryClient.setQueryData(platformQueryOptions().queryKey, "darwin");
    const workspaceState = {
      isSwitchingWorkspace: false,
      isLoadingBranches: false,
      isSwitchingBranch: false,
      branchSyncDegraded: false,
      workspaces: [],
      activeWorkspace: null,
      branches: [],
      activeBranch: null,
      addWorkspace,
      selectWorkspace: async () => {},
      reorderWorkspaces: async () => {},
      refreshBranches: async () => {},
      switchBranch: async () => {},
      loadRepoSettings: async () => {
        throw new Error("Not used");
      },
      saveRepoSettings: async () => {},
      loadSettingsSnapshot: async () => settingsSnapshot,
      detectGithubRepository: async () => null,
      saveGlobalGitConfig: async () => {},
      saveSettingsSnapshot: async () => {},
    } satisfies WorkspaceStateContextValue;
    const wrapper = ({ children }: PropsWithChildren): React.ReactElement => (
      <QueryClientProvider client={queryClient}>
        <WorkspaceStateContext value={workspaceState}>{children}</WorkspaceStateContext>
      </QueryClientProvider>
    );
    const harness = createHookHarness(
      () => useOnboardingWorkspaceCompletion({ settingsSnapshot, onComplete }),
      {},
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.run((completion) =>
        completion.addFirstWorkspace({
          workspaceId: "project",
          workspaceName: "Project",
          repoPath: "/repos/project",
        }),
      );

      expect(addWorkspace).toHaveBeenCalledWith({
        workspaceId: "project",
        workspaceName: "Project",
        repoPath: "/repos/project",
        defaultRuntimeKind: "codex",
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });
});
