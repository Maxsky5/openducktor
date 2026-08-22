import { expect, mock } from "bun:test";
import {
  type AgentRuntimes,
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeExecutableCheck,
} from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { createQueryClient } from "@/lib/query-client";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { runtimeDefinitionsQueryOptions } from "@/state/queries/runtime";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type { WorkspaceStateContextValue } from "@/types/state-slices";
import { OnboardingPage } from "./onboarding-page";

export const runtimeDefinitions = [
  OPENCODE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  CLAUDE_RUNTIME_DESCRIPTOR,
];

export const createCheck = (
  runtimes: AgentRuntimes,
  opencodeOk = false,
): RuntimeExecutableCheck => ({
  runtimes: [
    {
      kind: "opencode",
      path: runtimes.opencode.executablePath,
      ok: opencodeOk,
      version: opencodeOk ? "1.0.0" : null,
      error: opencodeOk ? null : "OpenCode executable is invalid.",
    },
    {
      kind: "codex",
      path: runtimes.codex.executablePath,
      ok: false,
      version: null,
      error: "Codex executable is invalid.",
    },
    {
      kind: "claude",
      path: runtimes.claude.executablePath,
      ok: false,
      version: null,
      error: "Claude executable is invalid.",
    },
  ],
});

export const createOnboardingTestHarness = () => {
  const mountedViews = new Set<ReturnType<typeof render>>();

  const cleanup = (): void => {
    for (const view of mountedViews) view.unmount();
    mountedViews.clear();
    document.documentElement.classList.remove("light", "dark");
  };

  const renderOnboarding = ({
    runtimes,
    saveSettingsSnapshot = mock(async () => {}),
    prefillSettings = true,
    prefillDefinitions = true,
  }: {
    runtimes: AgentRuntimes;
    saveSettingsSnapshot?: WorkspaceStateContextValue["saveSettingsSnapshot"];
    prefillSettings?: boolean;
    prefillDefinitions?: boolean;
  }): ReturnType<typeof createQueryClient> => {
    const queryClient = createQueryClient();
    if (prefillSettings) {
      queryClient.setQueryData(
        settingsSnapshotQueryOptions().queryKey,
        createSettingsSnapshotFixture({ agentRuntimes: runtimes }),
      );
    }
    if (prefillDefinitions) {
      queryClient.setQueryData(runtimeDefinitionsQueryOptions().queryKey, runtimeDefinitions);
    }
    const workspaceState = {
      isSwitchingWorkspace: false,
      isLoadingBranches: false,
      isSwitchingBranch: false,
      branchSyncDegraded: false,
      workspaces: [],
      activeWorkspace: null,
      branches: [],
      activeBranch: null,
      addWorkspace: mock(async () => {}),
      selectWorkspace: mock(async () => {}),
      reorderWorkspaces: mock(async () => {}),
      refreshBranches: mock(async () => {}),
      switchBranch: mock(async () => {}),
      loadRepoSettings: mock(async () => {
        throw new Error("Not used");
      }),
      saveRepoSettings: mock(async () => {}),
      loadSettingsSnapshot: mock(async () => createSettingsSnapshotFixture()),
      detectGithubRepository: mock(async () => null),
      saveGlobalGitConfig: mock(async () => {}),
      saveSettingsSnapshot,
      saveAgentModelFavorites: mock(async () => createSettingsSnapshotFixture()),
    } satisfies WorkspaceStateContextValue;

    const view = render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <WorkspaceStateContext value={workspaceState}>
            <OnboardingPage onComplete={() => {}} />
          </WorkspaceStateContext>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    mountedViews.add(view);
    return queryClient;
  };

  return { cleanup, renderOnboarding };
};

export const enterRuntimeStage = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Configure coding agents" }));
    await Promise.resolve();
    await Promise.resolve();
  });
  await screen.findByRole("heading", { name: "Configure coding agents" });
  // SAFETY: This test creates the DOM fixture that supplies `HTMLButtonElement` before this lookup.
  await waitFor(() =>
    expect((screen.getByRole("button", { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
};

export const opencodeSection = (): HTMLElement => {
  const section = screen.getByRole("heading", { name: "OpenCode" }).closest("section");
  if (!section) throw new Error("OpenCode section is missing");
  return section;
};
