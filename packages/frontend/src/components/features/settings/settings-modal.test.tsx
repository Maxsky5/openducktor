import { expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, knownRuntimeKindValues } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { useState, type PropsWithChildren, type ReactElement } from "react";
import { createQueryClient } from "@/lib/query-client";
import { IssueImportDialog } from "@/pages/kanban/issue-import-dialog";
import {
  ChecksStateContext,
  HostRuntimeStatusContext,
  RuntimeDefinitionsContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import { runtimeExecutableQueryOptions } from "@/state/queries/runtime";
import { repoBranchesQueryOptions } from "@/state/queries/git";
import {
  createChecksStateFixture,
  createGitProviderContextFixture,
  createHostRuntimeStatusContextValue,
  createSettingsSnapshotFixture,
  createRepoSettingsConfigFixture,
} from "@/test-utils/shared-test-fixtures";
import { SettingsModal, SettingsModalProvider } from "./settings-modal";
import { savedSettingsResult } from "@/test-utils/settings-save-fixtures";

for (const shared of [true, false]) {
  // Two full dialog opens and prompt editor loads exceed the CI unit-test budget.
  test(`${shared ? "shared" : "local"} settings keeps the prompt tab after cancel`, async () => {
    const settings = renderSettings(shared);
    try {
      let content = await settings.open();
      fireEvent.click(content.getByRole("button", { name: "System Prompts" }));
      fireEvent.click(content.getByRole("tab", { name: "Builder" }));
      expect(content.getByRole("tab", { name: "Builder" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      await settings.close(content);
      expect(settings.saveSettingsSnapshot).not.toHaveBeenCalled();
      content = await settings.open(shared ? "Other settings" : "Open settings");
      expect(content.getByRole("tab", { name: "Builder" }).getAttribute("aria-selected")).toBe(
        "true",
      );
    } finally {
      settings.unmount();
    }
  }, 2000);

  // Two full dialog opens and a save with its runtime preview exceed the CI unit-test budget.
  test(`${shared ? "shared" : "local"} settings keeps navigation after saving edits`, async () => {
    const settings = renderSettings(shared);
    try {
      let content = await settings.open();
      fireEvent.click(content.getByRole("button", { name: "System Prompts" }));
      fireEvent.click(content.getByRole("tab", { name: "Builder" }));
      fireEvent.click(content.getByRole("button", { name: "Chat" }));
      const thinkingMessages = content.getByRole("switch", {
        name: "Show thinking messages in session transcripts",
      });
      expect(thinkingMessages.getAttribute("aria-checked")).toBe("false");
      fireEvent.click(thinkingMessages);
      await settings.close(content, true);
      expect(settings.saveSettingsSnapshot).toHaveBeenCalledTimes(1);
      expect(settings.saveSettingsSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ chat: expect.objectContaining({ showThinkingMessages: true }) }),
        undefined,
      );
      content = await settings.open();
      expect(content.getByRole("heading", { name: "Chat Settings" })).toBeDefined();
      fireEvent.click(content.getByRole("button", { name: "System Prompts" }));
      expect(content.getByRole("tab", { name: "Builder" }).getAttribute("aria-selected")).toBe(
        "true",
      );
    } finally {
      settings.unmount();
    }
  }, 2000);
}

test("shared settings remembers the section opened by a deep link", async () => {
  const settings = renderSettings(true);
  try {
    let content = await settings.open("Open roles");
    expect(content.getByText("Custom agent roles")).toBeDefined();
    await settings.close(content);
    content = await settings.open();
    expect(content.getByText("Custom agent roles")).toBeDefined();
  } finally {
    settings.unmount();
  }
});

test("shared settings remembers the repository subsection and prompt tab", async () => {
  const settings = renderSettings(true);
  try {
    let content = await settings.open("Open scripts");
    expect(content.getByLabelText("Worktree cleanup script (one command per line)")).toBeDefined();
    fireEvent.click(content.getByRole("button", { name: "Repo Prompts" }));
    fireEvent.click(content.getByRole("tab", { name: "QA" }));
    await settings.close(content);
    content = await settings.open();
    expect(content.getByRole("tab", { name: "QA" }).getAttribute("aria-selected")).toBe("true");
  } finally {
    settings.unmount();
  }
});

test("shared settings clears the repository target after closing", async () => {
  const settings = renderSettings(true);
  try {
    let content = await settings.open("Open missing scripts");
    expect(content.getByRole("alert").textContent).toContain("/missing");
    await settings.close(content);
    content = await settings.open();
    expect(content.queryByRole("alert")).toBeNull();
    expect(content.getByLabelText("Worktree cleanup script (one command per line)")).toBeDefined();
  } finally {
    settings.unmount();
  }
});

for (const section of ["Chat", "Scripts"]) {
  test(`issue import opens repository configuration after ${section}`, async () => {
    const settings = renderSettings(true);
    try {
      let content = await settings.open();
      if (section === "Scripts") {
        fireEvent.click(content.getByRole("button", { name: "Repositories" }));
      }
      fireEvent.click(content.getByRole("button", { name: section }));
      await settings.close(content);
      fireEvent.click(within(document.body).getByRole("button", { name: "Import issues" }));
      content = await settings.open("Open repository settings");
      expect(content.getByLabelText<HTMLInputElement>("Repository path").value).toBe("/repo");
    } finally {
      settings.unmount();
    }
  });
}

function renderSettings(shared: boolean) {
  const snapshot = createSettingsSnapshotFixture({
    workspaces: {
      other: createRepoSettingsConfigFixture("other", "/other"),
      repo: createRepoSettingsConfigFixture("repo", "/repo"),
    },
  });
  const saveSettingsSnapshot = mock(async () => savedSettingsResult());
  const queryClient = createQueryClient();
  for (const workspace of Object.values(snapshot.workspaces)) {
    queryClient.setQueryData(repoBranchesQueryOptions(workspace.repoPath).queryKey, []);
  }
  for (const kind of knownRuntimeKindValues) {
    const path = snapshot.agentRuntimes[kind].executablePath;
    queryClient.setQueryData(runtimeExecutableQueryOptions(kind, path).queryKey, {
      kind,
      path,
      ok: true,
      version: "1.0.0",
      error: null,
    });
  }
  const workspaceState = {
    activeWorkspace: null,
    workspaces: Object.values(snapshot.workspaces).map((workspace) => ({
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      abbreviation: workspace.abbreviation ?? null,
      tileColor: workspace.tileColor ?? null,
      repoPath: workspace.repoPath,
      isActive: workspace.workspaceId === "repo",
      hasConfig: true,
      configuredWorktreeBasePath: null,
      defaultWorktreeBasePath: "/tmp/worktrees",
      effectiveWorktreeBasePath: "/tmp/worktrees",
    })),
    branches: [],
    activeBranch: null,
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
    commitWorkspaceProviderSetup: async () => {
      throw new Error("Not used");
    },
    addWorkspace: async () => {
      throw new Error("Not used in this test");
    },
    saveWorkspaceModelDefaults: async () => {},
    selectWorkspace: async () => {},
    reorderWorkspaces: async () => {},
    refreshBranches: async () => {},
    switchBranch: async () => {},
    loadRepoSettings: async () => {
      throw new Error("Not used in this test");
    },
    saveRepoSettings: async () => {},
    loadSettingsSnapshot: async () => structuredClone(snapshot),
    detectGithubRepository: async () => null,
    saveGlobalGitConfig: async () => {},
    previewSettingsSnapshotRuntime: async () => ({ impact: null }),
    saveSettingsSnapshot,
    saveAgentModelFavorites: async () => structuredClone(snapshot),
  } satisfies React.ComponentProps<typeof WorkspaceStateContext.Provider>["value"];
  const checksState = createChecksStateFixture();
  const runtimeState = {
    runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    agentRuntimes: snapshot.agentRuntimes,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    isLoadingRuntimeSettings: false,
    runtimeSettingsError: null,
    hasRuntimeSettingsSnapshot: true,
    refreshRuntimeSettings: async () => {},
    refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
    loadRepoRuntimeCatalog: async () => {
      throw new Error("Not used in this test");
    },
    loadRepoRuntimeFileSearch: async () => [],
  } satisfies React.ComponentProps<typeof RuntimeDefinitionsContext.Provider>["value"];
  const triggers = (
    <>
      <SettingsModal triggerLabel="Open settings" />
      {shared ? <SettingsModal triggerLabel="Other settings" /> : null}
      {shared ? <ImportTrigger /> : null}
      <SettingsModal triggerLabel="Open roles" deepLink={{ kind: "custom-agent-roles" }} />
      <SettingsModal
        triggerLabel="Open scripts"
        deepLink={{ kind: "repository-actions", repositoryPath: "/repo" }}
      />
      <SettingsModal
        triggerLabel="Open missing scripts"
        deepLink={{ kind: "repository-actions", repositoryPath: "/missing" }}
      />
    </>
  );
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <WorkspaceStateContext.Provider value={workspaceState}>
          <ChecksStateContext.Provider value={checksState}>
            <RuntimeDefinitionsContext.Provider value={runtimeState}>
              <HostRuntimeStatusContext.Provider value={createHostRuntimeStatusContextValue()}>
                {children}
              </HostRuntimeStatusContext.Provider>
            </RuntimeDefinitionsContext.Provider>
          </ChecksStateContext.Provider>
        </WorkspaceStateContext.Provider>
      </QueryClientProvider>
    );
  }
  const view = render(
    shared ? <SettingsModalProvider>{triggers}</SettingsModalProvider> : triggers,
    { wrapper: Wrapper },
  );
  const open = async (label = "Open settings") => {
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: label }));
    });
    return await waitFor(
      () => {
        const content = within(within(document.body).getByRole("dialog"));
        expect(content.getByRole("button", { name: "Repositories" }).hasAttribute("disabled")).toBe(
          false,
        );
        return content;
      },
      { timeout: 500 },
    );
  };
  const close = async (content: Awaited<ReturnType<typeof open>>, save = false) => {
    await act(async () => {
      fireEvent.click(content.getByRole("button", { name: save ? "Save Settings" : "Cancel" }));
    });
    await waitFor(() => expect(within(document.body).queryByRole("dialog")).toBeNull(), {
      timeout: 500,
    });
  };
  return {
    open,
    close,
    previewSettingsSnapshotRuntime: async () => ({ impact: null }),
    saveSettingsSnapshot,
    unmount: () => {
      view.unmount();
      queryClient.clear();
    },
  };
}

function ImportTrigger(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Import issues
      </button>
      <IssueImportDialog
        open={open}
        onOpenChange={setOpen}
        repoPath="/repo"
        provider={createGitProviderContextFixture({ available: false })}
        onImported={() => {}}
      />
    </>
  );
}
