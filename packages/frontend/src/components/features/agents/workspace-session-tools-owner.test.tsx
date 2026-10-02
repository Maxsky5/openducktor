import { expect, mock, test } from "bun:test";
import type { GitWorktreeStatus } from "@openducktor/contracts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import { buildState } from "@/features/dev-servers/use-agent-studio-dev-server-panel-test-fixtures";
import { createQueryClient } from "@/lib/query-client";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { WorkspaceSessionToolsPanel } from "./workspace-session-tools-panel";

test.each(["directory", "branch"] as const)(
  "drops a pending Git confirmation when its %s changes",
  async (change) => {
    const status = (workingDir = "/repo/a"): GitWorktreeStatus => ({
      currentBranch: { name: "feature", detached: false },
      fileStatuses: [],
      fileDiffs: [],
      targetAheadBehind: { ahead: 0, behind: 0 },
      upstreamAheadBehind: { outcome: "tracking", ahead: 2, behind: 3 },
      snapshot: {
        effectiveWorkingDir: workingDir,
        targetBranch: "origin/main",
        diffScope: "uncommitted",
        observedAtMs: 1,
        hashVersion: 1,
        statusHash: "0123456789abcdef",
        diffHash: "fedcba9876543210",
      },
    });
    const pull = mock(async () => ({
      outcome: "up_to_date" as const,
      conflictedFiles: [],
      output: "",
    }));
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          devServerGetState: async (_repoPath, owner) => buildState({ owner, scripts: [] }),
          gitGetComparisonTarget: async () => ({ kind: "available", reference: "origin/main" }),
          gitGetWorktreeStatus: async (_repoPath, _target, _scope, workingDir) =>
            status(workingDir),
          gitGetWorktreeStatusSummary: async (_repoPath, _target, _scope, workingDir) => {
            const full = status(workingDir);
            return {
              currentBranch: full.currentBranch,
              fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
              targetAheadBehind: full.targetAheadBehind,
              upstreamAheadBehind: full.upstreamAheadBehind,
              snapshot: full.snapshot,
            };
          },
          gitGetBranches: async () => [],
          gitPullBranch: pull,
        },
        bridge: {
          subscribeDevServerEvents: async () => ({
            transportEpoch: "test:1",
            unsubscribe: () => {},
          }),
        },
      }),
    );
    const queryClient = createQueryClient();
    const panel = (
      sessionId: string,
      workingDirectory: string,
      branchKey: string,
      activeTabId: "git" | "file_explorer" = "git",
    ) => (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <SettingsModalProvider>
            <WorkspaceSessionToolsPanel
              repoPath="/repo"
              workspaceId="workspace"
              sessionId={sessionId}
              workingDirectory={workingDirectory}
              contextMode="worktree"
              branchKey={branchKey}
              branchReady={true}
              target={{ branch: "main", remote: "origin" }}
              targetError={null}
              retryTarget={async () => {}}
              readBranch={async () => branchKey}
              activeTabId={activeTabId}
              onActiveTabChange={() => {}}
              selectedFile={null}
              onSelectFile={() => {}}
              onRefreshReady={() => {}}
            />
          </SettingsModalProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
    const rendered = render(panel("session-a", "/repo/a", "branch:feature"));
    try {
      await waitFor(() =>
        expect(screen.getByTestId("agent-studio-git-pull-button").hasAttribute("disabled")).toBe(
          false,
        ),
      );
      fireEvent.click(screen.getByTestId("agent-studio-git-pull-button"));
      expect(screen.getByRole("dialog", { name: "Confirm pull with rebase" })).toBeTruthy();
      rendered.rerender(panel("session-a", "/repo/a", "branch:feature", "file_explorer"));
      rendered.rerender(panel("session-a", "/repo/a", "branch:feature"));
      expect(Boolean(screen.queryByRole("dialog", { name: "Confirm pull with rebase" }))).toBe(
        true,
      );
      rendered.rerender(panel("session-b", "/repo/a", "branch:feature"));
      expect(screen.getByRole("dialog", { name: "Confirm pull with rebase" })).toBeTruthy();
      const nextDirectory = change === "directory" ? "/repo/b" : "/repo/a";
      const nextBranchKey = change === "branch" ? "branch:other" : "branch:feature";
      rendered.rerender(panel("session-c", nextDirectory, nextBranchKey));
      expect(Boolean(screen.queryByRole("dialog", { name: "Confirm pull with rebase" }))).toBe(
        false,
      );
      expect(pull).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.getByTestId("agent-studio-git-pull-button").hasAttribute("disabled")).toBe(
          false,
        ),
      );
      fireEvent.click(screen.getByTestId("agent-studio-git-pull-button"));
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: "Pull with rebase" })),
      );
      expect(pull).toHaveBeenCalledWith("/repo", nextDirectory);
    } finally {
      rendered.unmount();
      queryClient.clear();
      configureShellBridge(createUnavailableShellBridge());
    }
  },
);
