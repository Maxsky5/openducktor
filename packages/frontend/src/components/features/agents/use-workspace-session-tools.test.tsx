import type { HostClient } from "@openducktor/host-client";
import { expect, mock, spyOn, test } from "bun:test";
import type {
  GitComparisonTarget,
  GitTargetBranch,
  GitWorktreeStatus,
  GitWorktreeStatusSummary,
  WorkspaceFileTree,
  WorkspaceFileTreeRefreshInput,
  WorkspaceFileTreeRefreshResult,
} from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import { createQueryClient } from "@/lib/query-client";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createDeferred, createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { useWorkspaceSessionBranch } from "@/pages/workspace-sessions/use-workspace-session-branch";
import { useWorkspaceSessionTools, type WorkspaceToolsTabId } from "./use-workspace-session-tools";

type GitPushResult = Awaited<ReturnType<HostClient["gitPushBranch"]>>;
const targetReference = "origin/main";

const createToolsQueryClient = (settings = createSettingsSnapshotFixture()) => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(settingsSnapshotQueryOptions().queryKey, settings);
  return queryClient;
};

/** The target tab stays disabled until the comparison loads. */
const waitForTargetScope = () =>
  waitFor(() =>
    expect(screen.getByTestId("agent-studio-git-diff-scope-target").hasAttribute("disabled")).toBe(
      false,
    ),
  );

function worktreeStatus(
  targetBranch: string,
  diffScope: "target" | "uncommitted" = "uncommitted",
): GitWorktreeStatus {
  return {
    currentBranch: { name: "feature", detached: false },
    fileStatuses: [{ path: "draft.txt", status: "M", staged: false }],
    fileDiffs: [],
    targetAheadBehind: { ahead: 0, behind: 0 },
    upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
    snapshot: {
      effectiveWorkingDir: "/repo",
      targetBranch,
      diffScope,
      observedAtMs: 1,
      hashVersion: 1,
      statusHash: "0123456789abcdef",
      diffHash: "fedcba9876543210",
    },
  };
}

function worktreeSummary(targetBranch: string): GitWorktreeStatusSummary {
  const status = worktreeStatus(targetBranch);
  return {
    currentBranch: status.currentBranch,
    fileStatusCounts: { total: 1, staged: 0, unstaged: 1 },
    targetAheadBehind: status.targetAheadBehind,
    upstreamAheadBehind: status.upstreamAheadBehind,
    snapshot: status.snapshot,
  };
}

function PanelHarness({
  sessionId = "session-1",
  branchKey = "feature",
  branchReady = true,
  targetError = null,
  target = { branch: "@{upstream}" },
  retryTarget = async () => {},
  readBranch = async () => branchKey,
  contextMode = "repository",
  initialTabId = "git",
  onRefreshReady = () => {},
  isVisible = true,
  workingDirectory = "/repo",
}: {
  isVisible?: boolean;
  workingDirectory?: string;
  sessionId?: string;
  branchKey?: string;
  branchReady?: boolean;
  targetError?: string | null;
  target?: GitTargetBranch | null;
  retryTarget?: () => Promise<void>;
  readBranch?: () => Promise<string>;
  contextMode?: "repository" | "worktree";
  initialTabId?: WorkspaceToolsTabId;
  onRefreshReady?: (refresh: ReturnType<typeof useWorkspaceSessionTools>["refresh"]) => void;
}) {
  const [activeTabId, setActiveTabId] = useState<WorkspaceToolsTabId>(initialTabId);
  const { toolsContent, refresh } = useWorkspaceSessionTools({
    isVisible,
    applyTarget: async () => {},
    repoPath: "/repo",
    workspaceId: "workspace-1",
    sessionId: sessionId,
    workingDirectory,
    contextMode: contextMode,
    branchKey: branchKey,
    currentBranch: branchReady ? { name: branchKey, detached: false } : null,
    branchReady: branchReady,
    target: target,
    targetError: targetError,
    retryTarget: retryTarget,
    readBranch: readBranch,
    activeTabId: activeTabId,
    onActiveTabChange: setActiveTabId,
    selectedFile: null,
    onSelectFile: () => {},
  });
  useEffect(() => {
    onRefreshReady(refresh);
  }, [onRefreshReady, refresh]);
  return <SettingsModalProvider>{isVisible ? toolsContent : null}</SettingsModalProvider>;
}

test("reuses checked Git data when workspace sessions share a directory and comparison", async () => {
  const comparison = mock(async (): Promise<GitComparisonTarget> => ({
    kind: "available",
    reference: targetReference,
  }));
  const status = mock(
    async (_repo: string, target: string, scope: "target" | "uncommitted" = "uncommitted") =>
      worktreeStatus(target, scope),
  );
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: comparison,
        gitGetWorktreeStatus: status,
        gitGetWorktreeStatusSummary: async (_repo, target) => worktreeSummary(target),
        gitGetBranches: async () => [],
      },
    }),
  );
  const client = createToolsQueryClient();
  const panel = (sessionId: string) => (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <PanelHarness key={sessionId} sessionId={sessionId} />
      </ThemeProvider>
    </QueryClientProvider>
  );
  const view = render(panel("session-1"));
  try {
    expect(screen.getByTestId("agent-studio-git-current-branch").textContent).toBe("feature");
    await waitFor(() =>
      expect(screen.getByTestId("agent-studio-git-current-branch").textContent).toBe("feature"),
    );
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const reads = status.mock.calls.length;
    view.rerender(panel("session-2"));
    expect(screen.getByTestId("agent-studio-git-current-branch").textContent).toBe("feature");
    expect(screen.getByTestId("agent-studio-git-target-branch").textContent).toBe("origin/main");
    expect(screen.queryByText(/Checking comparison|Loading comparison/)).toBeNull();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(status).toHaveBeenCalledTimes(reads);
    expect(comparison).toHaveBeenCalledTimes(1);
    view.rerender(panel("session-1"));
    expect(screen.getByTestId("agent-studio-git-current-branch").textContent).toBe("feature");
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(status).toHaveBeenCalledTimes(reads);
  } finally {
    view.unmount();
    client.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("reads HEAD status while the comparison target is pending", async () => {
  let finishComparison!: (value: GitComparisonTarget) => void;
  const comparison = mock(
    () => new Promise<GitComparisonTarget>((resolve) => (finishComparison = resolve)),
  );
  const statusTargets: string[] = [];
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: comparison,
        gitGetWorktreeStatus: async (_repoPath: string, targetBranch: string) => {
          statusTargets.push(targetBranch);
          return worktreeStatus(targetBranch);
        },
        gitGetWorktreeStatusSummary: async (_repoPath: string, targetBranch: string) =>
          worktreeSummary(targetBranch),
        gitGetBranches: async () => [],
      },
    }),
  );
  const queryClient = createToolsQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  try {
    await waitFor(() => expect(comparison).toHaveBeenCalledTimes(1));
    expect(statusTargets).toEqual(["HEAD"]);
    await act(async () => finishComparison({ kind: "available", reference: targetReference }));
    await waitFor(() => expect(statusTargets).toContain(targetReference));
    expect(statusTargets).toContain("HEAD");
  } finally {
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test.each([
  { outcome: "branch found", key: "branch:feature" },
  { outcome: "branch read failed", key: "unknown" },
])("starts one comparison after the $outcome", async ({ key }) => {
  const comparison = mock(async (): Promise<GitComparisonTarget> => ({
    kind: "unavailable",
    reason: "No tracked upstream.",
  }));
  const statusTargets: string[] = [];
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: comparison,
        gitGetWorktreeStatus: async (_repoPath, targetBranch) => {
          statusTargets.push(targetBranch);
          return worktreeStatus(targetBranch);
        },
        gitGetWorktreeStatusSummary: async (_repoPath, targetBranch) =>
          worktreeSummary(targetBranch),
        gitGetBranches: async () => [],
      },
    }),
  );
  const queryClient = createToolsQueryClient();
  const panel = (branchKey: string, branchReady: boolean) => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PanelHarness branchKey={branchKey} branchReady={branchReady} />
      </ThemeProvider>
    </QueryClientProvider>
  );
  const view = render(panel("unknown", false));
  try {
    expect(comparison).not.toHaveBeenCalled();
    expect(statusTargets).toEqual([]);
    expect(screen.getByTestId("agent-studio-git-refresh-button").hasAttribute("disabled")).toBe(
      true,
    );

    view.rerender(panel(key, true));
    await waitFor(() => expect(statusTargets).toContain("HEAD"));
    expect(comparison).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

const treeSnapshot = (
  input: WorkspaceFileTreeRefreshInput,
  entries: WorkspaceFileTree["entries"] = [],
): WorkspaceFileTreeRefreshResult => ({
  kind: "snapshot",
  rootPath: input.rootPath,
  entries,
  context: {
    rootPath: input.rootPath,
    gitDirectory: `${input.rootPath}/.git`,
    branch: "feature",
    head: "head",
    targetBranch: input.targetBranch ?? null,
    targetRevision: input.targetBranch ? "target" : null,
    indexVersion: "index",
    sparsePolicy: "policy",
  },
  cursor: { viewId: "view", revision: 0 },
});

test.each(["available", "unavailable", "error"] as const)(
  "browses files while the %s comparison is pending",
  async (outcome) => {
    let finishComparison!: (value: GitComparisonTarget) => void;
    let failComparison!: (reason: Error) => void;
    const comparison = mock(
      () =>
        new Promise<GitComparisonTarget>((resolve, reject) => {
          finishComparison = resolve;
          failComparison = reject;
        }),
    );
    const treeReads: WorkspaceFileTreeRefreshInput[] = [];
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          gitGetComparisonTarget: comparison,
          gitGetWorktreeStatus: async (_repoPath, targetBranch) => worktreeStatus(targetBranch),
          gitGetWorktreeStatusSummary: async (_repoPath, targetBranch) =>
            worktreeSummary(targetBranch),
          gitGetBranches: async () => [],
          filesystemRefreshTree: async (input) => {
            treeReads.push(input);
            return treeSnapshot(input);
          },
        },
      }),
    );
    const queryClient = createToolsQueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <PanelHarness initialTabId="file_explorer" />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    try {
      await waitFor(() => expect(comparison).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(treeReads.length).toBeGreaterThan(0));
      expect(treeReads[0]?.targetBranch).toBeUndefined();
      await act(async () => {
        if (outcome === "error") {
          failComparison(new Error("Could not check comparison target"));
        } else {
          finishComparison(
            outcome === "available"
              ? { kind: "available", reference: targetReference }
              : { kind: "unavailable", reason: "No tracked upstream." },
          );
        }
      });
      await waitFor(() =>
        expect(treeReads.at(-1)?.targetBranch).toBe(
          outcome === "available" ? targetReference : undefined,
        ),
      );
    } finally {
      view.unmount();
      queryClient.clear();
      configureShellBridge(createUnavailableShellBridge());
    }
  },
);

test("a save refresh reads Git without reading the file tree again", async () => {
  const gitGetWorktreeStatus = mock(async (_repoPath: string, targetBranch: string) =>
    worktreeStatus(targetBranch),
  );
  const filesystemRefreshTree = mock(
    async (input: WorkspaceFileTreeRefreshInput): Promise<WorkspaceFileTreeRefreshResult> =>
      input.mode === "full"
        ? treeSnapshot(input)
        : {
            kind: "unchanged",
            rootPath: input.rootPath,
            context: {
              rootPath: input.rootPath,
              gitDirectory: `${input.rootPath}/.git`,
              branch: "feature",
              head: "head",
              targetBranch: input.targetBranch ?? null,
              targetRevision: input.targetBranch ? "target" : null,
              indexVersion: "index",
              sparsePolicy: "policy",
            },
            base: input.base,
            cursor: input.base,
          },
  );
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: async () => ({ kind: "available", reference: targetReference }),
        gitGetWorktreeStatus,
        gitGetWorktreeStatusSummary: async (_repoPath: string, targetBranch: string) =>
          worktreeSummary(targetBranch),
        gitGetBranches: async () => [],
        filesystemRefreshTree,
      },
    }),
  );
  let refresh: ((scope: "git" | "all") => Promise<void>) | null = null;
  const queryClient = createToolsQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PanelHarness onRefreshReady={(ready) => (refresh = ready)} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  try {
    await waitFor(() =>
      expect(gitGetWorktreeStatus.mock.calls.some(([, target]) => target === targetReference)).toBe(
        true,
      ),
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "File explorer" }), { button: 0 });
    await waitFor(() => expect(filesystemRefreshTree).toHaveBeenCalledTimes(1));
    await act(async () => {
      await refresh?.("git");
    });
    expect(filesystemRefreshTree).toHaveBeenCalledTimes(1);
    await act(async () => {
      await refresh?.("all");
    });
    expect(filesystemRefreshTree).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test.each(["repository settings", "comparison"] as const)(
  "reads local changes when the %s lookup fails",
  async (source) => {
    const targetError =
      source === "repository settings" ? "Could not load repository settings" : null;
    const comparison = mock(async (): Promise<GitComparisonTarget> => {
      throw new Error("Could not check comparison target");
    });
    const statusTargets: string[] = [];
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          gitGetComparisonTarget: comparison,
          gitGetWorktreeStatus: async (_repoPath: string, targetBranch: string) => {
            statusTargets.push(targetBranch);
            return worktreeStatus(targetBranch);
          },
          gitGetWorktreeStatusSummary: async (_repoPath: string, targetBranch: string) =>
            worktreeSummary(targetBranch),
          gitGetBranches: async () => [],
        },
      }),
    );
    const queryClient = createToolsQueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <PanelHarness contextMode="worktree" targetError={targetError} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    try {
      await waitFor(() => expect(statusTargets).toContain("HEAD"));
      expect(statusTargets.every((target) => target === "HEAD")).toBe(true);
      expect(
        await screen.findByText(targetError ?? "Could not check comparison target"),
      ).toBeTruthy();
      expect(comparison).toHaveBeenCalledTimes(source === "comparison" ? 1 : 0);
    } finally {
      view.unmount();
      queryClient.clear();
      configureShellBridge(createUnavailableShellBridge());
    }
  },
);

test.each(["recovers", "fails"] as const)(
  "manual refresh %s after a repository settings error",
  async (outcome) => {
    let fetched = false;
    const fetchRemote = mock(async () => {
      fetched = true;
      return { outcome: "fetched" as const, output: "" };
    });
    const comparison = mock(async (): Promise<GitComparisonTarget> =>
      fetched
        ? { kind: "available", reference: targetReference }
        : { kind: "unavailable", reason: "Remote target is missing." },
    );
    const statusTargets: string[] = [];
    let finishRetry!: () => void;
    const retry = mock(async () => {
      await new Promise<void>((resolve) => (finishRetry = resolve));
      if (outcome === "fails") throw new Error("Repository settings still unavailable");
    });
    const reportError = spyOn(toast, "error").mockImplementation(() => "toast-id");
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          gitGetComparisonTarget: comparison,
          gitFetchRemote: fetchRemote,
          gitGetWorktreeStatus: async (_repoPath: string, targetBranch: string) => {
            statusTargets.push(targetBranch);
            return worktreeStatus(targetBranch);
          },
          gitGetWorktreeStatusSummary: async (_repoPath: string, targetBranch: string) =>
            worktreeSummary(targetBranch),
          gitGetBranches: async () => [],
        },
      }),
    );
    function RetryPanel() {
      const [target, setTarget] = useState<GitTargetBranch | null>(null);
      const [targetError, setTargetError] = useState<string | null>(
        "Could not read repository settings",
      );
      return (
        <PanelHarness
          contextMode="worktree"
          target={target}
          targetError={targetError}
          retryTarget={async () => {
            await retry();
            setTarget({ remote: "origin", branch: "main" });
            setTargetError(null);
          }}
        />
      );
    }
    const queryClient = createToolsQueryClient();
    const treeKey = filesystemQueryKeys.tree("/repo", null, "feature");
    const textKey = filesystemQueryKeys.textFile("/repo", "draft.txt");
    queryClient.setQueryData(treeKey, { rootPath: "/repo", entries: [] });
    queryClient.setQueryData(textKey, "old text");
    const view = render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RetryPanel />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    try {
      await waitFor(() => expect(statusTargets).toContain("HEAD"));
      expect(screen.getByText("Could not read repository settings")).toBeTruthy();
      const refreshButton = screen.getByTestId("agent-studio-git-refresh-button");
      await waitFor(() => expect(refreshButton.hasAttribute("disabled")).toBe(false));
      fireEvent.click(refreshButton);
      await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(refreshButton.hasAttribute("disabled")).toBe(true));
      await act(async () => finishRetry());
      if (outcome === "recovers") {
        await waitFor(() => expect(statusTargets).toContain(targetReference));
        expect(screen.queryByText("Could not read repository settings")).toBeNull();
        expect(reportError).not.toHaveBeenCalled();
        expect(fetchRemote).toHaveBeenCalledTimes(1);
        await waitFor(() => {
          expect(queryClient.getQueryState(treeKey)?.isInvalidated).toBe(true);
          expect(queryClient.getQueryState(textKey)?.isInvalidated).toBe(true);
        });
      } else {
        await waitFor(() =>
          expect(reportError).toHaveBeenCalledWith("Could not refresh Git changes", {
            description: "Repository settings still unavailable",
          }),
        );
        expect(screen.getByText("Could not read repository settings")).toBeTruthy();
        expect(comparison).not.toHaveBeenCalled();
      }
    } finally {
      view.unmount();
      queryClient.clear();
      configureShellBridge(createUnavailableShellBridge());
      reportError.mockRestore();
    }
  },
);

test("rechecks a root chat target when its branch changes", async () => {
  let hasUpstream = true;
  const comparison = mock(async (): Promise<GitComparisonTarget> =>
    hasUpstream
      ? { kind: "available", reference: "@{upstream}" }
      : { kind: "unavailable", reason: "No tracked upstream." },
  );
  const statusTargets: string[] = [];
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: comparison,
        gitGetWorktreeStatus: async (_repoPath: string, targetBranch: string) => {
          statusTargets.push(targetBranch);
          return worktreeStatus(targetBranch);
        },
        gitGetWorktreeStatusSummary: async (_repoPath: string, targetBranch: string) =>
          worktreeSummary(targetBranch),
        gitGetBranches: async () => [],
      },
    }),
  );
  const queryClient = createToolsQueryClient();
  const panel = (branchKey: string) => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PanelHarness branchKey={branchKey} />
      </ThemeProvider>
    </QueryClientProvider>
  );
  const view = render(panel("first"));
  try {
    await waitFor(() => expect(statusTargets).toContain("@{upstream}"));
    hasUpstream = false;
    act(() => view.rerender(panel("second")));
    await screen.findByText("No tracked upstream.");
    await waitFor(() => expect(statusTargets).toContain("HEAD"));
    expect(comparison).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("manual refresh fetches before it reloads Git changes", async () => {
  const calls: string[] = [];
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: async () => ({ kind: "available", reference: targetReference }),
        gitFetchRemote: async () => {
          calls.push("fetch");
          return { outcome: "skipped_no_remote", output: "" };
        },
        gitGetWorktreeStatus: async (
          _repoPath: string,
          targetBranch: string,
          diffScope?: "target" | "uncommitted",
        ) => {
          calls.push(`status:${targetBranch}:${diffScope}`);
          return worktreeStatus(targetBranch, diffScope);
        },
        gitGetWorktreeStatusSummary: async (_repoPath: string, targetBranch: string) =>
          worktreeSummary(targetBranch),
        gitGetBranches: async () => [],
      },
    }),
  );
  const queryClient = createToolsQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  try {
    await waitFor(() => expect(calls.some((call) => call.startsWith("status:"))).toBe(true));
    calls.length = 0;
    await waitFor(() =>
      expect(screen.getByTestId("agent-studio-git-refresh-button").hasAttribute("disabled")).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByTestId("agent-studio-git-refresh-button"));
    await waitFor(() => expect(calls).toContain("fetch"));
    await waitFor(() => expect(calls.filter((call) => call.startsWith("status:"))).toHaveLength(2));
    expect(calls.indexOf("fetch")).toBeLessThan(
      calls.findIndex((call) => call.startsWith("status:")),
    );
    expect(calls.filter((call) => call === `status:${targetReference}:target`)).toHaveLength(1);
    expect(calls.filter((call) => call === "status:HEAD:uncommitted")).toHaveLength(1);
  } finally {
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("manual refresh retains data when branch and comparison identity stay unchanged", async () => {
  let finishBranchRead!: (branch: { name: string; detached: false }) => void;
  const releaseStatusRead = Promise.withResolvers<void>();
  let statusReadHeld = false;
  let holdNextStatusRead = false;
  const readBranch = mock(
    () =>
      new Promise<{ name: string; detached: false }>((resolve) => {
        finishBranchRead = resolve;
      }),
  );
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetCurrentBranch: readBranch,
        gitGetComparisonTarget: async () => ({ kind: "available", reference: targetReference }),
        gitFetchRemote: async () => ({ outcome: "skipped_no_remote" as const, output: "" }),
        gitGetWorktreeStatus: async (_repoPath, targetBranch) => {
          if (holdNextStatusRead) {
            holdNextStatusRead = false;
            statusReadHeld = true;
            await releaseStatusRead.promise;
          }
          return {
            ...worktreeStatus(targetBranch),
            fileDiffs: [
              {
                file: "draft.txt",
                type: "modified" as const,
                additions: 1,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+new\n",
              },
            ],
          };
        },
        gitGetWorktreeStatusSummary: async (_repoPath, targetBranch) =>
          worktreeSummary(targetBranch),
        gitGetBranches: async () => [],
      },
    }),
  );
  function BranchPanel() {
    const {
      rootBranch,
      branchKey,
      branchReady,
      readBranch: refreshBranch,
    } = useWorkspaceSessionBranch({
      repoPath: "/repo",
      workingDirectory: "/repo",
      isWorktree: false,
      isSwitchingBranch: false,
      activeBranch: { name: "feature", detached: false },
    });
    return (
      <>
        <output data-testid="branch-read-state">
          {rootBranch.isFetching ? "fetching" : "idle"}
        </output>
        <PanelHarness branchKey={branchKey} branchReady={branchReady} readBranch={refreshBranch} />
      </>
    );
  }
  const queryClient = createToolsQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BranchPanel />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  try {
    const diff = await screen.findByText("draft.txt");
    expect(screen.getByTestId("agent-studio-git-target-branch").textContent).toBe("origin/main");
    expect(screen.getByTestId("agent-studio-git-current-branch").textContent).toBe("feature");
    await waitFor(() =>
      expect(screen.getByTestId("agent-studio-git-refresh-button").hasAttribute("disabled")).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByTestId("agent-studio-git-refresh-button"));
    await waitFor(() => expect(readBranch).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("branch-read-state").textContent).toBe("fetching"),
    );
    expect(screen.getByTestId("agent-studio-git-current-branch").textContent).toBe("feature");
    expect(diff.isConnected).toBe(true);
    holdNextStatusRead = true;
    await act(async () => finishBranchRead({ name: "feature", detached: false }));
    await waitFor(() => expect(statusReadHeld).toBe(true));
    expect(screen.getByTestId("agent-studio-git-current-branch").textContent).toBe("feature");
    expect(diff.isConnected).toBe(true);
    await act(async () => releaseStatusRead.resolve());
  } finally {
    finishBranchRead?.({ name: "feature", detached: false });
    releaseStatusRead.resolve();
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("manual refresh reads a new branch before refreshing its comparison", async () => {
  const calls: string[] = [];
  let finishRead!: (branch: string) => void;
  const read = mock(() => new Promise<string>((resolve) => (finishRead = resolve)));
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: async () => {
          calls.push("comparison");
          return { kind: "available", reference: targetReference };
        },
        gitFetchRemote: async () => {
          calls.push("fetch");
          return { outcome: "skipped_no_remote", output: "" };
        },
        gitGetWorktreeStatus: async (_repoPath, targetBranch) => worktreeStatus(targetBranch),
        gitGetWorktreeStatusSummary: async (_repoPath, targetBranch) =>
          worktreeSummary(targetBranch),
        gitGetBranches: async () => [],
      },
    }),
  );
  function BranchPanel() {
    const [branchKey, setBranchKey] = useState("main");
    return (
      <PanelHarness
        branchKey={branchKey}
        readBranch={async () => {
          const next = await read();
          setBranchKey(next);
          return next;
        }}
      />
    );
  }
  const queryClient = createToolsQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BranchPanel />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  try {
    await waitFor(() => expect(calls).toContain("comparison"));
    const refreshButton = screen.getByTestId("agent-studio-git-refresh-button");
    await waitFor(() => expect(refreshButton.hasAttribute("disabled")).toBe(false));
    calls.length = 0;
    fireEvent.click(refreshButton);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([]);
    await act(async () => finishRead("feature"));
    await waitFor(() => expect(calls).toContain("comparison"));
    await waitFor(() => expect(calls).toContain("fetch"));
    expect(calls.indexOf("comparison")).toBeLessThan(calls.indexOf("fetch"));
  } finally {
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test.each(
  (["branch", "settings", "fetch", "comparison"] as const).flatMap((stage) =>
    (["hide", "directory", "branch"] as const)
      .filter(
        (change) =>
          (change !== "branch" || stage !== "settings") &&
          (change !== "directory" || stage !== "fetch"),
      )
      .map((change) => ({ stage, change })),
  ),
)("stops old refresh reads after $change during $stage", async ({ stage, change }) => {
  const hidden = change === "hide" || (change === "branch" && stage === "branch");
  const released = createDeferred<void>();
  const reads: string[] = [];
  let holdRead = false;
  let readStarted = false;
  const waitAt = async (step: typeof stage) => {
    if (step !== stage || !holdRead) return;
    holdRead = false;
    readStarted = true;
    await released.promise;
  };
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: async (_repo, directory) => {
          reads.push(`comparison:${directory}`);
          await waitAt("comparison");
          return stage === "fetch" || stage === "settings"
            ? { kind: "unavailable", reason: "Remote target is missing." }
            : { kind: "available", reference: targetReference };
        },
        gitFetchRemote: async (_repo, _target, directory) => {
          reads.push(`fetch:${directory}`);
          await waitAt("fetch");
          return { outcome: "fetched", output: "" };
        },
        gitGetWorktreeStatus: async (_repo, target, _scope, directory) => {
          reads.push(`status:${directory}`);
          return worktreeStatus(target);
        },
        gitGetWorktreeStatusSummary: async (_repo, target, directory) => {
          reads.push(`summary:${directory}`);
          return worktreeSummary(target);
        },
        gitGetBranches: async () => [],
      },
    }),
  );
  function RefreshPanel({
    isVisible,
    workingDirectory,
    branch,
  }: {
    isVisible: boolean;
    workingDirectory: string;
    branch: string | null;
  }) {
    const [branchKey, setBranchKey] = useState("feature");
    const [targetError, setTargetError] = useState<string | null>(
      stage === "settings" ? "Could not read repository settings" : null,
    );
    return (
      <PanelHarness
        isVisible={isVisible}
        workingDirectory={workingDirectory}
        branchKey={branch ?? branchKey}
        targetError={targetError}
        readBranch={async () => {
          await waitAt("branch");
          const next = stage === "branch" && hidden ? "other" : branchKey;
          setBranchKey(next);
          return next;
        }}
        retryTarget={async () => {
          await waitAt("settings");
          setTargetError(null);
        }}
      />
    );
  }
  const queryClient = createToolsQueryClient();
  const panel = (isVisible = true, workingDirectory = "/repo", branch: string | null = null) => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RefreshPanel isVisible={isVisible} workingDirectory={workingDirectory} branch={branch} />
      </ThemeProvider>
    </QueryClientProvider>
  );
  const view = render(panel());
  try {
    await waitFor(() => expect(reads.some((read) => read.startsWith("status:"))).toBe(true));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    holdRead = true;
    await act(async () => fireEvent.click(screen.getByTestId("agent-studio-git-refresh-button")));
    await waitFor(() => expect(readStarted).toBe(true));
    reads.length = 0;
    const nextDirectory = change === "directory" ? "/other" : "/repo";
    await act(async () =>
      view.rerender(panel(!hidden, nextDirectory, change === "branch" && !hidden ? "other" : null)),
    );
    if (!hidden) {
      await waitFor(() => expect(reads).toContain(`status:${nextDirectory}`));
    }
    reads.length = 0;
    await act(async () => released.resolve());
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    if (change !== "directory") {
      expect(reads).toEqual([]);
    } else {
      // Settings may enable reads in the new view, but the old refresh must stop.
      expect(reads.filter((read) => read.endsWith(":/repo") || read.startsWith("fetch:"))).toEqual(
        [],
      );
    }
    if (hidden) {
      await act(async () =>
        view.rerender(panel(true, "/repo", change === "branch" ? "third" : null)),
      );
      await waitFor(() => expect(queryClient.isFetching()).toBe(0));
      expect(screen.getByTestId("agent-studio-git-refresh-button").hasAttribute("disabled")).toBe(
        false,
      );
      expect(reads.some((read) => read.startsWith("comparison:"))).toBe(
        change === "branch" || stage === "settings" || stage === "branch",
      );
      if (change === "branch") expect(reads.some((read) => read.startsWith("fetch:"))).toBe(false);
    }
  } finally {
    released.resolve();
    await act(async () => {
      view.unmount();
      await queryClient.cancelQueries();
      queryClient.clear();
    });
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("manual refresh fetches a missing comparison target before checking it again", async () => {
  let fetched = false;
  const fetchRemote = mock(async (_repoPath: string, targetBranch: string) => {
    expect(targetBranch).toBe("@{upstream}");
    fetched = true;
    return { outcome: "fetched" as const, output: "" };
  });
  const comparison = mock(async (): Promise<GitComparisonTarget> =>
    fetched
      ? { kind: "available", reference: targetReference }
      : { kind: "unavailable", reason: "No tracked upstream." },
  );
  const statusTargets: string[] = [];
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: comparison,
        gitFetchRemote: fetchRemote,
        gitGetWorktreeStatus: async (_repoPath: string, targetBranch: string) => {
          statusTargets.push(targetBranch);
          return worktreeStatus(targetBranch);
        },
        gitGetWorktreeStatusSummary: async (_repoPath: string, targetBranch: string) =>
          worktreeSummary(targetBranch),
        gitGetBranches: async () => [],
      },
    }),
  );
  const queryClient = createToolsQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  try {
    await screen.findByText("No tracked upstream.");
    const refreshButton = screen.getByTestId("agent-studio-git-refresh-button");
    await waitFor(() => expect(refreshButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(refreshButton);
    await waitFor(() => expect(fetchRemote).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(statusTargets).toContain(targetReference));
    expect(comparison).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("a missing target fetch failure tells the user what failed", async () => {
  const reportError = spyOn(toast, "error").mockImplementation(() => "toast-id");
  const comparison = mock(async (): Promise<GitComparisonTarget> => ({
    kind: "unavailable",
    reason: "No tracked upstream.",
  }));
  const statusTargets: string[] = [];
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: comparison,
        gitFetchRemote: async () => {
          throw new Error("Current branch has no upstream remote");
        },
        gitGetWorktreeStatus: async (_repoPath: string, targetBranch: string) => {
          statusTargets.push(targetBranch);
          return worktreeStatus(targetBranch);
        },
        gitGetWorktreeStatusSummary: async (_repoPath: string, targetBranch: string) =>
          worktreeSummary(targetBranch),
        gitGetBranches: async () => [],
      },
    }),
  );
  const queryClient = createToolsQueryClient();
  const treeKey = filesystemQueryKeys.tree("/repo", null, "feature");
  queryClient.setQueryData(treeKey, { rootPath: "/repo", entries: [] });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  try {
    await screen.findByText("No tracked upstream.");
    await waitFor(() => expect(statusTargets).toContain("HEAD"));
    const localReads = statusTargets.length;
    await waitFor(() =>
      expect(screen.getByTestId("agent-studio-git-refresh-button").hasAttribute("disabled")).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByTestId("agent-studio-git-refresh-button"));
    await waitFor(() =>
      expect(reportError).toHaveBeenCalledWith("Could not refresh Git changes", {
        description: "Current branch has no upstream remote",
      }),
    );
    expect(comparison).toHaveBeenCalledTimes(1);
    expect(statusTargets.length).toBeGreaterThan(localReads);
    expect(queryClient.getQueryData(treeKey)).toBeDefined();
  } finally {
    view.unmount();
    queryClient.clear();
    reportError.mockRestore();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("returning to the app rechecks the target and file tree", async () => {
  const comparison = mock(async (): Promise<GitComparisonTarget> => ({
    kind: "available",
    reference: targetReference,
  }));
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: comparison,
        gitFetchRemote: async () => ({ outcome: "skipped_no_remote", output: "" }),
        gitGetWorktreeStatus: async (_repoPath: string, targetBranch: string) =>
          worktreeStatus(targetBranch),
        gitGetWorktreeStatusSummary: async (_repoPath: string, targetBranch: string) =>
          worktreeSummary(targetBranch),
        gitGetBranches: async () => [],
      },
    }),
  );
  const queryClient = createToolsQueryClient();
  const treeKey = filesystemQueryKeys.tree("/repo", targetReference, "feature");
  queryClient.setQueryData(treeKey, { rootPath: "/repo", entries: [] });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  try {
    await waitFor(() => expect(comparison).toHaveBeenCalledTimes(1));
    act(() => globalThis.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(comparison.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(queryClient.getQueryState(treeKey)?.isInvalidated).toBe(true));
  } finally {
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("refresh recovers local Git and file reads when the comparison target disappears", async () => {
  let targetAvailable = true;
  const comparison = mock(async (): Promise<GitComparisonTarget> =>
    targetAvailable
      ? { kind: "available", reference: targetReference }
      : { kind: "unavailable", reason: "Tracked upstream no longer exists." },
  );
  const statusTargets: string[] = [];
  const fileTreeTargets: Array<string | undefined> = [];
  const gitGetWorktreeStatus = mock(
    async (_repoPath: string, targetBranch: string, diffScope?: "target" | "uncommitted") => {
      statusTargets.push(targetBranch);
      if (!targetAvailable && targetBranch !== "HEAD") {
        throw new Error("Git status used the removed target");
      }
      return worktreeStatus(targetBranch, diffScope);
    },
  );
  const gitGetWorktreeStatusSummary = mock(async (_repoPath: string, targetBranch: string) => {
    if (!targetAvailable && targetBranch !== "HEAD") {
      throw new Error("Git summary used the removed target");
    }
    return worktreeSummary(targetBranch);
  });
  const filesystemRefreshTree = mock(
    async (input: WorkspaceFileTreeRefreshInput): Promise<WorkspaceFileTreeRefreshResult> => {
      fileTreeTargets.push(input.targetBranch);
      if (!targetAvailable && input.targetBranch) {
        throw new Error("File tree used the removed target");
      }
      return treeSnapshot(input, [
        {
          path: "draft.txt",
          kind: "file",
          size: 1,
          mtimeMs: 1,
          gitStatus: "modified",
        },
      ]);
    },
  );
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: comparison,
        gitFetchRemote: async () => ({ outcome: "skipped_no_remote", output: "" }),
        gitGetWorktreeStatus,
        gitGetWorktreeStatusSummary,
        filesystemRefreshTree,
        gitGetBranches: async () => [],
      },
    }),
  );
  const queryClient = createToolsQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  try {
    await waitFor(() => expect(statusTargets).toContain(targetReference));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "File explorer" }), { button: 0 });
    await waitFor(() => expect(fileTreeTargets).toContain(targetReference));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Git" }), { button: 0 });

    const comparisonReads = comparison.mock.calls.length;
    const staleStatusReads = statusTargets.filter((target) => target === targetReference).length;
    const staleFileTreeReads = fileTreeTargets.filter(
      (target) => target === targetReference,
    ).length;
    const neutralStatusReads = statusTargets.filter((target) => target === "HEAD").length;
    targetAvailable = false;
    const refreshButton = screen.getByTestId("agent-studio-git-refresh-button");
    await waitFor(() => expect(refreshButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(refreshButton);

    await waitFor(() => expect(comparison.mock.calls.length).toBeGreaterThan(comparisonReads));
    await screen.findByText("Tracked upstream no longer exists.");
    await waitFor(() =>
      expect(statusTargets.filter((target) => target === "HEAD").length).toBeGreaterThan(
        neutralStatusReads,
      ),
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "File explorer" }), { button: 0 });
    await waitFor(() =>
      expect(
        queryClient.getQueryData<WorkspaceFileTree>(
          filesystemQueryKeys.tree("/repo", null, "feature"),
        )?.entries,
      ).toHaveLength(1),
    );
    expect(fileTreeTargets).toContain(undefined);
    expect(statusTargets.filter((target) => target === targetReference)).toHaveLength(
      staleStatusReads,
    );
    expect(fileTreeTargets.filter((target) => target === targetReference)).toHaveLength(
      staleFileTreeReads,
    );
  } finally {
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test.each(
  (["commit", "push", "rebase", "reset"] as const).flatMap((kind) =>
    (["light", "dark"] as const).map((theme) => ({ kind, theme })),
  ),
)(
  "retains $kind busy and failure state when workspace tools close in $theme theme",
  async ({ kind, theme }) => {
    const completed = createDeferred<void>();
    const operation = mock(async () => {
      await completed.promise;
      throw new Error(`${kind} write failed`);
    });
    const readStatus = mock(async (_repo: string, target: string) => ({
      ...worktreeStatus(target),
      targetAheadBehind: { ahead: 0, behind: 2 },
      upstreamAheadBehind: { outcome: "tracking" as const, ahead: 2, behind: 0 },
      fileStatuses: kind === "rebase" ? [] : worktreeStatus(target).fileStatuses,
      fileDiffs:
        kind === "rebase"
          ? []
          : [
              {
                file: "draft.txt",
                type: "modified" as const,
                additions: 1,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+new\n",
              },
            ],
    }));
    const comparison = mock(async () => ({
      kind: "available" as const,
      reference: targetReference,
    }));
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          gitGetComparisonTarget: comparison,
          gitGetWorktreeStatus: readStatus,
          gitGetWorktreeStatusSummary: async (_repo, target) => worktreeSummary(target),
          [{
            commit: "gitCommitAll",
            push: "gitPushBranch",
            rebase: "gitRebaseBranch",
            reset: "gitResetWorktreeSelection",
          }[kind]]: operation,
        },
      }),
    );
    const queryClient = createToolsQueryClient(createSettingsSnapshotFixture({ theme }));
    const panel = (isVisible: boolean) => (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <PanelHarness isVisible={isVisible} contextMode="worktree" />
        </ThemeProvider>
      </QueryClientProvider>
    );
    const view = render(panel(true));
    const pushButton = () => screen.getByTestId("agent-studio-git-push-button");
    try {
      await waitFor(() => expect(pushButton().hasAttribute("disabled")).toBe(false));
      if (kind === "commit") {
        fireEvent.change(screen.getByTestId("agent-studio-git-commit-message-input"), {
          target: { value: "fix: retain operation" },
        });
        fireEvent.click(screen.getByTestId("agent-studio-git-commit-submit-button"));
      } else if (kind === "reset") {
        await waitFor(() =>
          expect(
            screen.getByTestId("agent-studio-git-reset-file-button").hasAttribute("disabled"),
          ).toBe(false),
        );
        fireEvent.click(screen.getByTestId("agent-studio-git-reset-file-button"));
        view.rerender(panel(false));
        view.rerender(panel(true));
        expect(screen.getByRole("dialog", { name: "Confirm file reset" })).toBeTruthy();
        await waitFor(() =>
          expect(
            screen.getByTestId("agent-studio-git-reset-file-button").hasAttribute("disabled"),
          ).toBe(false),
        );
        fireEvent.click(screen.getByTestId("agent-studio-git-confirm-reset-button"));
      } else {
        await waitFor(() =>
          expect(
            screen.getByTestId(`agent-studio-git-${kind}-button`).hasAttribute("disabled"),
          ).toBe(false),
        );
        fireEvent.click(screen.getByTestId(`agent-studio-git-${kind}-button`));
      }
      await waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
      view.rerender(panel(false));
      expect(screen.queryByRole("tablist", { name: "Workspace session tools" })).toBeNull();
      view.rerender(panel(true));
      const busyButton =
        kind === "reset"
          ? screen.getByTestId("agent-studio-git-confirm-reset-button")
          : pushButton();
      expect(busyButton.hasAttribute("disabled")).toBe(true);
      expect(pushButton().hasAttribute("disabled")).toBe(true);
      expect(
        screen.getByTestId("agent-studio-git-commit-message-input").hasAttribute("disabled"),
      ).toBe(true);
      fireEvent.click(busyButton);
      expect(operation).toHaveBeenCalledTimes(1);
      view.rerender(panel(false));
      const reads = readStatus.mock.calls.length;
      const comparisons = comparison.mock.calls.length;
      await act(async () => {
        globalThis.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
        completed.resolve();
      });
      expect(readStatus).toHaveBeenCalledTimes(reads);
      expect(comparison).toHaveBeenCalledTimes(comparisons);
      view.rerender(panel(true));
      await waitFor(() => expect(screen.getByText(`${kind} write failed`)).toBeTruthy());
      await waitFor(() => expect(pushButton().hasAttribute("disabled")).toBe(false));
      expect(operation).toHaveBeenCalledTimes(1);
      expect(document.documentElement.classList.contains(theme)).toBe(true);
    } finally {
      completed.resolve();
      view.unmount();
      queryClient.clear();
      configureShellBridge(createUnavailableShellBridge());
    }
  },
);

test("retains a force-push confirmation when the rejected push finishes with tools hidden", async () => {
  const completed = createDeferred<GitPushResult>();
  const push = mock(async () => completed.promise);
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: async () => ({ kind: "available", reference: targetReference }),
        gitGetWorktreeStatus: async (_repo, target) => ({
          ...worktreeStatus(target),
          upstreamAheadBehind: { outcome: "tracking", ahead: 2, behind: 0 },
        }),
        gitGetWorktreeStatusSummary: async (_repo, target) => worktreeSummary(target),
        gitPushBranch: push,
      },
    }),
  );
  const queryClient = createToolsQueryClient();
  const panel = (isVisible: boolean) => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PanelHarness isVisible={isVisible} />
      </ThemeProvider>
    </QueryClientProvider>
  );
  const view = render(panel(true));
  try {
    await waitFor(() =>
      expect(screen.getByTestId("agent-studio-git-push-button").hasAttribute("disabled")).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByTestId("agent-studio-git-push-button"));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    view.rerender(panel(false));
    await act(async () =>
      completed.resolve({
        outcome: "rejected_non_fast_forward",
        branch: "feature",
        remote: "origin",
        output: "non-fast-forward",
      }),
    );
    view.rerender(panel(true));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Confirm force push" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("agent-studio-git-confirm-force-push-button"));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(2));
    expect(push).toHaveBeenLastCalledWith("/repo", "feature", {
      setUpstream: true,
      forceWithLease: true,
      workingDir: "/repo",
    });
  } finally {
    completed.resolve({ outcome: "pushed", remote: "origin", branch: "feature", output: "done" });
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("invalidates a completed hidden commit without reading Git until tools reopen", async () => {
  const completed = createDeferred<void>();
  const commit = mock(async () => {
    await completed.promise;
    return { outcome: "committed" as const, commitHash: "abc123", output: "committed" };
  });
  const readStatus = mock(async (_repo: string, target: string) => worktreeStatus(target));
  const comparison = mock(async () => ({ kind: "available" as const, reference: targetReference }));
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: comparison,
        gitGetWorktreeStatus: readStatus,
        gitGetWorktreeStatusSummary: async (_repo, target) => worktreeSummary(target),
        gitCommitAll: commit,
      },
    }),
  );
  const queryClient = createToolsQueryClient();
  const panel = (isVisible: boolean) => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PanelHarness isVisible={isVisible} />
      </ThemeProvider>
    </QueryClientProvider>
  );
  const view = render(panel(true));
  try {
    await waitFor(() =>
      expect(
        screen.getByTestId("agent-studio-git-commit-message-input").hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.change(screen.getByTestId("agent-studio-git-commit-message-input"), {
      target: { value: "fix: retain commit" },
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("agent-studio-git-commit-submit-button").hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(screen.getByTestId("agent-studio-git-commit-submit-button"));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    view.rerender(panel(false));
    const reads = readStatus.mock.calls.length;
    const comparisons = comparison.mock.calls.length;
    await act(async () => {
      completed.resolve();
      globalThis.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(readStatus).toHaveBeenCalledTimes(reads);
    expect(comparison).toHaveBeenCalledTimes(comparisons);
    view.rerender(panel(true));
    await waitFor(() => expect(readStatus.mock.calls.length).toBeGreaterThan(reads));
    await waitFor(() =>
      expect(
        screen.getByTestId("agent-studio-git-commit-message-input").hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(commit).toHaveBeenCalledTimes(1);
  } finally {
    completed.resolve();
    view.unmount();
    queryClient.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("a failed fetch refreshes both diff tabs and reports the fetch error", async () => {
  let revision = 1;
  const report = spyOn(toast, "error").mockImplementation(() => "toast-id");
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: async () => ({ kind: "available", reference: "refs/heads/main" }),
        gitGetBranches: async () => [],
        gitFetchRemote: async () => {
          throw new Error("Check the remote connection.");
        },
        gitGetWorktreeStatus: async (_repo, target, scope = "uncommitted") => ({
          ...worktreeStatus(target, scope),
          fileStatuses: [{ path: `${scope}-${revision}.txt`, status: "M", staged: false }],
          fileDiffs: [
            {
              file: `${scope}-${revision}.txt`,
              type: "modified",
              additions: 1,
              deletions: 1,
              diff: "@@ -1 +1 @@\n-before\n+after\n",
            },
          ],
        }),
      },
    }),
  );
  const client = createToolsQueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  try {
    await screen.findByText("uncommitted-1.txt");
    await waitForTargetScope();
    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId("agent-studio-git-diff-scope-target"), {
        button: 0,
        ctrlKey: false,
      });
    });
    await screen.findByText("target-1.txt");
    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId("agent-studio-git-diff-scope-uncommitted"), {
        button: 0,
        ctrlKey: false,
      });
    });
    await screen.findByText("uncommitted-1.txt");
    revision = 2;
    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-studio-git-refresh-button"));
    });
    await waitFor(() =>
      expect(report).toHaveBeenCalledWith("Could not refresh Git changes", {
        description: "Check the remote connection.",
      }),
    );
    await screen.findByText("uncommitted-2.txt");
    await waitForTargetScope();
    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId("agent-studio-git-diff-scope-target"), {
        button: 0,
        ctrlKey: false,
      });
    });
    await screen.findByText("target-2.txt");
  } finally {
    view.unmount();
    client.clear();
    report.mockRestore();
    configureShellBridge(createUnavailableShellBridge());
  }
});
