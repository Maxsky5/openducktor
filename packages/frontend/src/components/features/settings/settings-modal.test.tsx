import { expect, mock, test } from "bun:test";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  knownRuntimeKindValues,
  type RuntimeExecutableCheck,
  type SettingsSnapshot,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { useState, type PropsWithChildren, type ReactElement } from "react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { QueryProvider } from "@/test-utils/query-provider";
import { IssueImportDialog } from "@/pages/kanban/issue-import-dialog";
import { RuntimeDefinitionsContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { ChecksStateContext, WorkspaceStateContext } from "@/state/app-state-contexts";
import { HostRuntimeStatusContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { runtimeExecutableQueryOptions } from "@openducktor/frontend-core/queries/runtime";
import { repoBranchesQueryOptions } from "@openducktor/frontend-core/queries/git";
import { autopilotSettingsQueryOptions } from "@openducktor/frontend-core/queries/autopilot";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import {
  createChecksStateFixture,
  createGitProviderContextFixture,
  createHostRuntimeStatusContextValue,
  createSettingsSnapshotFixture,
  createRepoSettingsConfigFixture,
  createDeferred,
} from "@/test-utils/shared-test-fixtures";
import { SettingsModal, SettingsModalProvider } from "./settings-modal";
import { savedSettingsResult } from "@/test-utils/settings-save-fixtures";

for (const shared of [true, false]) {
  test(`${shared ? "shared" : "local"} settings opens and reopens cached settings without a loader`, async () => {
    const settings = renderSettings(shared);
    try {
      for (let visit = 0; visit < 2; visit += 1) {
        fireEvent.click(within(document.body).getByRole("button", { name: "Open settings" }));
        const dialog = within(document.body).getByRole("dialog");
        expect(dialog.hasAttribute("aria-busy")).toBe(false);
        const content = within(dialog);
        expect(content.getByRole("button", { name: "Repositories" })).toBeDefined();
        expect(content.getByRole("button", { name: "Save settings" })).toBeDefined();
        await settings.close(content);
      }
    } finally {
      settings.unmount();
    }
  });

  test(`${shared ? "shared" : "local"} settings keeps the ready form visible during executable checks`, async () => {
    const discovery = createDeferred<RuntimeExecutableCheck>();
    const validation = createDeferred<RuntimeExecutableCheck>();
    const check = mock<HostClient["runtimeExecutablesCheck"]>((input) =>
      input.mode === "discover" ? discovery.promise : validation.promise,
    );
    const settings = renderSettings(shared, check);
    try {
      const content = await settings.open();
      fireEvent.click(content.getByRole("button", { name: "Agent runtimes" }));
      fireEvent.click(content.getByRole("switch", { name: "Enabled" }));
      const input = content.getByRole<HTMLInputElement>("textbox", { name: "Executable path" });
      const result = (path: string): RuntimeExecutableCheck => ({
        runtimes: [{ kind: "opencode", path, ok: true, version: "2.0.0", error: null }],
      });
      fireEvent.click(content.getByRole("button", { name: "Check again" }));
      await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
      expect(content.queryByRole("button", { name: "Cancel" }) !== null).toBe(true);
      expect(content.getByRole("button", { name: "Save settings" }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(content.getByRole("button", { name: "Checking…" }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(content.getByRole("button", { name: "Chat" }).hasAttribute("disabled")).toBe(false);
      await act(async () => discovery.resolve(result(input.value)));
      await waitFor(() =>
        expect(
          content.getByRole("button", { name: "Save settings" }).hasAttribute("disabled"),
        ).toBe(false),
      );

      input.focus();
      fireEvent.change(input, { target: { value: "/tools/another-opencode" } });
      await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
      expect(content.queryByRole("textbox", { name: "Executable path" }) === input).toBe(true);
      expect(document.activeElement === input).toBe(true);
      expect(content.getByRole("button", { name: "Save settings" }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(content.getByText("Checking executable path…")).toBeDefined();
      await act(async () => validation.resolve(result(input.value)));
      await waitFor(() =>
        expect(
          content.getByRole("button", { name: "Save settings" }).hasAttribute("disabled"),
        ).toBe(false),
      );
      expect(document.activeElement === input).toBe(true);
      await settings.close(content);
      expect(settings.saveSettingsSnapshot).not.toHaveBeenCalled();
    } finally {
      settings.unmount();
    }
  });

  test(`${shared ? "shared" : "local"} settings discards edits and keeps the prompt tab after cancel`, async () => {
    const settings = renderSettings(shared);
    try {
      let content = await settings.open();
      fireEvent.click(content.getByRole("button", { name: "System prompts" }));
      fireEvent.click(content.getByRole("tab", { name: "Builder" }));
      expect(content.getByRole("tab", { name: "Builder" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      fireEvent.click(content.getByRole("button", { name: "Chat" }));
      const thinkingMessages = content.getByRole("switch", {
        name: "Show thinking messages in session transcripts",
      });
      fireEvent.click(thinkingMessages);
      expect(thinkingMessages.getAttribute("aria-checked")).toBe("true");
      fireEvent.click(content.getByRole("button", { name: "System prompts" }));
      await settings.close(content);
      expect(settings.saveSettingsSnapshot).not.toHaveBeenCalled();
      content = await settings.open(shared ? "Other settings" : "Open settings");
      expect(content.getByRole("tab", { name: "Builder" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      fireEvent.click(content.getByRole("button", { name: "Chat" }));
      expect(
        content
          .getByRole("switch", { name: "Show thinking messages in session transcripts" })
          .getAttribute("aria-checked"),
      ).toBe("false");
    } finally {
      settings.unmount();
    }
  });

  test(`${shared ? "shared" : "local"} settings keeps navigation after saving edits`, async () => {
    const settings = renderSettings(shared);
    try {
      let content = await settings.open();
      fireEvent.click(content.getByRole("button", { name: "System prompts" }));
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
        { global: { chat: { showThinkingMessages: true } } },
        undefined,
      );
      content = await settings.open();
      expect(content.getByRole("heading", { name: "Chat settings" })).toBeDefined();
      fireEvent.click(content.getByRole("button", { name: "System prompts" }));
      expect(content.getByRole("tab", { name: "Builder" }).getAttribute("aria-selected")).toBe(
        "true",
      );
    } finally {
      settings.unmount();
    }
  });
}

test("cached settings stays visible while executable validation runs", async () => {
  const pending = createDeferred<RuntimeExecutableCheck>();
  const check = mock(async () => pending.promise);
  const settings = renderSettings(true, check, { cacheExecutables: false, enabledRuntime: true });
  try {
    fireEvent.click(within(document.body).getByRole("button", { name: "Open settings" }));
    const content = within(within(document.body).getByRole("dialog"));
    expect(content.getByRole("button", { name: "Repositories" })).toBeDefined();
    expect(content.getByRole("button", { name: "Save settings" }).hasAttribute("disabled")).toBe(
      true,
    );
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(within(document.body).getByRole("dialog").hasAttribute("aria-busy")).toBe(false);
  } finally {
    pending.resolve({ runtimes: [] });
    settings.unmount();
  }
});

test("missing settings shows preparation, then a read error that stays during retry", async () => {
  const first = createDeferred<SettingsSnapshot>();
  const retry = createDeferred<SettingsSnapshot>();
  const read = mock().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
  const settings = renderSettings(true, undefined, { cacheSnapshot: false, readSnapshot: read });
  try {
    fireEvent.click(within(document.body).getByRole("button", { name: "Open settings" }));
    const dialog = within(document.body).getByRole("dialog");
    expect(dialog.hasAttribute("aria-busy")).toBe(true);
    expect(within(dialog).getByRole("heading", { name: "Settings" })).toBeDefined();
    await act(async () => first.reject(new Error("Settings read failed")));
    const button = await within(dialog).findByRole("button", { name: "Retry settings" });
    fireEvent.click(button);
    expect(within(dialog).getByText(/Settings read failed/)).toBeDefined();
    expect(dialog.hasAttribute("aria-busy")).toBe(false);
    await act(async () => retry.resolve(createSettingsSnapshotFixture()));
    await within(dialog).findByRole("button", { name: "Repositories" });
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    first.resolve(createSettingsSnapshotFixture());
    retry.resolve(createSettingsSnapshotFixture());
    settings.unmount();
  }
});

test("a client without a local host keeps settings controls and returns focus", async () => {
  const settings = renderSettings(true);
  try {
    const trigger = within(document.body).getByRole("button", { name: "Open settings" });
    trigger.focus();
    const content = await settings.open();
    expect(content.queryByRole("button", { name: "Remote control" })).toBeNull();
    expect(content.getByRole("button", { name: "Save settings" })).toBeDefined();
    await settings.close(content);
    await waitFor(() => expect(document.activeElement === trigger).toBe(true), { timeout: 800 });
    expect(settings.saveSettingsSnapshot).not.toHaveBeenCalled();
  } finally {
    settings.unmount();
  }
});

test("shared settings remembers the section opened by a deep link", async () => {
  const settings = renderSettings(true);
  try {
    let content = await settings.open("Open roles");
    expect(content.getByText("Custom agent roles", { selector: "p" })).toBeDefined();
    await settings.close(content);
    content = await settings.open();
    expect(content.getByText("Custom agent roles", { selector: "p" })).toBeDefined();
  } finally {
    settings.unmount();
  }
});

test("shared settings remembers the repository subsection and prompt tab", async () => {
  const settings = renderSettings(true);
  try {
    let content = await settings.open("Open scripts");
    expect(content.getByLabelText("Worktree cleanup script (one command per line)")).toBeDefined();
    fireEvent.click(content.getByRole("button", { name: "Repository prompts" }));
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

function renderSettings(
  shared: boolean,
  runtimeExecutablesCheck?: HostClient["runtimeExecutablesCheck"],
  options: {
    readSnapshot?: () => Promise<SettingsSnapshot>;
    cacheSnapshot?: boolean;
    cacheExecutables?: boolean;
    enabledRuntime?: boolean;
  } = {},
) {
  const snapshot = createSettingsSnapshotFixture({
    workspaces: {
      other: createRepoSettingsConfigFixture("other", "/other"),
      repo: createRepoSettingsConfigFixture("repo", "/repo"),
    },
  });
  if (options.enabledRuntime) snapshot.agentRuntimes.opencode.enabled = true;
  const saveSettingsSnapshot = mock(async () => savedSettingsResult());
  const client: Partial<HostClient> = {
    workspaceGetSettingsSnapshot: options.readSnapshot ?? (async () => structuredClone(snapshot)),
  };
  if (runtimeExecutablesCheck) client.runtimeExecutablesCheck = runtimeExecutablesCheck;
  const connection = createTestClientConnection({ client });
  const { queryClient } = connection;
  queryClient.setQueryData(autopilotSettingsQueryOptions().queryKey, snapshot.autopilot);
  if (options.cacheSnapshot !== false) {
    queryClient.setQueryData(settingsSnapshotQueryOptions().queryKey, snapshot);
  }
  for (const workspace of Object.values(snapshot.workspaces)) {
    queryClient.setQueryData(repoBranchesQueryOptions(workspace.repoPath).queryKey, []);
  }
  for (const kind of options.cacheExecutables === false ? [] : knownRuntimeKindValues) {
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
    selectWorkspace: async () => {},
    reorderWorkspaces: async () => {},
    refreshBranches: async () => {},
    switchBranch: async () => {},
    loadRepoSettings: async () => {
      throw new Error("Not used in this test");
    },
    detectGithubRepository: async () => null,
    previewSettingsSnapshotRuntime: async () => ({ impact: null }),
    saveSettingsSnapshot,
    saveAgentModelFavorites: async () => structuredClone(snapshot.agentModelFavorites),
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
      <QueryProvider connection={connection}>
        <WorkspaceStateContext.Provider value={workspaceState}>
          <ChecksStateContext.Provider value={checksState}>
            <RuntimeDefinitionsContext.Provider value={runtimeState}>
              <HostRuntimeStatusContext.Provider value={createHostRuntimeStatusContextValue()}>
                {children}
              </HostRuntimeStatusContext.Provider>
            </RuntimeDefinitionsContext.Provider>
          </ChecksStateContext.Provider>
        </WorkspaceStateContext.Provider>
      </QueryProvider>
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
      { timeout: 800 },
    );
  };
  const close = async (content: Awaited<ReturnType<typeof open>>, save = false) => {
    await act(async () => {
      fireEvent.click(content.getByRole("button", { name: save ? "Save settings" : "Cancel" }));
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
        workspaceId="repo"
        open={open}
        onOpenChange={setOpen}
        repoPath="/repo"
        provider={createGitProviderContextFixture({ available: false })}
      />
    </>
  );
}
