import { beforeAll, afterAll } from "bun:test";
import { installLocalOnlyProviderSetup } from "@/test-utils/workspace-provider-setup-fixture";
let releaseProviderFixture: (() => void) | undefined;
beforeAll(() => {
  releaseProviderFixture = installLocalOnlyProviderSetup();
});
afterAll(() => releaseProviderFixture?.());
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
  test("prepares destination reads after workspace creation completes", async () => {
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
    const addWorkspace = mock(async () => {
      throw new Error("Not used");
    });
    const onComplete = mock(() => {});
    const queryClient = createQueryClient();
    queryClient.setQueryData(repoTaskDataQueryOptions("/repos/project").queryKey, { tasks: [] });
    queryClient.setQueryData(platformQueryOptions().queryKey, "darwin");
    const workspaceState = {
      isSwitchingWorkspace: false,
      closedWorkspaces: [],
      incompleteRemovals: [],
      closeWorkspace: async () => {},
      removeWorkspace: async () => {},
      reopenWorkspace: async () => {},
      resolveWorkspacePath: async () => ({ kind: "new" }),
      isLoadingBranches: false,
      isSwitchingBranch: false,
      branchSyncDegraded: false,
      workspaces: [],
      activeWorkspace: null,
      branches: [],
      activeBranch: null,
      addWorkspace,
      commitWorkspaceProviderSetup: async () => {
        throw new Error("Not used");
      },
      selectWorkspace: async () => {},
      reorderWorkspaces: async () => {},
      refreshBranches: async () => {},
      switchBranch: async () => {},
      loadRepoSettings: async () => {
        throw new Error("Not used");
      },
      saveRepoSettings: async () => {},
      saveWorkspaceModelDefaults: async () => {},
      loadSettingsSnapshot: async () => settingsSnapshot,
      detectGithubRepository: async () => null,
      saveGlobalGitConfig: async () => {},
      saveSettingsSnapshot: async () => {},
      saveAgentModelFavorites: async () => settingsSnapshot,
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
      await harness.run((completion) => completion.completeWorkspace("/repos/project"));

      expect(addWorkspace).not.toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });
});
