import { expect, test } from "bun:test";
import type { SettingsRepoConfig } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, createElement, type ReactNode, useEffect, useState } from "react";
import { QueryProvider } from "@/test-utils/query-provider";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { filesystemQueryKeys } from "@openducktor/frontend-core/queries/filesystem";
import { RepositoryConfigurationSection } from "./settings-repository-configuration-section";
import { resolveFolderPickerInitialPath } from "./settings-repository-configuration-section-model";

enableReactActEnvironment();

const createRepoConfig = (overrides: Partial<SettingsRepoConfig> = {}): SettingsRepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  worktreeBasePath: undefined,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: {
    beforeWorktreeRemoval: [],
  },
  actions: { items: [], defaultActionId: null },
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  ...overrides,
});

function SeedFilesystemDirectory({
  path,
  currentPathIsGitRepo = false,
}: {
  path: string;
  currentPathIsGitRepo?: boolean;
}): ReactNode {
  const queryClient = useQueryClient();

  useEffect(() => {
    const listing = {
      currentPath: path,
      currentPathIsGitRepo,
      parentPath: path.slice(0, path.lastIndexOf("/")) || "/",
      homePath: path,
      entries: [],
    };

    queryClient.setQueryData(filesystemQueryKeys.directory(), listing);
    queryClient.setQueryData(filesystemQueryKeys.directory(path), listing);
  }, [currentPathIsGitRepo, path, queryClient]);

  return null;
}

test("RepositoryConfigurationSection applies the confirmed worktree base path", async () => {
  const Wrapper = () => {
    const [selectedRepoConfig, setSelectedRepoConfig] = useState(() => createRepoConfig());

    return (
      <QueryProvider>
        <SeedFilesystemDirectory path="/tmp/worktrees" />
        <RepositoryConfigurationSection
          selectedRepoConfig={selectedRepoConfig}
          selectedRepoEffectiveWorktreeBasePath={null}
          selectedRepoBranches={[]}
          selectedRepoBranchesError={null}
          loadingState={{
            isLoadingSettings: false,
            isSaving: false,
            isLoadingSelectedRepoBranches: false,
          }}
          onRetrySelectedRepoBranchesLoad={() => {}}
          onUpdateSelectedRepoConfig={(updater) => {
            setSelectedRepoConfig((current) => updater(current));
          }}
        />
      </QueryProvider>
    );
  };

  const rendered = render(createElement(Wrapper));

  try {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /pick worktree base path/i }));
    });
    const confirm = await screen.findByRole("button", { name: /use this folder/i });

    await act(async () => {
      fireEvent.click(confirm);
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("/tmp/worktrees")).toBeTruthy();
    });
  } finally {
    await act(async () => {
      rendered.unmount();
    });
  }
});

test("RepositoryConfigurationSection applies the confirmed repository rebind path", async () => {
  const Wrapper = () => {
    const [selectedRepoConfig, setSelectedRepoConfig] = useState(() => createRepoConfig());

    return (
      <QueryProvider>
        <SeedFilesystemDirectory path="/tmp/rebound-repo" currentPathIsGitRepo />
        <RepositoryConfigurationSection
          selectedRepoConfig={selectedRepoConfig}
          selectedRepoEffectiveWorktreeBasePath={null}
          selectedRepoBranches={[]}
          selectedRepoBranchesError={null}
          loadingState={{
            isLoadingSettings: false,
            isSaving: false,
            isLoadingSelectedRepoBranches: false,
          }}
          onRetrySelectedRepoBranchesLoad={() => {}}
          onUpdateSelectedRepoConfig={(updater) => {
            setSelectedRepoConfig((current) => updater(current));
          }}
        />
      </QueryProvider>
    );
  };

  const rendered = render(createElement(Wrapper));

  try {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /change folder/i }));
    });

    const loadPath = await screen.findByRole("button", { name: /load path/i });
    const manualPathInput = screen.getByLabelText("Open path");
    await act(async () => {
      fireEvent.change(manualPathInput, {
        target: { value: "/tmp/rebound-repo" },
      });
      fireEvent.click(loadPath);
    });

    await screen.findByText("Git repo");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /use this repository/i }));
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("/tmp/rebound-repo")).toBeTruthy();
    });
  } finally {
    await act(async () => {
      rendered.unmount();
    });
  }
});

test("resolveFolderPickerInitialPath falls back to the effective worktree path when the override is blank", () => {
  expect(
    resolveFolderPickerInitialPath(
      createRepoConfig({ worktreeBasePath: "   " }),
      "/effective/worktrees",
    ),
  ).toBe("/effective/worktrees");
});
