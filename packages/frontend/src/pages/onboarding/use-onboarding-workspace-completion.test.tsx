import { describe, expect, mock, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  DEFAULT_AGENT_RUNTIMES,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useWorkspaceCreation } from "@/components/features/repository/use-workspace-creation";
import type { WorkspaceCreationModelSurface } from "@/components/features/repository/use-workspace-creation-models";
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

  test("finishes only after a failed model save succeeds on retry", async () => {
    const settingsSnapshot = createSettingsSnapshotFixture();
    const onComplete = mock(() => {});
    const addWorkspace = mock(
      async (input: { workspaceId: string; workspaceName: string; repoPath: string }) =>
        ({
          workspaceId: input.workspaceId,
          workspaceName: input.workspaceName,
          repoPath: input.repoPath,
          abbreviation: null,
          tileColor: null,
          isActive: true,
          hasConfig: true,
          configuredWorktreeBasePath: null,
          defaultWorktreeBasePath: null,
          effectiveWorktreeBasePath: null,
        }) satisfies WorkspaceRecord,
    );
    let saveCount = 0;
    const saveWorkspaceModelDefaults = mock(async () => {
      saveCount += 1;
      if (saveCount === 1) throw new Error("Model save failed");
    });
    const catalog: AgentModelCatalog = {
      runtime: CODEX_RUNTIME_DESCRIPTOR,
      models: [
        {
          id: "openai/o3",
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "o3",
          modelName: "o3",
          variants: [],
        },
      ],
      defaultModelsByProvider: {},
    };
    const surface: WorkspaceCreationModelSurface = {
      availableRuntimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR],
      catalogResources: [
        {
          runtimeKind: "codex",
          catalog,
          isFetching: false,
          isEnabled: true,
          error: null,
          retry: async () => {},
        },
      ],
      favoriteState: {
        favorites: [],
        isLoading: false,
        readError: null,
        isMutationPending: false,
        mutationError: null,
        canMutate: false,
        toggleFavorite: () => {},
        retryRead: () => {},
        retryMutation: () => {},
      },
      isLoadingRuntimeDefinitions: false,
      isLoadingCatalog: false,
      errors: [],
      getCatalogForRuntime: () => catalog,
      isCatalogLoadingForRuntime: () => false,
      retry: async () => {},
    };
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
      resolveWorkspacePath: async () => ({ kind: "new" as const }),
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
      saveWorkspaceModelDefaults,
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
      () => {
        const completion = useOnboardingWorkspaceCompletion({ settingsSnapshot, onComplete });
        const creation = useWorkspaceCreation({
          workspaces: [],
          addWorkspace: workspaceState.addWorkspace,
          saveWorkspaceModelDefaults: workspaceState.saveWorkspaceModelDefaults,
          onSuccess: completion.completeWorkspace,
        });
        return creation;
      },
      {},
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.run((creation) => creation.confirmRepo("/repos/project"));
      await harness.run((creation) => creation.next());
      await harness.run((creation) =>
        creation.updateModelDraft((current) => ({
          ...current,
          defaultModel: {
            runtimeKind: "codex",
            providerId: "openai",
            modelId: "o3",
            variant: "",
            profileId: "",
          },
        })),
      );
      await harness.run((creation) => creation.submit(surface));

      expect(harness.getLatest().error).toBe("Model save failed");
      expect(onComplete).not.toHaveBeenCalled();
      expect(addWorkspace).toHaveBeenCalledTimes(1);

      await harness.run((creation) => creation.submit(surface));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(addWorkspace).toHaveBeenCalledTimes(1);
      expect(saveWorkspaceModelDefaults).toHaveBeenCalledTimes(2);
    } finally {
      await harness.unmount();
    }
  });
});
