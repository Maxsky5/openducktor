import { expect, test } from "bun:test";
import type { RepoConfig } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode, useEffect, useState } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
import {
  RepositoryConfigurationSection,
  resolveFolderPickerInitialPath,
} from "./settings-repository-configuration-section";

enableReactActEnvironment();

const createRepoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
  worktreeBasePath: undefined,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  trustedHooks: false,
  trustedHooksFingerprint: undefined,
  hooks: {
    preStart: [],
    postComplete: [],
  },
  devServers: [],
  worktreeFileCopies: [],
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
    const [selectedRepoConfig, setSelectedRepoConfig] = useState(createRepoConfig());

    return (
      <QueryProvider useIsolatedClient>
        <SeedFilesystemDirectory path="/tmp/worktrees" />
        <RepositoryConfigurationSection
          selectedRepoConfig={selectedRepoConfig}
          selectedRepoEffectiveWorktreeBasePath={null}
          selectedRepoBranches={[]}
          selectedRepoBranchesError={null}
          isLoadingSettings={false}
          isSaving={false}
          isLoadingSelectedRepoBranches={false}
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
    fireEvent.click(screen.getByRole("button", { name: /pick worktree base path/i }));
    await screen.findByText("/tmp/worktrees");

    fireEvent.click(screen.getByRole("button", { name: /use this path/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("/tmp/worktrees")).toBeTruthy();
    });
  } finally {
    rendered.unmount();
  }
});

test("RepositoryConfigurationSection applies the confirmed repository rebind path", async () => {
  const Wrapper = () => {
    const [selectedRepoConfig, setSelectedRepoConfig] = useState(createRepoConfig());

    return (
      <QueryProvider useIsolatedClient>
        <SeedFilesystemDirectory path="/tmp/rebound-repo" currentPathIsGitRepo />
        <RepositoryConfigurationSection
          selectedRepoConfig={selectedRepoConfig}
          selectedRepoEffectiveWorktreeBasePath={null}
          selectedRepoBranches={[]}
          selectedRepoBranchesError={null}
          isLoadingSettings={false}
          isSaving={false}
          isLoadingSelectedRepoBranches={false}
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
    fireEvent.click(screen.getByRole("button", { name: /rebind/i }));

    const manualPathInput = await screen.findByLabelText("Open path");
    fireEvent.change(manualPathInput, { target: { value: "/tmp/rebound-repo" } });
    fireEvent.click(screen.getByRole("button", { name: /load path/i }));

    await screen.findByText("Git repo");

    fireEvent.click(screen.getByRole("button", { name: /use this repository/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("/tmp/rebound-repo")).toBeTruthy();
    });
  } finally {
    rendered.unmount();
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
