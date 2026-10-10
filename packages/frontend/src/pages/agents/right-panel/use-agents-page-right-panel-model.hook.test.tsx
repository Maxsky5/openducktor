import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { act, fireEvent, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { AgentsPageRightPanelRuntime } from "../shell/agents-page-right-panel-runtime";
import type { GitDiffRefresh } from "@/features/agent-studio-git";
import type { ToolTabKind } from "@/features/session-panels";
import { createSessionPanelFixture } from "@/test-utils/session-panel-fixtures";
import {
  createDialogPreviewHarness,
  dialogTextFile,
} from "@/components/features/agents/agent-chat/agent-session-dialog-preview-test-harness";
import type { PullRequest } from "@openducktor/contracts";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { createQueryClient } from "@/lib/query-client";
import { type AgentSessionSummary, toAgentSessionSummary } from "@/state/agent-sessions-store";
import { filesystemQueryKeys, workspaceFileTreeQueryOptions } from "@/state/queries/filesystem";
import {
  resetInlineCommentDraftStoreForTests,
  setInlineCommentDraftScheduleTaskForTests,
  setInlineCommentDraftStorageForTests,
  toInlineCommentDraftOwnerKey,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import {
  createAgentSessionFixture,
  createHookHarness,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "../agent-studio-test-utils";
import {
  createBuildToolsSnapshotFixture,
  createGitActionsFixture,
  createBuildToolsFixture,
} from "../shell/agents-page-build-tools.test-support";

enableReactActEnvironment();

type UseAgentsPageRightPanelModel =
  (typeof import("./use-agents-page-right-panel-model"))["useAgentsPageRightPanelModel"];
type PullRequestReviewQueriesModule = typeof import("@/state/queries/pull-request-review");
type HookArgs = Parameters<UseAgentsPageRightPanelModel>[0];

let useAgentsPageRightPanelModel: UseAgentsPageRightPanelModel;
const realPullRequestReviewQueries: PullRequestReviewQueriesModule =
  await import("@/state/queries/pull-request-review");
let testSpies: Array<{ mockRestore(): void }> = [];

type BuildToolsSnapshot = HookArgs["buildTools"]["buildToolsSnapshot"];

type PrefetchPullRequestReviewContext =
  PullRequestReviewQueriesModule["prefetchPullRequestReviewContextFromQuery"];
const prefetchPullRequestReviewContextMock = mock(
  async (
    _queryClient: Parameters<PrefetchPullRequestReviewContext>[0],
    _input: Parameters<PrefetchPullRequestReviewContext>[1],
  ) => {},
);
const refreshWorktreeMock = mock<BuildToolsSnapshot["refreshWorktree"]>(async () => {});

const linkedPullRequest = {
  providerId: "github",
  number: 42,
  url: "https://github.com/openai/openducktor/pull/42",
  state: "open",
  createdAt: "2026-07-08T10:00:00Z",
  updatedAt: "2026-07-08T10:05:00Z",
} satisfies PullRequest;

const createSnapshot = (): BuildToolsSnapshot =>
  createBuildToolsSnapshotFixture({ refreshWorktree: refreshWorktreeMock });

const buildToolsSnapshotState = { current: createSnapshot() };

type SelectedViewOverrides = Partial<HookArgs["selectedView"]> & {
  loadedSession?: AgentSessionState | null;
  selectedSessionIdentity?: AgentSessionIdentity | null;
  selectedSessionActivityState?: HookArgs["selectedView"]["selectedSession"]["activityState"];
  selectedSessionSummary?: AgentSessionSummary | null;
};

const createSelectedSession = (
  overrides: Partial<HookArgs["selectedView"]["selectedSession"]> = {},
): HookArgs["selectedView"]["selectedSession"] => ({
  identity: null,
  activityState: null,
  selectedModel: null,
  loadedSession: null,
  runtimeData: {
    modelCatalog: null,
    todos: [],
    isLoadingModelCatalog: false,
    catalogError: null,
    todosError: null,
    runtimePolicyError: null,
    contextError: null,
  },
  runtimeReadiness: {
    state: "ready",
    message: null,
    isLoadingChecks: false,
    refreshChecks: async () => {},
  },
  transcriptState: { kind: "visible" },
  sessionAuxiliaryError: null,
  ...overrides,
});

const createSelectedView = (overrides: SelectedViewOverrides = {}): HookArgs["selectedView"] => {
  const {
    loadedSession: loadedSessionOverride,
    selectedSessionIdentity: selectedSessionIdentityOverride,
    selectedSessionSummary: selectedSessionSummaryOverride,
    role = "build",
    ...viewOverrides
  } = overrides;
  const defaultSession = createAgentSessionFixture({
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    status: "running",
    workingDirectory: "/repo",
  });
  const loadedSession =
    "loadedSession" in overrides ? (loadedSessionOverride ?? null) : defaultSession;
  const selectedSessionSummary =
    "selectedSessionSummary" in overrides
      ? (selectedSessionSummaryOverride ?? null)
      : loadedSession
        ? toAgentSessionSummary(loadedSession)
        : null;
  const selectedSessionIdentity =
    "selectedSessionIdentity" in overrides
      ? (selectedSessionIdentityOverride ?? null)
      : (selectedSessionSummary ?? (loadedSession ? toAgentSessionIdentity(loadedSession) : null));
  const selectedSessionActivityState =
    "selectedSessionActivityState" in overrides
      ? (overrides.selectedSessionActivityState ?? null)
      : (selectedSessionSummary?.activityState ?? null);

  return {
    role,
    taskId: "task-1",
    selectedTask: createTaskCardFixture({ id: "task-1" }),
    selectedSession: createSelectedSession({
      identity: selectedSessionIdentity,
      activityState: selectedSessionActivityState,
      loadedSession,
    }),
    ...viewOverrides,
  };
};

beforeEach(async () => {
  resetInlineCommentDraftStoreForTests();
  prefetchPullRequestReviewContextMock.mockClear();
  refreshWorktreeMock.mockClear();
  buildToolsSnapshotState.current = createSnapshot();

  testSpies = [
    spyOn(
      realPullRequestReviewQueries,
      "prefetchPullRequestReviewContextFromQuery",
    ).mockImplementation(prefetchPullRequestReviewContextMock),
  ];

  ({ useAgentsPageRightPanelModel } = await import("./use-agents-page-right-panel-model"));
});

afterEach(() => {
  resetInlineCommentDraftStoreForTests();
  for (const testSpy of testSpies) testSpy.mockRestore();
  testSpies = [];
});

const DEFAULT_TABS: ToolTabKind[] = ["document", "diffs", "files"];
const CI_TABS: ToolTabKind[] = ["diffs", "files", "ci_checks"];

const rightPanel = (selected: ToolTabKind, isVisible: boolean, kinds = DEFAULT_TABS) =>
  createSessionPanelFixture({
    tabs: kinds.map((kind) => ({ id: kind, kind })),
    selectedTabId: selected,
    isVisible,
  });

const createHookArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeWorkspace: {
    workspaceId: "workspace-repo",
    workspaceName: "Repo",
    repoPath: "/repo",
  },
  buildTools: createBuildToolsFixture({
    buildToolsSnapshot: buildToolsSnapshotState.current,
    gitActions: createGitActionsFixture(null),
  }),
  selectedView: createSelectedView(),
  panel: rightPanel("document", false),
  pullRequestReviewUnavailableReason: null,
  documentsModel: null,
  selectedFile: null,
  onSelectFile: () => {},
  detectingPullRequestTaskId: null,
  onDetectPullRequest: () => {},
  ...overrides,
});

describe("useAgentsPageRightPanelModel", () => {
  test("validates task comments without mounting the Git tab", async () => {
    const values = new Map<string, string>();
    setInlineCommentDraftStorageForTests({
      get length() {
        return values.size;
      },
      key: (index) => Array.from(values.keys())[index] ?? null,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
      removeItem: (key) => {
        values.delete(key);
      },
    });
    setInlineCommentDraftScheduleTaskForTests(() => () => {});
    const ownerKey = toInlineCommentDraftOwnerKey({
      kind: "task",
      workspaceId: "workspace-repo",
      taskId: "task-1",
    });
    if (ownerKey === null) throw new Error("Expected a task comment owner.");
    useInlineCommentDraftStore.getState().addDraft(ownerKey, {
      filePath: "src/missing.ts",
      diffScope: "uncommitted",
      startLine: 1,
      endLine: 1,
      side: "new",
      text: "Missing file comment",
      codeContext: [],
    });
    const harness = createHookHarness(
      useAgentsPageRightPanelModel,
      createHookArgs({ panel: rightPanel("files", false) }),
    );
    try {
      await harness.mount();
      expect(useInlineCommentDraftStore.getState().getDraftCount(ownerKey)).toBe(0);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps a changed detached HEAD out of the selected explorer cache", async () => {
    buildToolsSnapshotState.current = {
      ...createSnapshot(),
      repositoryBranchIdentityKey: "detached:head-before",
    };
    const queryClient = createQueryClient();
    const harness = createHookHarness(
      useAgentsPageRightPanelModel,
      createHookArgs({ panel: rightPanel("files", true) }),
      { queryClient },
    );
    let head = "head-before";
    const unused = async (): Promise<never> => {
      throw new Error("Not used by the explorer read.");
    };
    const treeHost = {
      filesystemListDirectory: unused,
      filesystemReadTextFile: unused,
      filesystemWriteTextFile: unused,
      filesystemRefreshTree: async () => ({
        kind: "snapshot" as const,
        rootPath: "/repo",
        context: {
          rootPath: "/repo",
          gitDirectory: "/repo/.git",
          branch: null,
          head,
          targetBranch: "origin/main",
          targetRevision: "target",
          indexVersion: "index",
          sparsePolicy: "",
        },
        cursor: { viewId: head, revision: 0 },
        entries: [],
      }),
    };

    try {
      await harness.mount();
      const model = harness.getLatest().toolsModel.fileExplorerModel;
      if (!model?.rootPath) throw new Error("Expected a file explorer root.");
      const options = workspaceFileTreeQueryOptions(
        model.rootPath,
        model.targetBranch,
        treeHost,
        model.branchKey,
      );
      await queryClient.fetchQuery(options);
      head = "head-after";
      await expect(queryClient.fetchQuery(options)).rejects.toThrow(
        "Workspace branch changed during file refresh. Refresh again.",
      );
      expect(queryClient.getQueryData(options.queryKey)).toMatchObject({
        context: { head: "head-before" },
      });
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });

  test("gives the git panel a new subject key only for another workspace, task, or session", async () => {
    const harness = createHookHarness(useAgentsPageRightPanelModel, createHookArgs());
    const subjectKey = () => harness.getLatest().toolsModel.gitModel.subjectKey;
    await harness.mount();
    const firstKey = subjectKey();
    expect(firstKey).toBeString();

    await harness.update(createHookArgs());
    expect(subjectKey()).toBe(firstKey);

    const otherSession = {
      externalSessionId: "session-2",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
    } as const;
    for (const args of [
      createHookArgs({
        activeWorkspace: { workspaceId: "workspace-2", workspaceName: "Repo", repoPath: "/repo" },
      }),
      createHookArgs({ selectedView: createSelectedView({ taskId: "task-2" }) }),
      createHookArgs({
        selectedView: createSelectedView({ selectedSessionIdentity: otherSession }),
      }),
      createHookArgs({ selectedView: createSelectedView({ selectedSessionIdentity: null }) }),
    ]) {
      await harness.update(args);
      expect(subjectKey()).not.toBe(firstKey);
    }
    await harness.unmount();
  });

  test("prefetches CI review data in the background for linked pull requests", async () => {
    const queryClient = createQueryClient();
    const harness = createHookHarness(
      useAgentsPageRightPanelModel,
      createHookArgs({
        selectedView: createSelectedView({
          selectedTask: createTaskCardFixture({
            id: "task-1",
            pullRequest: linkedPullRequest,
          }),
        }),
        panel: rightPanel("diffs", false, CI_TABS),
      }),
      { queryClient },
    );

    await harness.mount();

    expect(prefetchPullRequestReviewContextMock).toHaveBeenCalledTimes(1);
    expect(prefetchPullRequestReviewContextMock.mock.calls[0]?.[0]).toBe(queryClient);
    expect(prefetchPullRequestReviewContextMock.mock.calls[0]?.[1]).toEqual({
      repoPath: "/repo",
      taskId: "task-1",
      pullRequest: { providerId: "github", number: 42 },
    });

    await harness.unmount();
  });

  test("refreshes Git and invalidates file explorer data after builder mutations", async () => {
    const queryClient = createQueryClient();
    const requestedRootPath = "/repo-link/.worktrees/task-1";
    const canonicalRootPath = "/repo/.worktrees/task-1";
    const snapshot = createSnapshot();
    buildToolsSnapshotState.current = {
      ...snapshot,
      gitPanelContextMode: "worktree",
      worktree: {
        ...snapshot.worktree,
        path: requestedRootPath,
      },
    };
    const selectedFile = { rootPath: canonicalRootPath, relativePath: "src/index.ts" };
    const treeKey = filesystemQueryKeys.tree(requestedRootPath, "origin/main");
    const textFileKey = filesystemQueryKeys.textFile(canonicalRootPath, selectedFile.relativePath);
    queryClient.setQueryData(treeKey, { entries: [] });
    queryClient.setQueryData(textFileKey, { kind: "text" });
    const harness = createHookHarness(
      useAgentsPageRightPanelModel,
      createHookArgs({
        panel: rightPanel("files", true),
        selectedFile,
      }),
      { queryClient },
    );

    await harness.mount();
    await harness.run(async (state) => {
      await state.refreshWorktree("soft");
    });

    expect(refreshWorktreeMock).toHaveBeenCalledWith("soft");
    expect(queryClient.getQueryState(treeKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(textFileKey)?.isInvalidated).toBe(true);

    await harness.unmount();
    queryClient.clear();
  });

  test("manual Git refresh clears inactive trees and refreshes selected content", async () => {
    const queryClient = createQueryClient();
    const rootPath = "/repo/.worktrees/task-1";
    const snapshot = createSnapshot();
    snapshot.gitPanelContextMode = "worktree";
    snapshot.worktree.path = rootPath;
    snapshot.diffData.refresh = refreshWorktreeMock;
    buildToolsSnapshotState.current = snapshot;
    const selectedFile = { rootPath, relativePath: "src/index.ts" };
    const treeKey = filesystemQueryKeys.tree(rootPath, "origin/main");
    const textKey = filesystemQueryKeys.textFile(rootPath, selectedFile.relativePath);
    queryClient.setQueryData(treeKey, { entries: [] });
    queryClient.setQueryData(textKey, { kind: "text" });
    const harness = createHookHarness(
      useAgentsPageRightPanelModel,
      createHookArgs({ panel: rightPanel("diffs", true), selectedFile }),
      { queryClient },
    );

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.toolsModel.gitModel.refresh();
      });

      expect(refreshWorktreeMock).toHaveBeenCalledTimes(1);
      expect(queryClient.getQueryState(treeKey)).toBeUndefined();
      expect(queryClient.getQueryState(textKey)?.isInvalidated).toBe(true);
    } finally {
      await harness.unmount();
      queryClient.clear();
    }
  });

  test("does not prefetch CI review data without a linked pull request", async () => {
    const harness = createHookHarness(
      useAgentsPageRightPanelModel,
      createHookArgs({
        panel: rightPanel("diffs", false, CI_TABS),
      }),
    );

    await harness.mount();

    expect(prefetchPullRequestReviewContextMock).not.toHaveBeenCalled();

    await harness.unmount();
  });

  test("does not prefetch CI review data while the provider read has failed", async () => {
    const readError = "Could not load the current Git provider: connection failed";
    const harness = createHookHarness(
      useAgentsPageRightPanelModel,
      createHookArgs({
        selectedView: createSelectedView({
          selectedTask: createTaskCardFixture({
            id: "task-1",
            pullRequest: linkedPullRequest,
          }),
        }),
        panel: rightPanel("ci_checks", true, CI_TABS),
        pullRequestReviewUnavailableReason: readError,
      }),
    );

    await harness.mount();

    expect(prefetchPullRequestReviewContextMock).not.toHaveBeenCalled();
    expect(harness.getLatest().toolsModel.ciChecksModel).toMatchObject({
      queryInput: null,
      unavailableReason: readError,
    });

    await harness.unmount();
  });
});

for (const outcome of [
  "saved",
  "failed",
  "task-changed",
  "repository-changed",
  "unmounted",
  "repository-view",
] as const) {
  test(`dialog file save refreshes only its mounted task worktree: ${outcome}`, async () => {
    buildToolsSnapshotState.current.gitPanelContextMode =
      outcome === "repository-view" ? "repository" : "worktree";
    let changeSelection: (next: HookArgs | null) => void = () => {};
    const initialArgs = createHookArgs({ selectedView: createSelectedView({ taskId: "a" }) });
    function GitPanel({ args }: { args: HookArgs }) {
      const refreshWorktreeRef = useRef<GitDiffRefresh | null>(null);
      return (
        <AgentsPageRightPanelRuntime
          {...args}
          renderPanel={false}
          refreshWorktreeRef={refreshWorktreeRef}
        />
      );
    }
    function SelectedGitPanel() {
      const [args, setArgs] = useState<HookArgs | null>(initialArgs);
      changeSelection = setArgs;
      return args ? <GitPanel args={args} /> : null;
    }
    const h = createDialogPreviewHarness("src/file.ts", <SelectedGitPanel />);
    const deferred = Promise.withResolvers<ReturnType<typeof dialogTextFile>>();
    h.write.mockImplementation(() => deferred.promise);
    try {
      await h.open();
      await h.selectFile();
      await h.edit();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save file" })));
      expect(h.write).toHaveBeenCalledTimes(1);
      expect(refreshWorktreeMock).not.toHaveBeenCalled();
      if (outcome === "task-changed")
        act(() =>
          changeSelection(createHookArgs({ selectedView: createSelectedView({ taskId: "b" }) })),
        );
      if (outcome === "repository-changed")
        act(() =>
          changeSelection({
            ...initialArgs,
            activeWorkspace: { workspaceId: "other", workspaceName: "Other", repoPath: "/other" },
          }),
        );
      if (outcome === "unmounted") act(() => changeSelection(null));
      await act(async () => {
        if (outcome === "failed") deferred.reject(new Error("Write failed"));
        else deferred.resolve(dialogTextFile("/repo/a", "Local draft"));
      });
      if (outcome === "saved") {
        expect(refreshWorktreeMock).toHaveBeenCalledTimes(1);
        expect(refreshWorktreeMock).toHaveBeenCalledWith("soft");
      } else expect(refreshWorktreeMock).not.toHaveBeenCalled();
    } finally {
      h.dispose();
    }
  });
}
