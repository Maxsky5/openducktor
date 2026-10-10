import { expect, mock, test } from "bun:test";
import type { GitWorktreeStatus } from "@openducktor/contracts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import { createQueryClient } from "@/lib/query-client";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { useWorkspaceSessionTools } from "./use-workspace-session-tools";

/** Renders the tools as the right panel does: Diffs while selected, Files always mounted. */
function ToolsOwner(props: Parameters<typeof useWorkspaceSessionTools>[0]) {
  const { diffsContent, filesContent } = useWorkspaceSessionTools(props);
  if (!props.isVisible) return null;
  return (
    <>
      {props.isFilesActive ? null : diffsContent}
      {filesContent}
    </>
  );
}

test("returning to a session checks fresh comparison data while its previous read is pending", async () => {
  const pending = Promise.withResolvers<GitWorktreeStatus>();
  let currentBranch = "branch-a";
  let currentFile = "original-a.txt";
  let targetCalls = 0;
  const status = (target: string, scope: "target" | "uncommitted"): GitWorktreeStatus => ({
    currentBranch: { name: currentBranch, detached: false },
    fileStatuses: [],
    fileDiffs:
      scope === "target"
        ? [{ file: currentFile, type: "modified", additions: 1, deletions: 0, diff: "@@ -1 +1 @@" }]
        : [],
    targetAheadBehind: { ahead: currentFile === "original-a.txt" ? 9 : 1, behind: 0 },
    upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
    snapshot: {
      effectiveWorkingDir: "/repo",
      targetBranch: target,
      diffScope: scope,
      observedAtMs: 1,
      hashVersion: 1,
      statusHash: currentFile,
      diffHash: currentFile,
    },
  });
  const oldStatus = status("refs/heads/main", "target");
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetBranches: async () => [],
        gitGetComparisonTarget: async () => ({ kind: "available", reference: "refs/heads/main" }),
        gitGetWorktreeStatus: async (_repo, target, scope = "uncommitted") => {
          if (scope === "target" && ++targetCalls === 1) return pending.promise;
          return status(target, scope);
        },
      },
    }),
  );
  const args: Parameters<typeof useWorkspaceSessionTools>[0] = {
    isVisible: true,
    repoPath: "/repo",
    workspaceId: "workspace",
    sessionId: "session-a",
    workingDirectory: "/repo",
    contextMode: "worktree",
    branchKey: "branch-a",
    branchReady: true,
    currentBranch: { name: "feature", detached: false },
    target: { branch: "main" },
    targetError: null,
    applyTarget: async () => {},
    retryTarget: async () => {},
    readBranch: async () => currentBranch,
    isFilesActive: false,
    selectedFile: null,
    onSelectFile: () => {},
  };
  const queryClient = createQueryClient();
  queryClient.setQueryData(
    settingsSnapshotQueryOptions().queryKey,
    createSettingsSnapshotFixture(),
  );
  const panel = (props: typeof args) => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SettingsModalProvider>
          <ToolsOwner {...props} />
        </SettingsModalProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
  const view = render(panel(args));
  try {
    await waitFor(() => expect(targetCalls).toBe(1));
    currentBranch = "branch-b";
    currentFile = "session-b.txt";
    view.rerender(panel({ ...args, sessionId: "session-b", branchKey: currentBranch }));
    await waitFor(() => expect(targetCalls).toBe(2));
    currentBranch = "branch-a";
    currentFile = "fresh-a.txt";
    view.rerender(panel(args));
    await waitFor(() => expect(targetCalls).toBe(3));
    await waitFor(() =>
      expect(
        screen.getByTestId("agent-studio-git-diff-scope-target").hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.mouseDown(screen.getByTestId("agent-studio-git-diff-scope-target"), { button: 0 });
    await waitFor(() => expect(screen.getByText("fresh-a.txt")).toBeDefined());
    await act(async () => {
      pending.resolve(oldStatus);
      await pending.promise;
    });
    expect(screen.queryByText("original-a.txt")).toBeNull();
    expect(screen.getByText("fresh-a.txt")).toBeDefined();
    expect(targetCalls).toBe(3);
  } finally {
    pending.resolve(oldStatus);
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("keeps a rebase lock and captured target while the panel closes and reopens", async () => {
  const pending = Promise.withResolvers<{
    outcome: "rebased";
    conflictedFiles: string[];
    output: string;
  }>();
  const rebase = mock(async () => pending.promise);
  const status = (target: string, scope: "target" | "uncommitted"): GitWorktreeStatus => ({
    currentBranch: { name: "feature", detached: false },
    fileStatuses: [],
    fileDiffs: [],
    targetAheadBehind: { ahead: 0, behind: 3 },
    upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
    snapshot: {
      effectiveWorkingDir: "/repo/a",
      targetBranch: target,
      diffScope: scope,
      observedAtMs: 1,
      hashVersion: 1,
      statusHash: "0123456789abcdef",
      diffHash: "fedcba9876543210",
    },
  });
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: async (_repo, _dir, target) => ({
          kind: "available",
          reference: `refs/heads/${target.branch}`,
        }),
        gitGetWorktreeStatus: async (_repo, target, scope = "uncommitted") => status(target, scope),
        gitGetWorktreeStatusSummary: async (_repo, target, scope = "uncommitted") => ({
          currentBranch: status(target, scope).currentBranch,
          fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
          targetAheadBehind: status(target, scope).targetAheadBehind,
          upstreamAheadBehind: status(target, scope).upstreamAheadBehind,
          snapshot: status(target, scope).snapshot,
        }),
        gitGetBranches: async () => [],
        gitRebaseBranch: rebase,
      },
    }),
  );
  const queryClient = createQueryClient();
  const panel = (isOpen: boolean, target = "release") => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SettingsModalProvider>
          <ToolsOwner
            isVisible={isOpen}
            repoPath="/repo"
            workspaceId="workspace"
            sessionId="session"
            workingDirectory="/repo/a"
            contextMode="worktree"
            currentBranch={{ name: "feature", detached: false }}
            branchKey="feature"
            branchReady={true}
            target={{ branch: target }}
            targetError={null}
            applyTarget={async () => {}}
            retryTarget={async () => {}}
            readBranch={async () => "feature"}
            isFilesActive={false}
            selectedFile={null}
            onSelectFile={() => {}}
          />
        </SettingsModalProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
  const rendered = render(panel(true));
  try {
    await waitFor(() =>
      expect(screen.getByTestId("agent-studio-git-rebase-button").hasAttribute("disabled")).toBe(
        false,
      ),
    );
    await act(async () => fireEvent.click(screen.getByTestId("agent-studio-git-rebase-button")));
    expect(rebase).toHaveBeenCalledWith("/repo", "refs/heads/release", "/repo/a");
    rendered.rerender(panel(false, "next"));
    expect(screen.queryByTestId("agent-studio-git-rebase-button")).toBeNull();
    rendered.rerender(panel(true, "next"));
    await waitFor(() =>
      expect(screen.getByTestId("agent-studio-git-target-branch").textContent).toContain("next"),
    );
    expect(screen.getByTestId("agent-studio-git-rebase-button").hasAttribute("disabled")).toBe(
      true,
    );
    fireEvent.click(screen.getByTestId("agent-studio-git-rebase-button"));
    expect(rebase).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ outcome: "rebased", conflictedFiles: [], output: "" });
      await pending.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("agent-studio-git-rebase-button").hasAttribute("disabled")).toBe(
        false,
      ),
    );
  } finally {
    rendered.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test.each(["directory", "branch"] as const)(
  "scopes a pending Git confirmation when its %s changes",
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
      }),
    );
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      settingsSnapshotQueryOptions().queryKey,
      createSettingsSnapshotFixture(),
    );
    const panel = (
      sessionId: string,
      workingDirectory: string,
      branchKey: string,
      activeTab: "diffs" | "files" = "diffs",
      isVisible = true,
    ) => (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <SettingsModalProvider>
            <ToolsOwner
              isVisible={isVisible}
              applyTarget={async () => {}}
              repoPath="/repo"
              workspaceId="workspace"
              sessionId={sessionId}
              workingDirectory={workingDirectory}
              contextMode="worktree"
              currentBranch={{ name: branchKey, detached: false }}
              branchKey={branchKey}
              branchReady={true}
              target={{ branch: "main", remote: "origin" }}
              targetError={null}
              retryTarget={async () => {}}
              readBranch={async () => branchKey}
              isFilesActive={activeTab === "files"}
              selectedFile={null}
              onSelectFile={() => {}}
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
      await act(async () => {
        fireEvent.click(screen.getByTestId("agent-studio-git-pull-button"));
      });
      expect(screen.getByRole("dialog", { name: "Confirm pull with rebase" })).toBeTruthy();
      rendered.rerender(panel("session-a", "/repo/a", "branch:feature", "files"));
      rendered.rerender(panel("session-a", "/repo/a", "branch:feature"));
      expect(Boolean(screen.queryByRole("dialog", { name: "Confirm pull with rebase" }))).toBe(
        true,
      );
      rendered.rerender(panel("session-a", "/repo/a", "branch:feature", "diffs", false));
      expect(screen.queryByRole("dialog", { name: "Confirm pull with rebase" })).toBeNull();
      rendered.rerender(panel("session-a", "/repo/a", "branch:feature"));
      expect(screen.getByRole("dialog", { name: "Confirm pull with rebase" })).toBeTruthy();
      rendered.rerender(panel("session-b", "/repo/a", "branch:feature"));
      expect(screen.queryByRole("dialog", { name: "Confirm pull with rebase" })).toBeNull();
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
      await act(async () => {
        fireEvent.click(screen.getByTestId("agent-studio-git-pull-button"));
      });
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: "Pull with rebase" })),
      );
      expect(pull).toHaveBeenCalledWith("/repo", nextDirectory);
    } finally {
      await act(async () => {
        rendered.unmount();
        await queryClient.cancelQueries();
        queryClient.clear();
      });
      configureShellBridge(createUnavailableShellBridge());
    }
  },
);
