import { describe, expect, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  createDefaultAutopilotSettings,
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RepoConfig,
  type SettingsSnapshot,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ComponentProps, type PropsWithChildren, type ReactElement, useEffect } from "react";
import { AgentStudioDevServerSettingsAction } from "@/components/features/agents/agent-studio-dev-server-settings-action";
import { QueryProvider } from "@/lib/query-provider";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import {
  ChecksStateContext,
  RuntimeDefinitionsContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import { repoBranchesQueryOptions } from "@/state/queries/git";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { SettingsModal } from "./settings-modal";

enableReactActEnvironment();

const createRepoConfig = (
  workspaceId: string,
  workspaceName: string,
  repoPath: string,
  setupCommand: string,
): RepoConfig => ({
  workspaceId,
  workspaceName,
  repoPath,
  defaultRuntimeKind: "opencode",
  worktreeBasePath: undefined,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  hooks: { preStart: [setupCommand], postComplete: [] },
  devServers: [{ id: "frontend", name: "Frontend", command: "bun run dev" }],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
});

const createWorkspaceRecords = (): WorkspaceRecord[] => [
  {
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    isActive: true,
    hasConfig: true,
    configuredWorktreeBasePath: null,
    defaultWorktreeBasePath: "/tmp/worktrees/repo",
    effectiveWorktreeBasePath: "/tmp/worktrees/repo",
  },
  {
    workspaceId: "repo-two",
    workspaceName: "Repo Two",
    repoPath: "/repo-two",
    isActive: false,
    hasConfig: true,
    configuredWorktreeBasePath: null,
    defaultWorktreeBasePath: "/tmp/worktrees/repo-two",
    effectiveWorktreeBasePath: "/tmp/worktrees/repo-two",
  },
];

const createSettingsSnapshot = (): SettingsSnapshot =>
  createSettingsSnapshotFixture({
    autopilot: createDefaultAutopilotSettings(),
    agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    workspaces: {
      repo: createRepoConfig("repo", "Repo", "/repo", "echo repo"),
      "repo-two": createRepoConfig("repo-two", "Repo Two", "/repo-two", "echo repo-two"),
    },
  });

function SeedRepositoryBranches(): null {
  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient.setQueryData(repoBranchesQueryOptions("/repo").queryKey, []);
    queryClient.setQueryData(repoBranchesQueryOptions("/repo-two").queryKey, []);
  }, [queryClient]);

  return null;
}

const renderSettingsSurface = (surface: ReactElement) => {
  const workspaceRecords = createWorkspaceRecords();

  const workspaceState = {
    isSwitchingWorkspace: false,
    isLoadingBranches: false,
    isSwitchingBranch: false,
    branchSyncDegraded: false,
    workspaces: workspaceRecords,
    activeWorkspace: workspaceRecords[0] ?? null,
    branches: [],
    activeBranch: null,
    addWorkspace: async () => {},
    selectWorkspace: async () => {},
    reorderWorkspaces: async () => {},
    refreshBranches: async () => {},
    switchBranch: async () => {},
    loadRepoSettings: async () => {
      throw new Error("loadRepoSettings is not used in this test");
    },
    saveRepoSettings: async () => {
      throw new Error("saveRepoSettings is not used in this test");
    },
    loadSettingsSnapshot: async () => createSettingsSnapshot(),
    detectGithubRepository: async () => null,
    saveGlobalGitConfig: async () => {},
    saveSettingsSnapshot: async () => {},
  } satisfies ComponentProps<typeof WorkspaceStateContext.Provider>["value"];

  const checksState = {
    runtimeCheck: null,
    taskStoreCheck: null,
    runtimeCheckFailureKind: null,
    taskStoreCheckFailureKind: null,
    isLoadingChecks: false,
    refreshChecks: async () => {},
  } satisfies ComponentProps<typeof ChecksStateContext.Provider>["value"];

  const runtimeDefinitions = [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR];
  const runtimeDefinitionsContext = {
    runtimeDefinitions,
    availableRuntimeDefinitions: runtimeDefinitions,
    agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    refreshRuntimeDefinitions: async () => runtimeDefinitions,
    loadRepoRuntimeCatalog: async () => ({
      models: [],
      defaultModelsByProvider: {},
      profiles: [],
    }),
    loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
    loadRepoRuntimeSkills: async () => ({ skills: [] }),
    loadRepoRuntimeSubagents: async () => ({ subagents: [] }),
    loadRepoRuntimeFileSearch: async () => [],
  } satisfies ComponentProps<typeof RuntimeDefinitionsContext.Provider>["value"];

  const Wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <WorkspaceStateContext.Provider value={workspaceState}>
      <ChecksStateContext.Provider value={checksState}>
        <QueryProvider useIsolatedClient>
          <SeedRepositoryBranches />
          <RuntimeDefinitionsContext.Provider value={runtimeDefinitionsContext}>
            {children}
          </RuntimeDefinitionsContext.Provider>
        </QueryProvider>
      </ChecksStateContext.Provider>
    </WorkspaceStateContext.Provider>
  );

  return render(surface, { wrapper: Wrapper });
};

describe("SettingsModal Agent Studio target", () => {
  test("opens and reopens the exact repository Scripts editor through the real trigger", async () => {
    const rendered = renderSettingsSurface(
      <AgentStudioDevServerSettingsAction repositoryPath="/repo-two" />,
    );

    try {
      fireEvent.click(screen.getByRole("button", { name: "Configure dev server commands" }));
      expect(await screen.findByDisplayValue("echo repo-two")).toBeTruthy();
      expect(screen.queryByDisplayValue("echo repo")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      fireEvent.click(screen.getByRole("button", { name: "Configure dev server commands" }));
      expect(await screen.findByDisplayValue("echo repo-two")).toBeTruthy();
    } finally {
      rendered.unmount();
    }
  });

  test("shows the actionable unresolved state for an explicit null repository", async () => {
    const rendered = renderSettingsSurface(
      <AgentStudioDevServerSettingsAction repositoryPath={null} />,
    );

    try {
      fireEvent.click(screen.getByRole("button", { name: "Configure dev server commands" }));

      expect(
        await screen.findByText(
          "This Agent Studio panel has no repository to configure. Choose a repository explicitly or close Settings.",
        ),
      ).toBeTruthy();
      expect(screen.queryByLabelText("Worktree setup script (one command per line)")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Select repository" }));
      fireEvent.click(await screen.findByText("Repo Two"));
      expect(await screen.findByDisplayValue("echo repo-two")).toBeTruthy();
    } finally {
      rendered.unmount();
    }
  });

  test("keeps ordinary no-target Settings on the active repository Configuration section", async () => {
    const rendered = renderSettingsSurface(
      <SettingsModal triggerIconOnly triggerLabel="Configure dev server commands" />,
    );

    try {
      fireEvent.click(screen.getByRole("button", { name: "Configure dev server commands" }));

      expect(await screen.findByDisplayValue("repo")).toBeTruthy();
      expect(screen.queryByLabelText("Worktree setup script (one command per line)")).toBeNull();
    } finally {
      rendered.unmount();
    }
  });
});
