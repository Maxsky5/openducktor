import { expect, mock, spyOn, test } from "bun:test";
import type {
  GitComparisonTarget,
  GitTargetBranch,
  GitWorktreeStatus,
  GitWorktreeStatusSummary,
  WorkspaceFileTree,
} from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { toast } from "sonner";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { createQueryClient } from "@/lib/query-client";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import {
  WorkspaceSessionToolsPanel,
  type WorkspaceToolsTabId,
} from "./workspace-session-tools-panel";

const targetReference = "origin/main";

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
  branchKey = "feature",
  branchReady = true,
  targetError = null,
  target = { branch: "@{upstream}" },
  retryTarget = async () => {},
  contextMode = "repository",
  initialTabId = "git",
  onRefreshReady = () => {},
}: {
  branchKey?: string;
  branchReady?: boolean;
  targetError?: string | null;
  target?: GitTargetBranch | null;
  retryTarget?: () => Promise<void>;
  contextMode?: "repository" | "worktree";
  initialTabId?: WorkspaceToolsTabId;
  onRefreshReady?: Parameters<typeof WorkspaceSessionToolsPanel>[0]["onRefreshReady"];
}) {
  const [activeTabId, setActiveTabId] = useState<WorkspaceToolsTabId>(initialTabId);
  return (
    <WorkspaceSessionToolsPanel
      repoPath="/repo"
      workingDirectory="/repo"
      contextMode={contextMode}
      branchKey={branchKey}
      branchReady={branchReady}
      target={target}
      targetError={targetError}
      retryTarget={retryTarget}
      activeTabId={activeTabId}
      onActiveTabChange={setActiveTabId}
      selectedFile={null}
      onSelectFile={() => {}}
      onRefreshReady={onRefreshReady}
    />
  );
}

test("waits for the comparison target before reading Git status", async () => {
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
  const queryClient = createQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  try {
    await waitFor(() => expect(comparison).toHaveBeenCalledTimes(1));
    expect(statusTargets).toEqual([]);
    await act(async () => finishComparison({ kind: "available", reference: targetReference }));
    await waitFor(() => expect(statusTargets).toContain(targetReference));
    expect(statusTargets).not.toContain("HEAD");
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
  const queryClient = createQueryClient();
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

test.each(["available", "unavailable", "error"] as const)(
  "holds the file tree until the %s comparison outcome",
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
    const treeReads: Array<string | { rootPath: string; targetBranch?: string | null }> = [];
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          gitGetComparisonTarget: comparison,
          gitGetWorktreeStatus: async (_repoPath, targetBranch) => worktreeStatus(targetBranch),
          gitGetWorktreeStatusSummary: async (_repoPath, targetBranch) =>
            worktreeSummary(targetBranch),
          gitGetBranches: async () => [],
          filesystemListTree: async (input) => {
            treeReads.push(input);
            return { rootPath: "/repo", entries: [] };
          },
        },
      }),
    );
    const queryClient = createQueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <PanelHarness initialTabId="file_explorer" />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    try {
      await waitFor(() => expect(comparison).toHaveBeenCalledTimes(1));
      expect(treeReads).toEqual([]);
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
      await waitFor(() => expect(treeReads).toHaveLength(1));
      expect(treeReads).toEqual([
        outcome === "available"
          ? { rootPath: "/repo", targetBranch: targetReference }
          : { rootPath: "/repo" },
      ]);
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
  const filesystemListTree = mock(
    async (input: { rootPath: string }): Promise<WorkspaceFileTree> => ({
      rootPath: input.rootPath,
      entries: [],
    }),
  );
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: async () => ({ kind: "available", reference: targetReference }),
        gitGetWorktreeStatus,
        gitGetWorktreeStatusSummary: async (_repoPath: string, targetBranch: string) =>
          worktreeSummary(targetBranch),
        gitGetBranches: async () => [],
        filesystemListTree,
      },
    }),
  );
  let refresh: ((scope: "git" | "all") => Promise<void>) | null = null;
  const queryClient = createQueryClient();
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
    await waitFor(() => expect(filesystemListTree).toHaveBeenCalledTimes(1));
    await act(async () => {
      await refresh?.("git");
    });
    expect(filesystemListTree).toHaveBeenCalledTimes(1);
    await act(async () => {
      await refresh?.("all");
    });
    expect(filesystemListTree).toHaveBeenCalledTimes(2);
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
    const queryClient = createQueryClient();
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
    const queryClient = createQueryClient();
    const treeKey = filesystemQueryKeys.tree("/repo", null);
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
  const queryClient = createQueryClient();
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
  const queryClient = createQueryClient();
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
    fireEvent.click(screen.getByTestId("agent-studio-git-refresh-button"));
    await waitFor(() => expect(calls).toContain("fetch"));
    await waitFor(() => expect(calls.filter((call) => call.startsWith("status:"))).toHaveLength(2));
    expect(calls.indexOf("fetch")).toBeLessThan(
      calls.findIndex((call) => call.startsWith("status:")),
    );
    expect(calls.filter((call) => call === `status:${targetReference}:target`)).toHaveLength(1);
    expect(calls.filter((call) => call === `status:${targetReference}:uncommitted`)).toHaveLength(
      1,
    );
  } finally {
    view.unmount();
    queryClient.clear();
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
  const queryClient = createQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  try {
    await screen.findByText("No tracked upstream.");
    fireEvent.click(screen.getByTestId("agent-studio-git-refresh-button"));
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
  const queryClient = createQueryClient();
  const treeKey = filesystemQueryKeys.tree("/repo", null);
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
    fireEvent.click(screen.getByTestId("agent-studio-git-refresh-button"));
    await waitFor(() =>
      expect(reportError).toHaveBeenCalledWith("Could not refresh Git changes", {
        description: "Current branch has no upstream remote",
      }),
    );
    await waitFor(() => expect(comparison).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(statusTargets.length).toBeGreaterThan(localReads));
    await waitFor(() => expect(queryClient.getQueryState(treeKey)?.isInvalidated).toBe(true));
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
  const queryClient = createQueryClient();
  const treeKey = filesystemQueryKeys.tree("/repo", targetReference);
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
  const filesystemListTree = mock(
    async (input: { rootPath: string; targetBranch?: string }): Promise<WorkspaceFileTree> => {
      fileTreeTargets.push(input.targetBranch);
      if (!targetAvailable && input.targetBranch) {
        throw new Error("File tree used the removed target");
      }
      return {
        rootPath: input.rootPath,
        entries: [
          {
            path: "draft.txt",
            kind: "file",
            size: 1,
            mtimeMs: 1,
            gitStatus: "modified",
          },
        ],
      };
    },
  );
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitGetComparisonTarget: comparison,
        gitGetWorktreeStatus,
        gitGetWorktreeStatusSummary,
        filesystemListTree,
        gitGetBranches: async () => [],
      },
    }),
  );
  const queryClient = createQueryClient();
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
        queryClient.getQueryData<WorkspaceFileTree>(filesystemQueryKeys.tree("/repo", null))
          ?.entries,
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
