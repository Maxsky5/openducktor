import { expect, test } from "bun:test";
import type { RepoConfig } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useState } from "react";
import { createQueryClient } from "@/lib/query-client";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
import { RepositoryConfigurationSection } from "./settings-repository-configuration-section";

enableReactActEnvironment();

const baseRepoConfig: RepoConfig = {
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
};

test("RepositoryConfigurationSection applies the confirmed worktree base path", async () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(filesystemQueryKeys.directory(), {
    currentPath: "/tmp/worktrees",
    parentPath: "/tmp",
    homePath: "/tmp/worktrees",
    entries: [],
  });

  const Wrapper = () => {
    const [selectedRepoConfig, setSelectedRepoConfig] = useState(baseRepoConfig);

    return (
      <QueryClientProvider client={queryClient}>
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
      </QueryClientProvider>
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
