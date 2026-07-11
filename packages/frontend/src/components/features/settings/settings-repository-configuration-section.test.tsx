import { describe, expect, mock, test } from "bun:test";
import type { GitBranch, RepoConfig } from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { RepositoryConfigurationSection } from "./settings-repository-configuration-section";

enableReactActEnvironment();

const repoConfig: RepoConfig = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
  worktreeBasePath: undefined,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  hooks: { preStart: ["bun install"], postComplete: ["bun run clean"] },
  devServers: [{ id: "frontend", name: "Frontend", command: "bun run dev" }],
  worktreeCopyPaths: [".env"],
  promptOverrides: {},
  agentDefaults: {},
};

describe("RepositoryConfigurationSection", () => {
  test("keeps repository identity and branch fields without rendering script controls", () => {
    const updaters: Array<(current: RepoConfig) => RepoConfig> = [];
    const onUpdateSelectedRepoConfig = mock((updater: (current: RepoConfig) => RepoConfig) => {
      updaters.push(updater);
    });
    const rendered = render(
      createElement(RepositoryConfigurationSection, {
        selectedRepoConfig: repoConfig,
        selectedRepoEffectiveWorktreeBasePath: "/tmp/worktrees",
        selectedRepoBranches: [] as GitBranch[],
        selectedRepoBranchesError: null,
        loadingState: {
          isLoadingSettings: false,
          isSaving: false,
          isLoadingSelectedRepoBranches: false,
        },
        onRetrySelectedRepoBranchesLoad: () => {},
        onUpdateSelectedRepoConfig,
      }),
    );

    try {
      const workspaceNameInput = screen.getByLabelText("Workspace name");
      fireEvent.change(workspaceNameInput, { target: { value: "Renamed Repo" } });

      expect(updaters[0]?.(repoConfig).workspaceName).toBe("Renamed Repo");
      expect(screen.getByLabelText("Repository path")).toBeTruthy();
      expect(screen.getByLabelText("Branch prefix")).toBeTruthy();
      expect(screen.queryByText("Worktree setup script (one command per line)")).toBeNull();
      expect(screen.queryByText("Dev servers")).toBeNull();
      expect(screen.queryByText("Files copied to worktrees (one path per line)")).toBeNull();
    } finally {
      rendered.unmount();
    }
  });
});
