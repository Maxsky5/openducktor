import { expect, jest, mock, test } from "bun:test";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  knownRuntimeKindValues,
  type RuntimeExecutableCheck,
  type SettingsSnapshot,
  type ShortcutPreferences,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { notifyManager } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { useState, type PropsWithChildren, type ReactElement } from "react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { MINIMUM_LOADER_MS } from "@openducktor/frontend-core/lib/use-minimum-loader";
import { QueryProvider } from "@/test-utils/query-provider";
import { IssueImportDialog } from "@/pages/kanban/issue-import-dialog";
import { RuntimeDefinitionsContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { ChecksStateContext, WorkspaceStateContext } from "@/state/app-state-contexts";
import { HostRuntimeStatusContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { runtimeExecutableQueryOptions } from "@openducktor/frontend-core/queries/runtime";
import { repoBranchesQueryOptions } from "@openducktor/frontend-core/queries/git";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { keyboardShortcutsQueryOptions } from "@openducktor/frontend-core/queries/keyboard-shortcuts";
import {
  createChecksStateFixture,
  createGitProviderContextFixture,
  createHostRuntimeStatusContextValue,
  createSettingsSnapshotFixture,
  createRepoSettingsConfigFixture,
} from "@/test-utils/shared-test-fixtures";
import { ThemeProvider } from "@/components/layout/theme-provider";
import {
  FeatureTourProvider,
  useFeatureTourState,
} from "@/features/feature-tour/feature-tour-context";
import { FeatureTourDialogHost } from "@/features/feature-tour/feature-tour-dialog-host";
import { ShortcutPreferencesProvider } from "@/features/shortcuts/shortcut-preferences-provider";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { SettingsModal, SettingsModalProvider } from "./settings-modal";
import { savedSettingsResult } from "@/test-utils/settings-save-fixtures";

type SettingsContent = ReturnType<typeof within>;
/** The overview row of a prompt, named by its label. */
const promptRow = (content: SettingsContent, label: string) =>
  content.getByRole("button", { name: label });
/** An open prompt shows its editor, with the prompt label as its heading. */
const isSelectedPrompt = (content: SettingsContent, label: string) =>
  content.queryByRole("heading", { name: label }) !== null;

// The tour host loads the dialog and its scenes lazily. Load both here, so no test pays for the
// first load.
await (await import("@/features/feature-tour/feature-tour-dialog-loader")).loadFeatureTourDialog();

test("cached shared Settings keeps navigation across triggers through Cancel and Save", async () => {
  const settings = renderSettings(true, undefined, {
    extraTrigger: <SettingsModal triggerLabel="Other settings" />,
  });
  const openCached = async (label = "Open settings") => {
    fireEvent.click(within(document.body).getByRole("button", { name: label }));
    const dialog = within(document.body).getByRole("dialog");
    expect(dialog.hasAttribute("aria-busy")).toBe(false);
    const content = within(dialog);
    await waitFor(
      () => {
        expect(
          content.getByRole<HTMLButtonElement>("button", { name: "Repositories" }).disabled,
        ).toBe(false);
      },
      { timeout: 800 },
    );
    return content;
  };
  const thinkingSwitch = (content: SettingsContent) =>
    content.getByRole("switch", { name: "Show thinking messages in session transcripts" });
  try {
    let content = await openCached();
    expect(content.getByRole("button", { name: "Save settings" })).toBeDefined();
    fireEvent.click(content.getByRole("button", { name: "System prompts" }));
    expect(content.getByRole("textbox", { name: "Search all prompts" })).toBeDefined();
    fireEvent.click(promptRow(content, "Builder"));
    expect(isSelectedPrompt(content, "Builder Instructions")).toBe(true);
    fireEvent.click(content.getByRole("button", { name: "Sessions" }));
    expect(thinkingSwitch(content).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(thinkingSwitch(content));
    expect(thinkingSwitch(content).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(content.getByRole("button", { name: "System prompts" }));
    await settings.close(content);
    expect(settings.saveSettingsSnapshot).not.toHaveBeenCalled();

    content = await openCached("Other settings");
    expect(isSelectedPrompt(content, "Builder Instructions")).toBe(true);
    // The prompt keeps the screen that opened it, so Back returns to the first screen.
    fireEvent.click(content.getByRole("button", { name: "Back to System prompts" }));
    expect(content.getByRole("textbox", { name: "Search all prompts" })).toBeDefined();
    fireEvent.click(promptRow(content, "Builder"));
    fireEvent.click(content.getByRole("button", { name: "Sessions" }));
    expect(thinkingSwitch(content).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(thinkingSwitch(content));
    await settings.close(content, true);
    expect(settings.saveSettingsSnapshot.mock.calls).toEqual([
      [{ global: { chat: { showThinkingMessages: true } } }, undefined],
    ]);

    content = await openCached();
    expect(content.getByRole("heading", { name: "Session settings" })).toBeDefined();
    fireEvent.click(content.getByRole("button", { name: "System prompts" }));
    expect(isSelectedPrompt(content, "Builder Instructions")).toBe(true);
  } finally {
    settings.unmount();
  }
});

test("Settings keeps the ready form visible during executable checks", async () => {
  const discovery = Promise.withResolvers<RuntimeExecutableCheck>();
  const validation = Promise.withResolvers<RuntimeExecutableCheck>();
  const check = mock<HostClient["runtimeExecutablesCheck"]>((input) =>
    input.mode === "discover" ? discovery.promise : validation.promise,
  );
  const settings = renderSettings(true, check);
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
    expect(content.getByRole("button", { name: "Checking…" }).hasAttribute("disabled")).toBe(true);
    expect(content.getByRole("button", { name: "Sessions" }).hasAttribute("disabled")).toBe(false);
    await act(async () => discovery.resolve(result(input.value)));
    await waitFor(() =>
      expect(content.getByRole("button", { name: "Save settings" }).hasAttribute("disabled")).toBe(
        false,
      ),
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
      expect(content.getByRole("button", { name: "Save settings" }).hasAttribute("disabled")).toBe(
        false,
      ),
    );
    expect(document.activeElement === input).toBe(true);
    await settings.close(content);
    expect(settings.saveSettingsSnapshot).not.toHaveBeenCalled();
  } finally {
    settings.unmount();
  }
});

test("Settings locks shortcuts during save and shows the saved removal when reopened", async () => {
  const write = Promise.withResolvers<ShortcutPreferences>();
  const writing = Promise.withResolvers<void>();
  const saveKeyboardShortcuts = mock<HostClient["workspaceSaveKeyboardShortcuts"]>(() => {
    writing.resolve();
    return write.promise;
  });
  const saved = { version: 1, overrides: { sidebar: null } } satisfies ShortcutPreferences;
  const settings = renderSettings(false, undefined, { saveKeyboardShortcuts });
  const sidebarRow = (content: SettingsContent) =>
    within(content.getByText("Toggle sidebar").closest("li")!);
  const openShortcuts = (content: SettingsContent) => {
    fireEvent.click(content.getByRole("button", { name: "Keyboard shortcuts" }));
    fireEvent.change(content.getByLabelText("Search commands"), {
      target: { value: "Toggle sidebar" },
    });
    return sidebarRow(content);
  };
  try {
    const content = await settings.open();
    const sidebar = openShortcuts(content);
    fireEvent.click(sidebar.getByRole("button", { name: "Remove shortcut for Toggle sidebar" }));
    await act(async () => {
      fireEvent.click(content.getByRole("button", { name: "Save settings" }));
      await writing.promise;
      await new Promise<void>((resolve) => notifyManager.schedule(resolve));
    });
    expect(content.queryByRole<HTMLButtonElement>("button", { name: "Saving…" })?.disabled).toBe(
      true,
    );
    expect(
      sidebar.getByRole<HTMLButtonElement>("button", { name: /^Toggle sidebar, .*Add keys$/ })
        .disabled,
    ).toBe(true);
    expect(content.getByRole("button", { name: "Reset all" }).hasAttribute("disabled")).toBe(true);
    fireEvent.keyDown(within(document.body).getByRole("dialog"), { key: "Escape" });
    expect(within(document.body).queryByRole("dialog")).not.toBeNull();
    await act(async () => {
      write.resolve(saved);
      await write.promise;
    });
    expect(within(document.body).queryByRole("dialog")).toBeNull();
    expect(saveKeyboardShortcuts.mock.calls).toEqual([[saved]]);

    const reopened = await settings.open();
    fireEvent.change(reopened.getByLabelText("Search commands"), {
      target: { value: "Toggle sidebar" },
    });
    expect(
      sidebarRow(reopened)
        .getByRole("button", { name: /^Toggle sidebar, .*Add keys$/ })
        .hasAttribute("disabled"),
    ).toBe(false);
  } finally {
    settings.unmount();
  }
});

test("Show tour hands the focus from Settings to the tour and back to the opener", async () => {
  const settings = renderSettings(true, undefined, { featureTour: "dialog" });
  try {
    const trigger = within(document.body).getByRole("button", { name: "Open settings" });
    trigger.focus();
    const content = await settings.open();
    // The tour traps the focus, so only a focus event shows a move to the trigger behind it.
    const triggerFocus = mock(() => {});
    trigger.addEventListener("focus", triggerFocus);
    fireEvent.click(content.getByRole("button", { name: "General" }));
    await act(async () => {
      fireEvent.click(content.getByRole("button", { name: "Show tour" }));
    });
    const tour = await waitFor(
      () => {
        const dialogs = within(document.body).getAllByRole("dialog");
        expect(dialogs).toHaveLength(1);
        return dialogs[0]!;
      },
      { timeout: 500 },
    );
    expect(within(tour).getByText("1 of 9")).toBeDefined();
    expect(tour.contains(document.activeElement)).toBe(true);
    expect(triggerFocus).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(tour).getByRole("button", { name: "Close" }));
    });
    await waitFor(() => expect(within(document.body).queryByRole("dialog")).toBeNull(), {
      timeout: 500,
    });
    // Compare by identity: a failed element match prints the whole DOM tree.
    expect(document.activeElement === trigger).toBe(true);
    expect(triggerFocus).toHaveBeenCalledTimes(1);
  } finally {
    settings.unmount();
  }
});

test("Show tour leaves the focus return to the tour, also before the tour shows", async () => {
  // Without the tour dialog, only the tour state shows the handoff.
  const settings = renderSettings(true, undefined, { featureTour: "state" });
  try {
    const trigger = within(document.body).getByRole("button", { name: "Open settings" });
    trigger.focus();
    const content = await settings.open();
    const triggerFocus = mock(() => {});
    trigger.addEventListener("focus", triggerFocus);
    fireEvent.click(content.getByRole("button", { name: "General" }));
    await act(async () => {
      fireEvent.click(content.getByRole("button", { name: "Show tour" }));
    });
    await waitFor(() => expect(within(document.body).queryByRole("dialog")).toBeNull(), {
      timeout: 500,
    });
    // Radix runs the close focus handler in a timer after Settings unmounts.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(tourStateProbe).toEqual({ open: true, returnFocus: trigger });
    expect(triggerFocus).not.toHaveBeenCalled();
  } finally {
    settings.unmount();
  }
});

test("cached local Settings opens immediately and remembers General after Cancel", async () => {
  const settings = renderSettings(false);
  try {
    const body = within(document.body);
    fireEvent.click(body.getByRole("button", { name: "Open settings" }));
    const dialog = body.getByRole("dialog");
    expect(dialog.hasAttribute("aria-busy")).toBe(false);
    const content = within(dialog);
    const general = content.getByRole<HTMLButtonElement>("button", { name: "General" });
    await waitFor(() => expect(general.disabled).toBe(false), { timeout: 800 });
    fireEvent.click(general);
    expect(content.getByRole("heading", { name: "General settings" })).toBeDefined();
    expect(content.queryAllByRole("button", { name: "Show tour" }).length).toBe(0);
    await settings.close(content);
    const reopened = await settings.open();
    expect(reopened.queryAllByRole("heading", { name: "General settings" }).length).toBe(1);
  } finally {
    settings.unmount();
  }
});

test("cached settings stays visible while executable validation runs", async () => {
  const pending = Promise.withResolvers<RuntimeExecutableCheck>();
  const check = mock(async () => pending.promise);
  const settings = renderSettings(true, check, { cacheExecutables: false, enabledRuntime: true });
  try {
    await act(async () => {
      fireEvent.click(within(document.body).getByRole("button", { name: "Open settings" }));
    });
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
  const first = Promise.withResolvers<SettingsSnapshot>();
  const retry = Promise.withResolvers<SettingsSnapshot>();
  const read = mock().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
  const settings = renderSettings(true, undefined, { cacheSnapshot: false, readSnapshot: read });
  jest.useFakeTimers();
  try {
    fireEvent.click(within(document.body).getByRole("button", { name: "Open settings" }));
    const dialog = within(document.body).getByRole("dialog");
    expect(dialog.hasAttribute("aria-busy")).toBe(true);
    expect(within(dialog).getByRole("heading", { name: "Settings" })).toBeDefined();
    await act(async () => first.reject(new Error("Settings read failed")));
    await act(async () => {
      jest.advanceTimersByTime(MINIMUM_LOADER_MS);
    });
    const button = within(dialog).getByRole("button", { name: "Retry settings" });
    fireEvent.click(button);
    expect(within(dialog).getByRole("alert").textContent).toContain(
      "Failed to load settings: Settings read failed",
    );
    expect(dialog.hasAttribute("aria-busy")).toBe(false);
    await act(async () => retry.resolve(createSettingsSnapshotFixture()));
    await act(async () => {
      jest.advanceTimersByTime(0);
    });
    expect(within(dialog).getByRole("button", { name: "Repositories" })).toBeDefined();
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    try {
      first.resolve(createSettingsSnapshotFixture());
      retry.resolve(createSettingsSnapshotFixture());
      settings.unmount();
      await act(async () => {
        jest.runOnlyPendingTimers();
      });
    } finally {
      jest.useRealTimers();
    }
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
  const settings = renderSettings(true, undefined, {
    extraTrigger: (
      <SettingsModal triggerLabel="Open roles" deepLink={{ kind: "custom-agent-roles" }} />
    ),
  });
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

test("shared Settings clears a missing repository target and remembers the selected prompt", async () => {
  const settings = renderSettings(true, undefined, {
    extraTrigger: (
      <SettingsModal
        triggerLabel="Open missing scripts"
        deepLink={{ kind: "repository-actions", repositoryPath: "/missing" }}
      />
    ),
  });
  try {
    let content = await settings.open("Open missing scripts");
    expect(content.getByRole("alert").textContent).toContain("/missing");
    await settings.close(content);

    content = await settings.open();
    expect(content.queryByRole("alert") === null).toBe(true);
    expect(
      content.getByLabelText("Before worktree removal script (one command per line)"),
    ).toBeDefined();
    fireEvent.click(content.getByRole("button", { name: "Repository prompts" }));
    fireEvent.click(promptRow(content, "Spec, Plan, Build"));
    fireEvent.click(promptRow(content, "QA Kickoff"));
    await settings.close(content);
    content = await settings.open();
    expect(isSelectedPrompt(content, "QA Kickoff")).toBe(true);
  } finally {
    settings.unmount();
  }
});

test("issue import opens repository configuration after browsing scripts and sessions", async () => {
  const settings = renderSettings(true, undefined, { extraTrigger: <ImportTrigger /> });
  try {
    let content = await settings.open();
    fireEvent.click(content.getByRole("button", { name: "Repositories" }));
    const configuration = content.getByRole("button", { name: "Configuration" });
    const scripts = content.getByRole("button", { name: "Scripts" });
    const buttons = content.getAllByRole("button");
    expect(buttons[buttons.indexOf(configuration) + 1]).toBe(scripts);
    fireEvent.click(scripts);
    fireEvent.click(content.getByRole("button", { name: "Sessions" }));
    await settings.close(content);
    fireEvent.click(within(document.body).getByRole("button", { name: "Import issues" }));
    content = await settings.open("Open repository settings");
    expect(content.getByLabelText<HTMLInputElement>("Repository path").value).toBe("/repo");
  } finally {
    settings.unmount();
  }
});

function renderSettings(
  shared: boolean,
  runtimeExecutablesCheck?: HostClient["runtimeExecutablesCheck"],
  options: {
    readSnapshot?: () => Promise<SettingsSnapshot>;
    cacheSnapshot?: boolean;
    cacheExecutables?: boolean;
    enabledRuntime?: boolean;
    /**
     * Mounts the shared Settings inside the feature tour, as the app does. "state" mounts no tour
     * dialog and records the tour state in `tourStateProbe`.
     */
    featureTour?: "dialog" | "state";
    saveKeyboardShortcuts?: HostClient["workspaceSaveKeyboardShortcuts"];
    extraTrigger?: ReactElement | undefined;
  } = {},
) {
  const snapshot = createSettingsSnapshotFixture({
    workspaces: {
      other: createRepoSettingsConfigFixture("other", "/other"),
      repo: createRepoSettingsConfigFixture("repo", "/repo"),
    },
  });
  if (options.enabledRuntime) snapshot.agentRuntimes.opencode.enabled = true;
  const saveSettingsSnapshot = mock<WorkspaceStateContextValue["saveSettingsSnapshot"]>(async () =>
    savedSettingsResult(),
  );
  const client: Partial<HostClient> = {
    workspaceGetSettingsSnapshot: options.readSnapshot ?? (async () => structuredClone(snapshot)),
  };
  if (runtimeExecutablesCheck) client.runtimeExecutablesCheck = runtimeExecutablesCheck;
  if (options.saveKeyboardShortcuts)
    client.workspaceSaveKeyboardShortcuts = options.saveKeyboardShortcuts;
  const connection = createTestClientConnection({ client });
  const { queryClient } = connection;
  queryClient.setQueryData(keyboardShortcutsQueryOptions().queryKey, { version: 1, overrides: {} });
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
      {options.extraTrigger}
    </>
  );
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryProvider connection={connection}>
        <ShortcutPreferencesProvider>
          <WorkspaceStateContext.Provider value={workspaceState}>
            <ChecksStateContext.Provider value={checksState}>
              <RuntimeDefinitionsContext.Provider value={runtimeState}>
                <HostRuntimeStatusContext.Provider value={createHostRuntimeStatusContextValue()}>
                  {children}
                </HostRuntimeStatusContext.Provider>
              </RuntimeDefinitionsContext.Provider>
            </ChecksStateContext.Provider>
          </WorkspaceStateContext.Provider>
        </ShortcutPreferencesProvider>
      </QueryProvider>
    );
  }
  let settingsTree: ReactElement = triggers;
  if (shared && options.featureTour) {
    // The tour shows its pictures in the theme of the app.
    settingsTree = (
      <ThemeProvider>
        <FeatureTourProvider>
          <SettingsModalProvider>{triggers}</SettingsModalProvider>
          {options.featureTour === "dialog" ? <FeatureTourDialogHost /> : <TourStateProbe />}
        </FeatureTourProvider>
      </ThemeProvider>
    );
  } else if (shared) {
    settingsTree = <SettingsModalProvider>{triggers}</SettingsModalProvider>;
  }
  const view = render(settingsTree, { wrapper: Wrapper });
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

let tourStateProbe: { open: boolean; returnFocus: HTMLElement | null } | null = null;

function TourStateProbe(): null {
  const { open, returnFocus } = useFeatureTourState();
  tourStateProbe = { open, returnFocus };
  return null;
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
