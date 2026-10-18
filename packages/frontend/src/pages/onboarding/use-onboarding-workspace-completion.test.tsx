import { describe, expect, mock, test } from "bun:test";
import { DEFAULT_AGENT_RUNTIMES } from "@openducktor/contracts";
import type { PropsWithChildren } from "react";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { platformQueryOptions } from "@openducktor/frontend-core/queries/system";
import { repoTaskDataQueryOptions } from "@openducktor/frontend-core/queries/tasks";
import { createHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
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
    const connection = createTestClientConnection();
    const queryClient = connection.queryClient;
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
      previewSettingsSnapshotRuntime: async () => ({ impact: null }),
      saveSettingsSnapshot: async () => ({
        type: "saved" as const,
        workspaces: [],
        runtimeApplications: [],
        refreshError: null,
      }),
      saveAgentModelFavorites: async () => settingsSnapshot,
    } satisfies WorkspaceStateContextValue;
    const wrapper = ({ children }: PropsWithChildren): React.ReactElement => (
      <ClientConnectionProvider connection={connection}>
        <WorkspaceStateContext value={workspaceState}>{children}</WorkspaceStateContext>
      </ClientConnectionProvider>
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
