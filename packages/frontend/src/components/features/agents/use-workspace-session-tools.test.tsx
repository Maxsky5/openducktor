import type { HostClient } from "@openducktor/host-client";
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type {
  GitComparisonTarget,
  GitTargetBranch,
  GitWorktreeStatus,
  WorkspaceFileTree,
  WorkspaceFileTreeRefreshInput,
  WorkspaceFileTreeRefreshResult,
} from "@openducktor/contracts";
import { CancelledError } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { SettingsModalProvider } from "@/components/features/settings/settings-modal";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { createDeferred, createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { filesystemQueryKeys } from "@openducktor/frontend-core/queries/filesystem";
import { useWorkspaceSessionBranch } from "@/pages/workspace-sessions/use-workspace-session-branch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toLocalChanges } from "@/features/agent-studio-git/test-support/local-changes-fixture";
import { useGitPanelViewStore } from "./agent-studio-git-panel/git-panel-view-store";
import type { TaskExecutionSelectedFile } from "./task-execution-file-explorer-model";
import { useWorkspaceSessionTools } from "./use-workspace-session-tools";

type HarnessTab = "diffs" | "files";

// The panel keeps its tab and commit draft in app memory. Each test starts from an empty view.
afterEach(() => {
  useGitPanelViewStore.setState({ views: {} });
});

type GitPushResult = Awaited<ReturnType<HostClient["gitPushBranch"]>>;
const targetReference = "origin/main";

const createToolsConnection = (
  client: Partial<HostClient>,
  settings = createSettingsSnapshotFixture(),
) => {
  const connection = createTestClientConnection({ client });
  connection.queryClient.setQueryData(settingsSnapshotQueryOptions().queryKey, settings);
  return connection;
};

/**
 * Local changes come from the HEAD fixture of the status fake.
 * A HEAD status call in a test fake still marks one local changes read.
 */
const withLocalChanges = (client: Partial<HostClient>): Partial<HostClient> => {
  const readStatus = client.gitGetWorktreeStatus;
  if (!readStatus) return client;
  return {
    gitGetLocalChanges: async (repoPath, workingDir) =>
      toLocalChanges(await readStatus(repoPath, "HEAD", "uncommitted", workingDir)),
    ...client,
  };
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

function PanelHarness({
  sessionId = "session-1",
  branchKey = "feature",
  branchReady = true,
  targetError = null,
  target = { branch: "@{upstream}" },
  targetChoice = null,
  retryTarget = async () => {},
  readBranch = async () => branchKey,
  contextMode = "repository",
  initialTabId = "diffs",
  onRefreshReady = () => {},
  isVisible = true,
  workingDirectory = "/repo",
  onSelectFile = () => {},
}: {
  isVisible?: boolean;
  workingDirectory?: string;
  onSelectFile?: (file: TaskExecutionSelectedFile) => false | void;
  sessionId?: string;
  branchKey?: string;
  branchReady?: boolean;
  targetError?: string | null;
  target?: GitTargetBranch | null;
  targetChoice?: GitTargetBranch | null;
  retryTarget?: () => Promise<void>;
  readBranch?: () => Promise<string>;
  contextMode?: "repository" | "worktree";
  initialTabId?: HarnessTab;
  onRefreshReady?: (refresh: ReturnType<typeof useWorkspaceSessionTools>["refresh"]) => void;
}) {
  const [activeTabId, setActiveTabId] = useState<HarnessTab>(initialTabId);
  const { diffsContent, filesContent, refresh } = useWorkspaceSessionTools({
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
    targetChoice,
    targetError: targetError,
    retryTarget: retryTarget,
    readBranch: readBranch,
    isFilesActive: isVisible && activeTabId === "files",
    selectedFile: null,
    onSelectFile,
  });
  useEffect(() => {
    onRefreshReady(refresh);
  }, [onRefreshReady, refresh]);
  // A small stand-in for the right panel tabs. The tools hook does not own tabs.
  return (
    <SettingsModalProvider>
      {isVisible ? (
        <Tabs
          value={activeTabId}
          onValueChange={(value) => setActiveTabId(value === "files" ? "files" : "diffs")}
        >
          <TabsList>
            <TabsTrigger value="diffs">Diffs</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
          </TabsList>
          <TabsContent value="diffs">{diffsContent}</TabsContent>
          <TabsContent value="files" forceMount hidden={activeTabId !== "files"}>
            {filesContent}
          </TabsContent>
        </Tabs>
      ) : null}
    </SettingsModalProvider>
  );
}

test("opens the file preview of a changed file from its Git row menu", async () => {
  const toolsHost: Partial<HostClient> = withLocalChanges({
    gitGetComparisonTarget: async () => ({ kind: "available", reference: targetReference }),
    gitGetWorktreeStatus: async (_repo, target, scope = "uncommitted") => ({
      ...worktreeStatus(target, scope),
      fileDiffs: [
        {
          file: "draft.txt",
          type: "modified" as const,
          additions: 1,
          deletions: 1,
          diff: "@@ -1 +1 @@\n-old\n+new\n",
        },
      ],
    }),
    gitGetBranches: async () => [],
  });
  const onSelectFile = mock((_file: TaskExecutionSelectedFile) => {});
  render(
    <ClientConnectionProvider connection={createToolsConnection(toolsHost)}>
      <ThemeProvider>
        <PanelHarness onSelectFile={onSelectFile} />
      </ThemeProvider>
    </ClientConnectionProvider>,
  );

  const row = await screen.findByRole("button", { name: "Toggle diff for draft.txt" });
  fireEvent.contextMenu(row, { button: 2, clientX: 20, clientY: 40 });
  fireEvent.click(await screen.findByRole("menuitem", { name: "View file" }));

  expect(onSelectFile.mock.calls).toEqual([[{ rootPath: "/repo", relativePath: "draft.txt" }]]);
});

test("reuses checked Git data when workspace sessions share a directory and comparison", async () => {
  const comparison = mock(async (): Promise<GitComparisonTarget> => ({
    kind: "available",
    reference: targetReference,
  }));
  const status = mock(
    async (_repo: string, target: string, scope: "target" | "uncommitted" = "uncommitted") =>
      worktreeStatus(target, scope),
  );
  const toolsHost: Partial<HostClient> = withLocalChanges({
    gitGetComparisonTarget: comparison,
    gitGetWorktreeStatus: status,
    gitGetBranches: async () => [],
  });
  const connection = createToolsConnection(toolsHost);
  const client = connection.queryClient;
  const panel = (sessionId: string) => (
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <PanelHarness key={sessionId} sessionId={sessionId} />
      </ThemeProvider>
    </ClientConnectionProvider>
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
  }
});

test("reads HEAD status while the comparison target is pending", async () => {
  let finishComparison!: (value: GitComparisonTarget) => void;
  const comparison = mock(
    () => new Promise<GitComparisonTarget>((resolve) => (finishComparison = resolve)),
  );
  const statusTargets: string[] = [];
  const toolsHost: Partial<HostClient> = withLocalChanges({
    gitGetComparisonTarget: comparison,
    gitGetWorktreeStatus: async (_repoPath: string, targetBranch: string) => {
      statusTargets.push(targetBranch);
      return worktreeStatus(targetBranch);
    },
    gitGetBranches: async () => [],
  });
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </ClientConnectionProvider>,
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
  }
});

test.each(["available", "unavailable"] as const)(
  "keeps Branch changes selected while its comparison loads and when it is %s",
  async (outcome) => {
    let finishComparison!: (value: GitComparisonTarget) => void;
    const comparison = mock(
      () => new Promise<GitComparisonTarget>((resolve) => (finishComparison = resolve)),
    );
    const reads: string[] = [];
    const toolsHost: Partial<HostClient> = withLocalChanges({
      gitGetComparisonTarget: comparison,
      gitGetWorktreeStatus: async (_repo, targetBranch, diffScope = "uncommitted") => {
        reads.push(`${diffScope}:${targetBranch}`);
        return worktreeStatus(targetBranch, diffScope);
      },
      gitGetBranches: async () => [],
    });
    const connection = createToolsConnection(toolsHost);
    const queryClient = connection.queryClient;
    const view = render(
      <ClientConnectionProvider connection={connection}>
        <ThemeProvider>
          <PanelHarness />
        </ThemeProvider>
      </ClientConnectionProvider>,
    );
    const branchTab = () => screen.getByTestId("agent-studio-git-diff-scope-target");
    try {
      await waitFor(() => expect(comparison).toHaveBeenCalledTimes(1));
      await act(async () => {
        fireEvent.mouseDown(branchTab(), { button: 0 });
      });
      expect(branchTab().getAttribute("aria-selected")).toBe("true");
      expect(screen.getByText(/^Checking /)).toBeTruthy();

      await act(async () =>
        finishComparison(
          outcome === "available"
            ? { kind: "available", reference: targetReference }
            : { kind: "unavailable", reason: "Remote target is missing." },
        ),
      );

      if (outcome === "available") {
        await waitFor(() => expect(reads).toContain(`target:${targetReference}`));
      } else {
        await screen.findByText("Branch changes are unavailable");
      }
      expect(branchTab().getAttribute("aria-selected")).toBe("true");
    } finally {
      view.unmount();
      queryClient.clear();
    }
  },
);

test.each([
  { outcome: "branch found", key: "branch:feature" },
  { outcome: "branch read failed", key: "unknown" },
])("starts one comparison after the $outcome", async ({ key }) => {
  const comparison = mock(async (): Promise<GitComparisonTarget> => ({
    kind: "unavailable",
    reason: "No tracked upstream.",
  }));
  const statusTargets: string[] = [];
  const toolsHost: Partial<HostClient> = withLocalChanges({
    gitGetComparisonTarget: comparison,
    gitGetWorktreeStatus: async (_repoPath, targetBranch) => {
      statusTargets.push(targetBranch);
      return worktreeStatus(targetBranch);
    },
    gitGetBranches: async () => [],
  });
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const panel = (branchKey: string, branchReady: boolean) => (
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <PanelHarness branchKey={branchKey} branchReady={branchReady} />
      </ThemeProvider>
    </ClientConnectionProvider>
  );
  const view = render(panel("unknown", false));
  try {
    expect(comparison).not.toHaveBeenCalled();
    expect(statusTargets).toEqual([]);
    const refreshButton = screen.getByTestId("agent-studio-git-refresh-button");
    expect(refreshButton.getAttribute("aria-busy")).toBe("true");
    // Refresh waits for the branch. It must not start a Git read before it.
    await act(async () => fireEvent.click(refreshButton));
    expect(comparison).not.toHaveBeenCalled();
    expect(statusTargets).toEqual([]);

    view.rerender(panel(key, true));
    await waitFor(() => expect(statusTargets).toContain("HEAD"));
    expect(comparison).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    queryClient.clear();
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
    const toolsHost: Partial<HostClient> = withLocalChanges({
      gitGetComparisonTarget: comparison,
      gitGetWorktreeStatus: async (_repoPath, targetBranch) => worktreeStatus(targetBranch),
      gitGetBranches: async () => [],
      filesystemRefreshTree: async (input) => {
        treeReads.push(input);
        return treeSnapshot(input);
      },
    });
    const connection = createToolsConnection(toolsHost);
    const queryClient = connection.queryClient;
    const view = render(
      <ClientConnectionProvider connection={connection}>
        <ThemeProvider>
          <PanelHarness initialTabId="files" />
        </ThemeProvider>
      </ClientConnectionProvider>,
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
    }
  },
);

test.each(["repository settings", "comparison"] as const)(
  "reads local changes when the %s lookup fails",
  async (source) => {
    const targetError =
      source === "repository settings" ? "Could not load repository settings" : null;
    const comparison = mock(async (): Promise<GitComparisonTarget> => {
      throw new Error("Could not check comparison target");
    });
    const statusTargets: string[] = [];
    const toolsHost: Partial<HostClient> = withLocalChanges({
      gitGetComparisonTarget: comparison,
      gitGetWorktreeStatus: async (_repoPath: string, targetBranch: string) => {
        statusTargets.push(targetBranch);
        return worktreeStatus(targetBranch);
      },
      gitGetBranches: async () => [],
    });
    const connection = createToolsConnection(toolsHost);
    const queryClient = connection.queryClient;
    const view = render(
      <ClientConnectionProvider connection={connection}>
        <ThemeProvider>
          <PanelHarness contextMode="worktree" targetError={targetError} />
        </ThemeProvider>
      </ClientConnectionProvider>,
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
    const toolsHost: Partial<HostClient> = withLocalChanges({
      gitGetComparisonTarget: comparison,
      gitFetchRemote: fetchRemote,
      gitGetWorktreeStatus: async (_repoPath: string, targetBranch: string) => {
        statusTargets.push(targetBranch);
        return worktreeStatus(targetBranch);
      },
      gitGetBranches: async () => [],
    });
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
    const connection = createToolsConnection(toolsHost);
    const queryClient = connection.queryClient;
    const treeKey = filesystemQueryKeys.tree("/repo", null, "feature");
    const textKey = filesystemQueryKeys.textFile("/repo", "draft.txt");
    queryClient.setQueryData(treeKey, { rootPath: "/repo", entries: [] });
    queryClient.setQueryData(textKey, "old text");
    const view = render(
      <ClientConnectionProvider connection={connection}>
        <ThemeProvider>
          <RetryPanel />
        </ThemeProvider>
      </ClientConnectionProvider>,
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
        // A manual Refresh drops the inactive tree and reads file text again.
        await waitFor(() => {
          expect(queryClient.getQueryState(treeKey)).toBeUndefined();
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
  const toolsHost: Partial<HostClient> = withLocalChanges({
    gitGetComparisonTarget: comparison,
    gitGetWorktreeStatus: async (_repoPath: string, targetBranch: string) => {
      statusTargets.push(targetBranch);
      return worktreeStatus(targetBranch);
    },
    gitGetBranches: async () => [],
  });
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const panel = (branchKey: string) => (
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <PanelHarness branchKey={branchKey} />
      </ThemeProvider>
    </ClientConnectionProvider>
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
  }
});

/** A Git host that records each read. After `hold`, the fetch waits for `release`. */
function createHeldFetchHost() {
  const reads: string[] = [];
  const fetchGate = createDeferred<void>();
  let holdFetch = false;
  const client: Partial<HostClient> = {
    gitGetComparisonTarget: async () => ({ kind: "available", reference: targetReference }),
    gitFetchRemote: async () => {
      reads.push("fetch");
      if (holdFetch) await fetchGate.promise;
      return { outcome: "skipped_no_remote", output: "" };
    },
    gitGetLocalChanges: async () => {
      reads.push("local");
      return toLocalChanges(worktreeStatus("HEAD"));
    },
    gitGetWorktreeStatus: async (_repoPath, targetBranch, diffScope = "uncommitted") => {
      reads.push(`status:${diffScope}`);
      return worktreeStatus(targetBranch, diffScope);
    },
    gitGetHistoryPage: async () => {
      reads.push("history");
      return { outcome: "no_commits" };
    },
    gitGetBranches: async () => [],
  };
  return {
    reads,
    client,
    hold: () => {
      holdFetch = true;
    },
    release: () => fetchGate.resolve(),
  };
}

test("manual refresh reads local changes during the fetch and again with the comparison after it", async () => {
  const host = createHeldFetchHost();
  const toolsHost: Partial<HostClient> = host.client;
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </ClientConnectionProvider>,
  );
  try {
    await waitForTargetScope();
    // The open History tab keeps its read active, so a refresh reads History again.
    fireEvent.mouseDown(screen.getByTestId("agent-studio-git-tab-history"), { button: 0 });
    await waitFor(() => expect(host.reads).toContain("history"));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    host.reads.length = 0;
    host.hold();
    fireEvent.click(screen.getByTestId("agent-studio-git-refresh-button"));
    await waitFor(() => expect(host.reads.toSorted()).toEqual(["fetch", "local"]));
    // Query notifications use a timer. Flush them while the fetch stays pending.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(host.reads.toSorted()).toEqual(["fetch", "local"]);
    await act(async () => host.release());
    // The fetch moves the remote branches, so the upstream counts of local changes read again.
    await waitFor(() =>
      expect(host.reads.slice(2).toSorted()).toEqual(["history", "local", "status:target"]),
    );
  } finally {
    host.release();
    view.unmount();
    queryClient.clear();
  }
});

test("manual refresh shows pending before the fetch ends and joins a second click", async () => {
  const host = createHeldFetchHost();
  const readBranch = mock(async () => "feature");
  const toolsHost: Partial<HostClient> = host.client;
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <PanelHarness readBranch={readBranch} />
      </ThemeProvider>
    </ClientConnectionProvider>,
  );
  try {
    await waitForTargetScope();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    const refreshButton = screen.getByTestId("agent-studio-git-refresh-button");
    await waitFor(() => expect(refreshButton.getAttribute("aria-busy")).toBeNull());
    host.reads.length = 0;
    host.hold();
    act(() => {
      fireEvent.click(refreshButton);
      // React has not rendered the pending state yet, so the second click reaches the handler.
      expect(refreshButton.hasAttribute("disabled")).toBe(false);
      fireEvent.click(refreshButton);
    });
    // The pending state shows before the branch read and the fetch end.
    expect(refreshButton.hasAttribute("disabled")).toBe(true);
    expect(refreshButton.getAttribute("aria-busy")).toBe("true");
    await waitFor(() => expect(host.reads).toContain("fetch"));
    expect(refreshButton.hasAttribute("disabled")).toBe(true);
    await act(async () => host.release());
    await waitFor(() => expect(refreshButton.hasAttribute("disabled")).toBe(false));
    expect(readBranch).toHaveBeenCalledTimes(1);
    expect(host.reads.filter((read) => read === "fetch")).toHaveLength(1);
    expect(host.reads).toContain("status:target");
  } finally {
    host.release();
    view.unmount();
    queryClient.clear();
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
  const toolsHost: Partial<HostClient> = withLocalChanges({
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
    gitGetBranches: async () => [],
  });
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
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <BranchPanel />
      </ThemeProvider>
    </ClientConnectionProvider>,
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
  }
});

test("manual refresh waits for the fetch after a new branch and keeps its failure", async () => {
  const report = spyOn(toast, "error").mockImplementation(() => "toast-id");
  const fetchGate = createDeferred<void>();
  let fetches = 0;
  let finishRead!: (branch: string) => void;
  const read = mock(() => new Promise<string>((resolve) => (finishRead = resolve)));
  const toolsHost: Partial<HostClient> = withLocalChanges({
    gitGetComparisonTarget: async () => ({ kind: "available", reference: targetReference }),
    gitFetchRemote: async () => {
      fetches += 1;
      await fetchGate.promise;
      throw new Error("Remote authentication failed");
    },
    gitGetWorktreeStatus: async (_repoPath, targetBranch) => worktreeStatus(targetBranch),
    gitGetBranches: async () => [],
  });
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
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <BranchPanel />
      </ThemeProvider>
    </ClientConnectionProvider>,
  );
  const refreshButton = () => screen.getByTestId("agent-studio-git-refresh-button");
  try {
    await waitFor(() => expect(refreshButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(refreshButton());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await act(async () => finishRead("feature"));
    await waitFor(() => expect(fetches).toBe(1));
    // The refresh stays pending while the fetch for the new branch runs.
    expect(refreshButton().textContent).toContain("Refreshing");

    await act(async () => fetchGate.resolve());

    const refreshError = await screen.findByTestId("agent-studio-git-refresh-error");
    expect(refreshError.textContent).toContain("Remote authentication failed");
  } finally {
    fetchGate.resolve();
    view.unmount();
    queryClient.clear();
    report.mockRestore();
  }
});

test("a branch refresh ends without a fetch when another session in the directory opens", async () => {
  const fetchTargets: string[] = [];
  let finishRead!: (branch: string) => void;
  const read = mock(() => new Promise<string>((resolve) => (finishRead = resolve)));
  const toolsHost: Partial<HostClient> = withLocalChanges({
    gitGetComparisonTarget: async () => ({ kind: "available", reference: targetReference }),
    gitFetchRemote: async (_repoPath, targetBranch) => {
      fetchTargets.push(targetBranch);
      return { outcome: "skipped_no_remote", output: "" };
    },
    gitGetWorktreeStatus: async (_repoPath, targetBranch) => worktreeStatus(targetBranch),
    gitGetBranches: async () => [],
  });
  let openSessionB!: () => void;
  function SessionPanel() {
    const [session, setSession] = useState<"a" | "b">("a");
    const [branchKey, setBranchKey] = useState("main");
    openSessionB = () => setSession("b");
    return (
      <PanelHarness
        sessionId={`session-${session}`}
        target={session === "a" ? { branch: "@{upstream}" } : { remote: "origin", branch: "b" }}
        branchKey={branchKey}
        readBranch={async () => {
          const next = await read();
          setBranchKey(next);
          return next;
        }}
      />
    );
  }
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <SessionPanel />
      </ThemeProvider>
    </ClientConnectionProvider>,
  );
  const refreshButton = () => screen.getByTestId("agent-studio-git-refresh-button");
  try {
    await waitFor(() => expect(refreshButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(refreshButton());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));

    await act(async () => openSessionB());
    await act(async () => finishRead("feature"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(fetchTargets).toEqual([]);
    expect(refreshButton().textContent).not.toContain("Refreshing");
  } finally {
    view.unmount();
    queryClient.clear();
  }
});

test("a failed branch read stays with its own session after another session opens", async () => {
  const report = spyOn(toast, "error").mockImplementation(() => "toast-id");
  let failRead!: (error: Error) => void;
  const read = mock(() => new Promise<string>((_resolve, reject) => (failRead = reject)));
  const toolsHost: Partial<HostClient> = withLocalChanges({
    gitGetComparisonTarget: async () => ({ kind: "available", reference: targetReference }),
    gitGetWorktreeStatus: async (_repoPath, targetBranch) => worktreeStatus(targetBranch),
    gitGetBranches: async () => [],
  });
  let openSession!: (session: "a" | "b") => void;
  function SessionPanel() {
    const [session, setSession] = useState<"a" | "b">("a");
    openSession = setSession;
    return (
      <PanelHarness
        sessionId={`session-${session}`}
        target={session === "a" ? { branch: "@{upstream}" } : { remote: "origin", branch: "b" }}
        branchKey="main"
        readBranch={read}
      />
    );
  }
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <SessionPanel />
      </ThemeProvider>
    </ClientConnectionProvider>,
  );
  const refreshButton = () => screen.getByTestId("agent-studio-git-refresh-button");
  try {
    await waitFor(() => expect(refreshButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(refreshButton());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));

    await act(async () => openSession("b"));
    await act(async () => failRead(new Error("Session A branch permission failure")));

    expect(report).not.toHaveBeenCalled();
    expect(screen.queryByTestId("agent-studio-git-refresh-error")).toBeNull();

    await act(async () => openSession("a"));
    expect(screen.getByTestId("agent-studio-git-refresh-error").textContent).toContain(
      "Session A branch permission failure",
    );
  } finally {
    view.unmount();
    queryClient.clear();
    report.mockRestore();
  }
});

test("a target change in one session starts its own Refresh and hides the old failure", async () => {
  const report = spyOn(toast, "error").mockImplementation(() => "toast-id");
  const reads: Array<{ reject: (error: Error) => void }> = [];
  const read = mock(() => new Promise<string>((_resolve, reject) => reads.push({ reject })));
  const toolsHost: Partial<HostClient> = withLocalChanges({
    gitGetComparisonTarget: async () => ({ kind: "available", reference: targetReference }),
    gitGetWorktreeStatus: async (_repoPath, targetBranch) => worktreeStatus(targetBranch),
    gitGetBranches: async () => [],
  });
  let chooseTarget!: (branch: string) => void;
  function TargetPanel() {
    const [branch, setBranch] = useState("first");
    chooseTarget = setBranch;
    const target = { remote: "origin", branch };
    return (
      <PanelHarness
        contextMode="worktree"
        target={target}
        targetChoice={target}
        branchKey="main"
        readBranch={read}
      />
    );
  }
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <TargetPanel />
      </ThemeProvider>
    </ClientConnectionProvider>,
  );
  const refreshButton = () => screen.getByTestId("agent-studio-git-refresh-button");
  try {
    await waitFor(() => expect(refreshButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(refreshButton());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));

    await act(async () => chooseTarget("second"));
    // The Refresh for the first target does not stand in for the second target.
    expect(refreshButton().textContent).not.toContain("Refreshing");
    await act(async () => reads[0]?.reject(new Error("first-target branch read failed")));

    expect(report).not.toHaveBeenCalled();
    expect(screen.queryByTestId("agent-studio-git-refresh-error")).toBeNull();
    await waitFor(() => expect(refreshButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(refreshButton());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  } finally {
    for (const pending of reads) pending.reject(new Error("test ended"));
    view.unmount();
    queryClient.clear();
    report.mockRestore();
  }
});

test.each([
  ["a checkout cancels it", () => new CancelledError()],
  ["it fails after a checkout", () => new Error("first-branch read failed")],
] as const)(
  "a branch read keeps no feedback on the new branch when %s",
  async (_case, rejection) => {
    const report = spyOn(toast, "error").mockImplementation(() => "toast-id");
    let failRead!: (error: Error) => void;
    const read = mock(() => new Promise<string>((_resolve, reject) => (failRead = reject)));
    const toolsHost: Partial<HostClient> = withLocalChanges({
      gitGetComparisonTarget: async () => ({ kind: "available", reference: targetReference }),
      gitGetWorktreeStatus: async (_repoPath, targetBranch) => worktreeStatus(targetBranch),
      gitGetBranches: async () => [],
    });
    let checkout!: (branch: string) => void;
    function CheckoutPanel() {
      const [branchKey, setBranchKey] = useState("first");
      checkout = setBranchKey;
      return <PanelHarness branchKey={branchKey} readBranch={read} />;
    }
    const connection = createToolsConnection(toolsHost);
    const queryClient = connection.queryClient;
    const view = render(
      <ClientConnectionProvider connection={connection}>
        <ThemeProvider>
          <CheckoutPanel />
        </ThemeProvider>
      </ClientConnectionProvider>,
    );
    const refreshButton = () => screen.getByTestId("agent-studio-git-refresh-button");
    try {
      await waitFor(() => expect(refreshButton().hasAttribute("disabled")).toBe(false));
      fireEvent.click(refreshButton());
      await waitFor(() => expect(read).toHaveBeenCalledTimes(1));

      await act(async () => checkout("second"));
      // The Refresh for the first branch does not stand in for the second branch. The button
      // spins only for the first read of the second branch.
      await waitFor(() => expect(refreshButton().textContent).not.toContain("Refreshing"));
      await act(async () => failRead(rejection()));

      expect(report).not.toHaveBeenCalled();
      expect(screen.queryByTestId("agent-studio-git-refresh-error")).toBeNull();
      expect(refreshButton().textContent).not.toContain("Refreshing");
    } finally {
      view.unmount();
      queryClient.clear();
      report.mockRestore();
    }
  },
);

test("manual refresh waits for the fetch after recovered settings and keeps its failure", async () => {
  const report = spyOn(toast, "error").mockImplementation(() => "toast-id");
  const fetchGate = createDeferred<void>();
  let fetches = 0;
  const toolsHost: Partial<HostClient> = withLocalChanges({
    gitGetComparisonTarget: async () => ({ kind: "available", reference: targetReference }),
    gitFetchRemote: async () => {
      fetches += 1;
      await fetchGate.promise;
      throw new Error("Remote authentication failed");
    },
    gitGetWorktreeStatus: async (_repoPath, targetBranch) => worktreeStatus(targetBranch),
    gitGetBranches: async () => [],
  });
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
          setTarget({ remote: "origin", branch: "main" });
          setTargetError(null);
        }}
      />
    );
  }
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <RetryPanel />
      </ThemeProvider>
    </ClientConnectionProvider>,
  );
  const refreshButton = () => screen.getByTestId("agent-studio-git-refresh-button");
  try {
    await waitFor(() => expect(refreshButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(refreshButton());
    await waitFor(() => expect(fetches).toBe(1));
    // The refresh stays pending while the fetch with the loaded settings runs.
    expect(refreshButton().textContent).toContain("Refreshing");

    await act(async () => fetchGate.resolve());

    const refreshError = await screen.findByTestId("agent-studio-git-refresh-error");
    expect(refreshError.textContent).toContain("Remote authentication failed");
  } finally {
    fetchGate.resolve();
    view.unmount();
    queryClient.clear();
    report.mockRestore();
  }
});

test("manual refresh reads a new branch before refreshing its comparison", async () => {
  const calls: string[] = [];
  let finishRead!: (branch: string) => void;
  const read = mock(() => new Promise<string>((resolve) => (finishRead = resolve)));
  const toolsHost: Partial<HostClient> = withLocalChanges({
    gitGetComparisonTarget: async () => {
      calls.push("comparison");
      return { kind: "available", reference: targetReference };
    },
    gitFetchRemote: async () => {
      calls.push("fetch");
      return { outcome: "skipped_no_remote", output: "" };
    },
    gitGetWorktreeStatus: async (_repoPath, targetBranch) => worktreeStatus(targetBranch),
    gitGetBranches: async () => [],
  });
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
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <BranchPanel />
      </ThemeProvider>
    </ClientConnectionProvider>,
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
  const toolsHost: Partial<HostClient> = withLocalChanges({
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
    gitGetBranches: async () => [],
  });
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
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const panel = (isVisible = true, workingDirectory = "/repo", branch: string | null = null) => (
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <RefreshPanel isVisible={isVisible} workingDirectory={workingDirectory} branch={branch} />
      </ThemeProvider>
    </ClientConnectionProvider>
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
      // The stopped refresh left its reads stale, so the return checks the comparison again.
      expect(reads.some((read) => read.startsWith("comparison:"))).toBe(true);
      if (change === "branch") expect(reads.some((read) => read.startsWith("fetch:"))).toBe(false);
    }
  } finally {
    released.resolve();
    await act(async () => {
      view.unmount();
      await queryClient.cancelQueries();
      queryClient.clear();
    });
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
  const toolsHost: Partial<HostClient> = withLocalChanges({
    gitGetComparisonTarget: comparison,
    gitFetchRemote: fetchRemote,
    gitGetWorktreeStatus: async (_repoPath: string, targetBranch: string) => {
      statusTargets.push(targetBranch);
      return worktreeStatus(targetBranch);
    },
    gitGetBranches: async () => [],
  });
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </ClientConnectionProvider>,
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
  }
});

test("a missing target fetch failure tells the user what failed", async () => {
  const reportError = spyOn(toast, "error").mockImplementation(() => "toast-id");
  const comparison = mock(async (): Promise<GitComparisonTarget> => ({
    kind: "unavailable",
    reason: "No tracked upstream.",
  }));
  const statusTargets: string[] = [];
  const toolsHost: Partial<HostClient> = withLocalChanges({
    gitGetComparisonTarget: comparison,
    gitFetchRemote: async () => {
      throw new Error("Current branch has no upstream remote");
    },
    gitGetWorktreeStatus: async (_repoPath: string, targetBranch: string) => {
      statusTargets.push(targetBranch);
      return worktreeStatus(targetBranch);
    },
    gitGetBranches: async () => [],
  });
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const treeKey = filesystemQueryKeys.tree("/repo", null, "feature");
  queryClient.setQueryData(treeKey, { rootPath: "/repo", entries: [] });
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </ClientConnectionProvider>,
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
    // Local files can change without the remote, so a manual Refresh reads them again.
    await waitFor(() => expect(queryClient.getQueryState(treeKey)).toBeUndefined());
  } finally {
    view.unmount();
    queryClient.clear();
    reportError.mockRestore();
  }
});

test("returning to the app rechecks the target and file tree", async () => {
  const comparison = mock(async (): Promise<GitComparisonTarget> => ({
    kind: "available",
    reference: targetReference,
  }));
  const toolsHost: Partial<HostClient> = withLocalChanges({
    gitGetComparisonTarget: comparison,
    gitFetchRemote: async () => ({ outcome: "skipped_no_remote", output: "" }),
    gitGetWorktreeStatus: async (_repoPath: string, targetBranch: string) =>
      worktreeStatus(targetBranch),
    gitGetBranches: async () => [],
  });
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const treeKey = filesystemQueryKeys.tree("/repo", targetReference, "feature");
  queryClient.setQueryData(treeKey, { rootPath: "/repo", entries: [] });
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </ClientConnectionProvider>,
  );
  try {
    await waitFor(() => expect(comparison).toHaveBeenCalledTimes(1));
    act(() => globalThis.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(comparison.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(queryClient.getQueryState(treeKey)?.isInvalidated).toBe(true));
  } finally {
    view.unmount();
    queryClient.clear();
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
  const toolsHost: Partial<HostClient> = withLocalChanges({
    gitGetComparisonTarget: comparison,
    gitFetchRemote: async () => ({ outcome: "skipped_no_remote", output: "" }),
    gitGetWorktreeStatus,
    filesystemRefreshTree,
    gitGetBranches: async () => [],
  });
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </ClientConnectionProvider>,
  );
  try {
    await waitFor(() => expect(statusTargets).toContain(targetReference));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Files" }), { button: 0 });
    await waitFor(() => expect(fileTreeTargets).toContain(targetReference));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Diffs" }), { button: 0 });

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
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Files" }), { button: 0 });
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
  }
});

/** The composer hint while another Git write blocks a commit. */
const commitBlockedHint = {
  push: "Wait for the push to finish.",
  rebase: "Wait for the rebase or pull to finish.",
  discard: "Wait for the Git change to finish.",
};

test.each(
  (["commit", "push", "rebase", "discard"] as const).flatMap((kind) =>
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
    const toolsHost: Partial<HostClient> = withLocalChanges({
      gitGetComparisonTarget: comparison,
      gitGetWorktreeStatus: readStatus,
      [{
        commit: "gitCommitAll",
        push: "gitPushBranch",
        rebase: "gitRebaseBranch",
        discard: "gitChangeSelection",
      }[kind]]: operation,
    });
    const connection = createToolsConnection(toolsHost, createSettingsSnapshotFixture({ theme }));
    const queryClient = connection.queryClient;
    const panel = (isVisible: boolean) => (
      <ClientConnectionProvider connection={connection}>
        <ThemeProvider>
          <PanelHarness isVisible={isVisible} contextMode="worktree" />
        </ThemeProvider>
      </ClientConnectionProvider>
    );
    const view = render(panel(true));
    const pushButton = () => screen.getByTestId("agent-studio-git-push-button");
    const discardButton = () => screen.getByTestId("agent-studio-git-discard-file-button");
    try {
      await waitFor(() => expect(pushButton().hasAttribute("disabled")).toBe(false));
      if (kind === "commit") {
        fireEvent.change(screen.getByTestId("agent-studio-git-commit-message-input"), {
          target: { value: "fix: retain operation" },
        });
        // Cmd or Ctrl with Enter commits every change once the changes have loaded.
        await waitFor(() =>
          expect(screen.getByTestId("agent-studio-git-commit-hint").textContent).toContain(
            "+Enter stages and commits all",
          ),
        );
        fireEvent.keyDown(screen.getByTestId("agent-studio-git-commit-message-input"), {
          key: "Enter",
          ctrlKey: true,
        });
      } else if (kind === "discard") {
        await waitFor(() => expect(discardButton().hasAttribute("disabled")).toBe(false));
        fireEvent.click(discardButton());
        // The confirmation opens after the changes before it, and it stays when the tools close.
        await screen.findByRole("dialog", { name: "Discard unstaged changes?" });
        view.rerender(panel(false));
        view.rerender(panel(true));
        expect(screen.getByRole("dialog", { name: "Discard unstaged changes?" })).toBeTruthy();
        await waitFor(() =>
          expect(
            screen.getByTestId("agent-studio-git-confirm-discard-button").hasAttribute("disabled"),
          ).toBe(false),
        );
        fireEvent.click(screen.getByTestId("agent-studio-git-confirm-discard-button"));
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
      const busyButton = kind === "discard" ? discardButton() : pushButton();
      expect(busyButton.hasAttribute("disabled")).toBe(true);
      expect(pushButton().hasAttribute("disabled")).toBe(true);
      if (kind === "commit") {
        expect(
          screen.getByTestId("agent-studio-git-commit-message-input").hasAttribute("disabled"),
        ).toBe(true);
        expect(
          screen.getByTestId("agent-studio-git-commit-submit-button").hasAttribute("disabled"),
        ).toBe(true);
      } else {
        expect(screen.getByTestId("agent-studio-git-commit-hint").textContent).toBe(
          commitBlockedHint[kind],
        );
      }
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
    }
  },
  // This full render flow opens the tools, waits for Git reads and a confirmation, and hides and
  // shows the tools several times. A loaded runner can exceed 1000 ms.
  5_000,
);

test("retains a force-push confirmation when the rejected push finishes with tools hidden", async () => {
  const completed = createDeferred<GitPushResult>();
  const push = mock(async () => completed.promise);
  const toolsHost: Partial<HostClient> = withLocalChanges({
    gitGetComparisonTarget: async () => ({ kind: "available", reference: targetReference }),
    gitGetWorktreeStatus: async (_repo, target) => ({
      ...worktreeStatus(target),
      upstreamAheadBehind: { outcome: "tracking", ahead: 2, behind: 0 },
    }),
    gitPushBranch: push,
  });
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const panel = (isVisible: boolean) => (
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <PanelHarness isVisible={isVisible} />
      </ThemeProvider>
    </ClientConnectionProvider>
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
  }
});

test("invalidates a completed hidden commit without reading Git until tools reopen", async () => {
  const completed = createDeferred<void>();
  const commit = mock(async () => {
    await completed.promise;
    return { outcome: "committed" as const, commitHash: "abc123", output: "committed" };
  });
  // Commit takes the staged group, so the local fixture has a staged file.
  const readStatus = mock(async (_repo: string, target: string) => ({
    ...worktreeStatus(target),
    fileStatuses: [{ path: "draft.txt", status: "M", staged: true }],
  }));
  const comparison = mock(async () => ({ kind: "available" as const, reference: targetReference }));
  const toolsHost: Partial<HostClient> = withLocalChanges({
    gitGetComparisonTarget: comparison,
    gitGetWorktreeStatus: readStatus,
    gitCommitStaged: commit,
  });
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const panel = (isVisible: boolean) => (
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <PanelHarness isVisible={isVisible} />
      </ThemeProvider>
    </ClientConnectionProvider>
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
  }
});

test("a confirmed commit keeps its result when the panel update reads fail", async () => {
  let readsFail = false;
  const commit = mock(async () => ({
    outcome: "committed" as const,
    commitHash: "abc1234def",
    output: "committed",
  }));
  const stagedStatus = (target: string, scope: "target" | "uncommitted" = "uncommitted") => ({
    ...worktreeStatus(target, scope),
    fileStatuses: [{ path: "draft.txt", status: "M", staged: true }],
  });
  const toolsHost: Partial<HostClient> = {
    gitGetComparisonTarget: async () => ({ kind: "available", reference: targetReference }),
    gitGetLocalChanges: async () => {
      if (readsFail) throw new Error("Local read denied");
      return toLocalChanges(stagedStatus("HEAD"));
    },
    gitGetWorktreeStatus: async (_repo, target, scope = "uncommitted") => {
      if (readsFail) throw new Error("Branch read denied");
      return stagedStatus(target, scope);
    },
    gitGetHistoryPage: async () => ({ outcome: "no_commits" }),
    gitGetBranches: async () => [],
    gitCommitStaged: async () => {
      readsFail = true;
      return commit();
    },
  };
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </ClientConnectionProvider>,
  );
  try {
    const input = screen.getByTestId("agent-studio-git-commit-message-input");
    await waitFor(() => expect(input.hasAttribute("disabled")).toBe(false));
    fireEvent.change(input, { target: { value: "fix: keep the commit" } });
    const submit = screen.getByTestId("agent-studio-git-commit-submit-button");
    await waitFor(() => expect(submit.hasAttribute("disabled")).toBe(false));
    fireEvent.click(submit);

    const error = await screen.findByTestId("agent-studio-git-commit-error");
    // Both update reads fail. The first failure to arrive becomes the reason.
    expect(error.textContent).toMatch(
      /^Commit abc1234 succeeded, but the panel could not update: (Local|Branch) read denied Refresh to try again\.$/,
    );
    expect(commit).toHaveBeenCalledTimes(1);
    // Git confirmed the commit, so the composer clears the submitted message.
    expect(screen.queryByDisplayValue("fix: keep the commit")).toBeNull();
  } finally {
    view.unmount();
    queryClient.clear();
  }
});

test("manual refresh reports a local read failure that the read after the fetch repeats", async () => {
  const host = createHeldFetchHost();
  let localFails = false;
  host.client.gitGetLocalChanges = async () => {
    host.reads.push("local");
    if (localFails) throw new Error("Early local read denied");
    return toLocalChanges(worktreeStatus("HEAD"));
  };
  const toolsHost: Partial<HostClient> = host.client;
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </ClientConnectionProvider>,
  );
  try {
    await waitForTargetScope();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    host.reads.length = 0;
    host.hold();
    localFails = true;

    fireEvent.click(screen.getByTestId("agent-studio-git-refresh-button"));
    await waitFor(() => expect(host.reads.toSorted()).toEqual(["fetch", "local"]));
    // The local read fails while the fetch waits. Bun fails the test on an unhandled rejection.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await act(async () => host.release());

    const refreshError = await screen.findByTestId("agent-studio-git-refresh-error");
    expect(refreshError.textContent).toContain("Early local read denied");
    // The read before the fetch and the read after it both ran.
    expect(host.reads.filter((read) => read === "local")).toHaveLength(2);
  } finally {
    host.release();
    view.unmount();
    queryClient.clear();
  }
});

test("a failed History read fails a manual refresh once and stays until a retry", async () => {
  const report = spyOn(toast, "error").mockImplementation(() => "toast-id");
  const host = createHeldFetchHost();
  let historyFails = false;
  host.client.gitGetHistoryPage = async () => {
    host.reads.push("history");
    if (historyFails) throw new Error("History read denied");
    return { outcome: "no_commits" };
  };
  const toolsHost: Partial<HostClient> = host.client;
  const connection = createToolsConnection(toolsHost);
  const queryClient = connection.queryClient;
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </ClientConnectionProvider>,
  );
  try {
    await waitForTargetScope();
    fireEvent.mouseDown(screen.getByTestId("agent-studio-git-tab-history"), { button: 0 });
    await waitFor(() => expect(host.reads).toContain("history"));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    host.reads.length = 0;
    historyFails = true;

    fireEvent.click(screen.getByTestId("agent-studio-git-refresh-button"));

    const refreshError = await screen.findByTestId("agent-studio-git-refresh-error");
    expect(refreshError.textContent).toContain("History read denied");
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(host.reads.filter((read) => read === "history")).toHaveLength(1);
    expect(screen.getByTestId("agent-studio-git-history-refresh-error").textContent).toContain(
      "History read denied",
    );
    expect(report).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    queryClient.clear();
    report.mockRestore();
  }
});

test("a failed fetch refreshes both diff tabs and reports the fetch error", async () => {
  let revision = 1;
  const report = spyOn(toast, "error").mockImplementation(() => "toast-id");
  const toolsHost: Partial<HostClient> = withLocalChanges({
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
  });
  const connection = createToolsConnection(toolsHost);
  const client = connection.queryClient;
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <ThemeProvider>
        <PanelHarness />
      </ThemeProvider>
    </ClientConnectionProvider>,
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
    // The panel keeps the failure next to the retained data.
    expect((await screen.findByTestId("agent-studio-git-refresh-error")).textContent).toContain(
      "Check the remote connection.",
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
  }
});
