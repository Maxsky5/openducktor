import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  DevServerScriptState,
  PullRequest,
  PullRequestReviewComment,
  PullRequestReviewContext,
  WorkspaceFileTree,
} from "@openducktor/contracts";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactElement, useEffect, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider } from "@/components/layout/theme-provider";
import type { AgentStudioDevServerTerminalBuffer } from "@/features/agent-studio-build-tools/dev-server-log-buffer";
import type { DiffScopeState } from "@/features/agent-studio-git/contracts";
import { createQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import { filesystemQueryKeys } from "@/state/queries/filesystem";
import { pullRequestReviewQueryKeys } from "@/state/queries/pull-request-review";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { withAnimationFrameTestDriver } from "./agent-chat/test-support/animation-frame-test-driver";
import type { AgentStudioDevServerPanelModel } from "./agent-studio-dev-server-panel";
import type { AgentStudioGitPanelModel } from "./agent-studio-git-panel";
import type {
  TaskExecutionPanelModel,
  TaskExecutionPanelToggleModel,
} from "./task-execution-panel";

type TaskExecutionPanelComponent = typeof import("./task-execution-panel")["TaskExecutionPanel"];
type TaskExecutionPanelToggleButtonComponent =
  typeof import("./task-execution-panel")["TaskExecutionPanelToggleButton"];

let TaskExecutionPanel: TaskExecutionPanelComponent;
let TaskExecutionPanelToggleButton: TaskExecutionPanelToggleButtonComponent;
let lastFileTreeOptions: Record<string, unknown> | null = null;
let prepareFileTreeInputCalls: string[][] = [];
let preparePresortedFileTreeInputCalls: string[][] = [];
let fileTreeSelectedPaths: string[] = [];
let deselectedFileTreePaths: string[] = [];
let selectedOnlyFileTreePaths: string[] = [];
let fileTreeSubscriber: (() => void) | null = null;

const actualPierreTrees = await import("@pierre/trees");
const actualPierreTreesReact = await import("@pierre/trees/react");
const actualDevServerSettingsAction = await import("./agent-studio-dev-server-settings-action");

beforeEach(async () => {
  lastFileTreeOptions = null;
  prepareFileTreeInputCalls = [];
  preparePresortedFileTreeInputCalls = [];
  fileTreeSelectedPaths = [];
  deselectedFileTreePaths = [];
  selectedOnlyFileTreePaths = [];
  fileTreeSubscriber = null;

  mock.module("@pierre/trees", () => ({
    prepareFileTreeInput: (paths: string[]) => {
      prepareFileTreeInputCalls.push([...paths]);
      return { paths };
    },
    preparePresortedFileTreeInput: (paths: string[]) => {
      preparePresortedFileTreeInputCalls.push([...paths]);
      return { paths };
    },
    themeToTreeStyles: () => ({}),
  }));

  mock.module("@pierre/trees/react", () => ({
    FileTree: () => createElement("div", { "data-testid": "mock-pierre-file-tree" }),
    useFileTree: (options: Record<string, unknown>) => {
      lastFileTreeOptions = options;
      return {
        model: {
          getItem: (path: string) => ({
            deselect: () => {
              deselectedFileTreePaths.push(path);
              fileTreeSelectedPaths = fileTreeSelectedPaths.filter(
                (selectedPath) => selectedPath !== path,
              );
            },
            select: () => {
              selectedOnlyFileTreePaths.push(path);
              fileTreeSelectedPaths = [path];
            },
          }),
          getSelectedPaths: () => fileTreeSelectedPaths,
          resetPaths: () => {},
          subscribe: (subscriber: () => void) => {
            fileTreeSubscriber = subscriber;
            return () => {
              fileTreeSubscriber = null;
            };
          },
          setGitStatus: () => {},
          setIcons: () => {},
          setSearch: () => {},
        },
      };
    },
  }));

  mock.module("./agent-studio-dev-server-settings-action", () => ({
    AgentStudioDevServerSettingsAction: () =>
      createElement("button", { type: "button" }, "Configure dev server commands"),
  }));

  ({ TaskExecutionPanel, TaskExecutionPanelToggleButton } = await import("./task-execution-panel"));
});

afterEach(async () => {
  cleanup();
  await restoreMockedModules([
    ["@pierre/trees", async () => actualPierreTrees],
    ["@pierre/trees/react", async () => actualPierreTreesReact],
    ["./agent-studio-dev-server-settings-action", async () => actualDevServerSettingsAction],
  ]);
});

const emptyDoc = {
  markdown: "",
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: true,
};

const emptyDiffScopeState: DiffScopeState = {
  branch: "feature/task-12",
  fileDiffs: [],
  fileStatuses: [],
  uncommittedFileCount: 0,
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  upstreamStatus: "tracking",
  error: null,
  hashVersion: 1,
  statusHash: "0123456789abcdef",
  diffHash: "fedcba9876543210",
};

const diffModel: AgentStudioGitPanelModel = {
  contextMode: "worktree",
  branch: "feature/task-12",
  worktreePath: "/tmp/worktree/task-12",
  targetBranch: "origin/main",
  diffScope: "target",
  scopeStatesByScope: {
    target: { ...emptyDiffScopeState },
    uncommitted: { ...emptyDiffScopeState },
  },
  loadedScopesByScope: {
    target: true,
    uncommitted: true,
  },
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  upstreamStatus: "tracking",
  fileDiffs: [],
  fileStatuses: [],
  hashVersion: 1,
  statusHash: "0123456789abcdef",
  diffHash: "fedcba9876543210",
  uncommittedFileCount: 0,
  isLoading: false,
  error: null,
  refresh: async () => {},
  setDiffScope: () => {},
  isCommitting: false,
  isPushing: false,
  isRebasing: false,
  commitError: null,
  pushError: null,
  rebaseError: null,
  commitAll: async () => true,
  pushBranch: async () => {},
  rebaseOntoTarget: async () => {},
};

const linkedPullRequest = {
  providerId: "github",
  number: 110,
  url: "https://github.com/openai/openducktor/pull/110",
  state: "open",
  createdAt: "2026-03-12T12:24:09Z",
  updatedAt: "2026-03-12T12:24:09Z",
  lastSyncedAt: undefined,
  mergedAt: undefined,
  closedAt: undefined,
} satisfies PullRequest;

const ciQueryInput = {
  repoPath: "/repo",
  taskId: "task-12",
  workingDirectory: "/tmp/worktree/task-12",
};

const CI_INTERACTION_BUDGET_MS = 50;

const createPerformanceComment = (index: number): PullRequestReviewComment => ({
  id: `performance-comment-${index}`,
  author: index % 2 === 0 ? "reviewer" : "review-bot[bot]",
  authorAvatarUrl: null,
  body: [
    `## Review comment ${index}`,
    `Performance marker ${index}`,
    ...Array.from(
      { length: 20 },
      (_, paragraphIndex) =>
        `- Check item ${paragraphIndex}: keep the CI panel responsive while review details render.`,
    ),
  ].join("\n\n"),
  patch: `@@ -1,2 +1,2 @@\n-const previous${index} = false;\n+const next${index} = true;`,
  suggestionPatches: [
    `@@ -8,1 +8,1 @@\n-disabled={isCheckLoading${index}}\n+disabled={isAnyCheckLoading${index}}`,
  ],
  url: `https://github.com/openai/openducktor/pull/110#discussion_r${index}`,
  createdAt: "2026-07-10T10:00:00Z",
  updatedAt: null,
  path: `src/check-${index}.ts`,
  line: index + 1,
  threadId: `performance-thread-${index}`,
  isResolved: false,
  source: "review_thread",
});

const createLoadedCiContext = ({
  checks,
  openThreadCount,
}: {
  checks: Extract<PullRequestReviewContext, { status: "loaded" }>["checks"];
  openThreadCount: number;
}): PullRequestReviewContext => ({
  status: "loaded",
  providerId: "github",
  pullRequest: {
    providerId: "github",
    number: 110,
    title: "Panel polish",
    url: "https://github.com/openai/openducktor/pull/110",
    state: "open",
  },
  aggregateStatus: "unknown",
  checks,
  comments: [],
  reviewThreads: {
    openCount: openThreadCount,
  },
  refreshedAt: "2026-07-08T10:08:00Z",
});

const selectedScript: DevServerScriptState = {
  scriptId: "frontend",
  name: "Frontend",
  command: "bun run dev",
  status: "running",
  runIdentity: {
    runId: "frontend:1",
    runOrder: { hostInstanceId: "host-1", generation: 1 },
  },
  pid: 123,
  startedAt: "2026-03-19T10:00:00.000Z",
  exitCode: null,
  lastError: null,
  bufferedTerminalChunks: [
    {
      scriptId: "frontend",
      runIdentity: {
        runId: "frontend:1",
        runOrder: { hostInstanceId: "host-1", generation: 1 },
      },
      sequence: 0,
      data: "ready in 120ms\r\n",
      timestamp: "2026-03-19T10:00:01.000Z",
    },
  ],
};

const devServerModel: AgentStudioDevServerPanelModel = {
  mode: "active",
  isExpanded: true,
  isLoading: false,
  disabledReason: null,
  repoPath: "/repo",
  taskId: "task-12",
  worktreePath: "/tmp/worktree/task-12",
  scripts: [selectedScript],
  selectedScriptId: selectedScript.scriptId,
  selectedScript,
  selectedScriptTerminalBuffer: {
    entries: selectedScript.bufferedTerminalChunks.map((terminalChunk) => ({
      ...terminalChunk,
    })),
    lastSequence: selectedScript.bufferedTerminalChunks.at(-1)?.sequence ?? null,
    resetToken: 0,
  } satisfies AgentStudioDevServerTerminalBuffer,
  error: null,
  isStartPending: false,
  isStopPending: false,
  isRestartPending: false,
  onSelectScript: () => {},
  onStart: () => {},
  onStop: () => {},
  onRestart: () => {},
};

const basePanelModel = {
  tabs: [
    { id: "document", label: "Document" },
    { id: "git", label: "Git" },
    { id: "file_explorer", label: "File explorer" },
    { id: "ci_checks", label: "CI Checks" },
  ],
  activeTabId: "document",
  onActiveTabChange: () => {},
  documentModel: {
    activeDocument: {
      title: "Specification",
      description: "Current specification document for this task.",
      emptyState: "No spec document yet.",
      document: {
        ...emptyDoc,
        markdown: "# Spec",
      },
    },
  },
  gitModel: diffModel,
  fileExplorerModel: {
    rootPath: null,
    targetBranch: null,
    unavailableReason: "No repository is selected.",
    isActive: false,
    selectedFile: null,
    onSelectFile: () => {},
    onClearSelectedFile: () => {},
  },
  ciChecksModel: {
    isActive: false,
    queryInput: null,
  },
  devServerModel: null,
} satisfies TaskExecutionPanelModel;

function CiPerformanceHarness({
  context,
  initiallyOpen,
  initialTabId,
}: {
  context: PullRequestReviewContext;
  initiallyOpen: boolean;
  initialTabId: TaskExecutionPanelModel["activeTabId"];
}): ReactElement | null {
  const queryClient = useQueryClient();
  const [seededContext, setSeededContext] = useState<PullRequestReviewContext | null>(null);
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [activeTabId, setActiveTabId] = useState(initialTabId);

  useEffect(() => {
    queryClient.setQueryData(pullRequestReviewQueryKeys.context(ciQueryInput), context);
    setSeededContext(context);
  }, [context, queryClient]);

  if (seededContext !== context) {
    return null;
  }

  return (
    <>
      <TaskExecutionPanelToggleButton
        model={{
          kind: "task_execution",
          isOpen,
          onToggle: () => {
            setIsOpen((current) => !current);
          },
        }}
      />
      {isOpen ? (
        <TaskExecutionPanel
          model={{
            ...basePanelModel,
            activeTabId,
            onActiveTabChange: setActiveTabId,
            ciChecksModel: {
              isActive: activeTabId === "ci_checks",
              queryInput: ciQueryInput,
            },
          }}
        />
      ) : null}
    </>
  );
}

const renderCiPerformanceHarness = ({
  context,
  initiallyOpen,
  initialTabId,
}: {
  context: PullRequestReviewContext;
  initiallyOpen: boolean;
  initialTabId: TaskExecutionPanelModel["activeTabId"];
}) =>
  render(
    <QueryProvider useIsolatedClient>
      <ThemeProvider defaultTheme="light">
        <CiPerformanceHarness
          context={context}
          initiallyOpen={initiallyOpen}
          initialTabId={initialTabId}
        />
      </ThemeProvider>
    </QueryProvider>,
  );

const renderPanel = (model: TaskExecutionPanelModel): string =>
  renderToStaticMarkup(
    createElement(
      QueryProvider,
      { useIsolatedClient: true },
      createElement(ThemeProvider, null, createElement(TaskExecutionPanel, { model })),
    ),
  );

const renderPanelWithFileTreeData = (
  model: TaskExecutionPanelModel,
  fileTree: WorkspaceFileTree,
): string => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(
    filesystemQueryKeys.tree(fileTree.rootPath, model.fileExplorerModel.targetBranch),
    fileTree,
  );
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ThemeProvider, null, createElement(TaskExecutionPanel, { model })),
    ),
  );
};

const renderPanelWithCiData = (context: PullRequestReviewContext): string => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(pullRequestReviewQueryKeys.context(ciQueryInput), context);
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        ThemeProvider,
        null,
        createElement(TaskExecutionPanel, {
          model: {
            ...basePanelModel,
            ciChecksModel: {
              isActive: false,
              queryInput: ciQueryInput,
            },
          },
        }),
      ),
    ),
  );
};

describe("TaskExecutionPanelToggleButton", () => {
  test("renders hide label when task execution panel is open", () => {
    const model: TaskExecutionPanelToggleModel = {
      kind: "task_execution",
      isOpen: true,
      onToggle: () => {},
    };
    const html = renderToStaticMarkup(
      createElement(TaskExecutionPanelToggleButton, {
        model,
      }),
    );

    expect(html).toContain("Hide task execution panel");
  });

  test("renders show label when task execution panel is closed", () => {
    const model: TaskExecutionPanelToggleModel = {
      kind: "task_execution",
      isOpen: false,
      onToggle: () => {},
    };
    const html = renderToStaticMarkup(
      createElement(TaskExecutionPanelToggleButton, {
        model,
      }),
    );

    expect(html).toContain("Show task execution panel");
  });
});

describe("TaskExecutionPanel", () => {
  test("renders configured tabs and document content", () => {
    const html = renderPanel(basePanelModel);

    expect(html).toContain("task-execution-tab-document");
    expect(html).toContain("task-execution-tab-git");
    expect(html).toContain("task-execution-tab-file_explorer");
    expect(html).toContain("task-execution-tab-ci_checks");
    expect(html.match(/task-execution-tab-separator/g)?.length).toBe(3);
    expect(html.match(/task-execution-tab-active-icon/g)?.length).toBe(1);
    expect(html).toContain("cursor-pointer");
    expect(html).toContain("bg-transparent");
    expect(html).toContain("text-foreground");
    expect(html).toContain("Document");
    expect(html).toContain("Git");
    expect(html).toContain("File explorer");
    expect(html).toContain("CI Checks");
    expect(html).toContain("Specification");
    expect(html).toContain("Current specification document for this task.");
    expect(html).toContain("Spec");
  });

  test("renders Open In in the shared panel header", () => {
    const html = renderPanel({
      ...basePanelModel,
      gitModel: {
        ...diffModel,
        openInTargetPath: "/tmp/worktree/task-12",
        openInDisabledReason: null,
        openDirectoryInTool: async () => {},
      },
    });

    expect(html).toContain("agent-studio-git-open-in-actions");
    expect(html).toContain("agent-studio-git-open-in-default-button");
  });

  test("renders the pull request link once in the shared panel header", () => {
    const html = renderPanel({
      ...basePanelModel,
      gitModel: {
        ...diffModel,
        pullRequest: linkedPullRequest,
        openInTargetPath: "/tmp/worktree/task-12",
        openInDisabledReason: null,
        openDirectoryInTool: async () => {},
      },
    });

    expect(html.match(/PR #110/g)?.length).toBe(1);
    expect(html).toContain("agent-studio-git-open-in-actions");
  });

  test("renders cached CI status dot colors in the tab header", () => {
    const cases = [
      {
        expectedClassName: "bg-emerald-500",
        context: createLoadedCiContext({
          checks: [
            {
              name: "build",
              workflow: "CI",
              status: "completed",
              conclusion: "success",
              url: null,
              details: null,
              startedAt: null,
              completedAt: null,
            },
          ],
          openThreadCount: 0,
        }),
      },
      {
        expectedClassName: "bg-sky-500",
        context: createLoadedCiContext({
          checks: [
            {
              name: "test",
              workflow: "CI",
              status: "in_progress",
              conclusion: null,
              url: null,
              details: null,
              startedAt: null,
              completedAt: null,
            },
          ],
          openThreadCount: 0,
        }),
      },
      {
        expectedClassName: "bg-rose-500",
        context: createLoadedCiContext({
          checks: [
            {
              name: "lint",
              workflow: "CI",
              status: "completed",
              conclusion: "failure",
              url: null,
              details: null,
              startedAt: null,
              completedAt: null,
            },
          ],
          openThreadCount: 0,
        }),
      },
    ];

    for (const testCase of cases) {
      const html = renderPanelWithCiData(testCase.context);

      expect(html).toContain("task-execution-tab-ci-check-status");
      expect(html).toContain("size-1.5");
      expect(html).toContain("ring-1");
      expect(html).toContain(testCase.expectedClassName);
    }
  });

  test("renders the open review-thread counter only when threads are open", () => {
    const htmlWithOpenThreads = renderPanelWithCiData(
      createLoadedCiContext({
        checks: [
          {
            name: "lint",
            workflow: "CI",
            status: "completed",
            conclusion: "failure",
            url: null,
            details: null,
            startedAt: null,
            completedAt: null,
          },
        ],
        openThreadCount: 2,
      }),
    );

    expect(htmlWithOpenThreads).toContain("task-execution-tab-ci-open-threads");
    expect(htmlWithOpenThreads).toContain("h-3.5");
    expect(htmlWithOpenThreads).toContain("text-[9px]");
    expect(htmlWithOpenThreads).toContain("bg-warning-surface");
    expect(htmlWithOpenThreads).toContain("text-warning-surface-foreground");
    expect(htmlWithOpenThreads).not.toContain("bg-primary px-1");
    expect(htmlWithOpenThreads).toContain(">2</span>");
    expect(htmlWithOpenThreads).toContain(
      'aria-label="CI Checks, failing checks, 2 open review threads"',
    );

    const htmlWithoutOpenThreads = renderPanelWithCiData(
      createLoadedCiContext({
        checks: [
          {
            name: "build",
            workflow: "CI",
            status: "completed",
            conclusion: "success",
            url: null,
            details: null,
            startedAt: null,
            completedAt: null,
          },
        ],
        openThreadCount: 0,
      }),
    );

    expect(htmlWithoutOpenThreads).not.toContain("task-execution-tab-ci-open-threads");
    expect(htmlWithoutOpenThreads).toContain('aria-label="CI Checks, passing checks"');
  });

  test("activates cached CI content within budget before heavy comments render", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      const comments = Array.from({ length: 100 }, (_, index) => createPerformanceComment(index));
      const context = {
        ...createLoadedCiContext({ checks: [], openThreadCount: comments.length }),
        comments,
      };
      const view = renderCiPerformanceHarness({
        context,
        initiallyOpen: true,
        initialTabId: "git",
      });
      const ciTab = screen.getByRole("tab", { name: /CI Checks/ });

      expect(screen.queryByText("Performance marker 0")).toBeNull();
      const startedAt = performance.now();
      fireEvent.mouseDown(ciTab, { button: 0, ctrlKey: false });
      const activationDuration = performance.now() - startedAt;

      expect(ciTab.getAttribute("aria-selected")).toBe("true");
      expect(activationDuration).toBeLessThan(CI_INTERACTION_BUDGET_MS);
      expect(screen.queryByText("Performance marker 0")).toBeNull();
      expect(frameDriver.pendingFrameCount()).toBeGreaterThan(0);

      view.unmount();
      await frameDriver.flushMicrotasks();
    });
  });

  test("unmounts a 100-comment CI panel before reopening", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      const comments = Array.from({ length: 100 }, (_, index) => createPerformanceComment(index));
      const context = {
        ...createLoadedCiContext({ checks: [], openThreadCount: comments.length }),
        comments,
      };
      const view = renderCiPerformanceHarness({
        context,
        initiallyOpen: true,
        initialTabId: "ci_checks",
      });
      const gitTab = screen.getByRole("tab", { name: "Git" });

      expect(screen.getByText("Comments")).toBeTruthy();
      expect(screen.queryByText("Performance marker 0") === null).toBe(true);
      expect(frameDriver.pendingFrameCount()).toBeGreaterThan(0);

      fireEvent.mouseDown(gitTab, { button: 0, ctrlKey: false });

      expect(gitTab.getAttribute("aria-selected")).toBe("true");
      expect(screen.queryByText("Comments") === null).toBe(true);

      const reopenedCiTab = screen.getByRole("tab", { name: /CI Checks/ });
      fireEvent.mouseDown(reopenedCiTab, { button: 0, ctrlKey: false });

      expect(reopenedCiTab.getAttribute("aria-selected")).toBe("true");
      expect(screen.getByText("Comments")).toBeTruthy();
      expect(screen.queryByText("Performance marker 0") === null).toBe(true);
      expect(frameDriver.pendingFrameCount()).toBeGreaterThan(0);

      view.unmount();
      await frameDriver.flushMicrotasks();
    });
  });

  test("reopens a selected CI panel within budget before heavy comments render", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      const comments = Array.from({ length: 40 }, (_, index) => createPerformanceComment(index));
      const context = {
        ...createLoadedCiContext({ checks: [], openThreadCount: comments.length }),
        comments,
      };
      const view = renderCiPerformanceHarness({
        context,
        initiallyOpen: false,
        initialTabId: "ci_checks",
      });
      const showPanelButton = screen.getByRole("button", {
        name: "Show task execution panel",
      });

      const startedAt = performance.now();
      fireEvent.click(showPanelButton);
      const openDuration = performance.now() - startedAt;

      expect(screen.getByRole("tab", { name: /CI Checks/ }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(openDuration).toBeLessThan(CI_INTERACTION_BUDGET_MS);
      expect(screen.queryByText("Performance marker 0")).toBeNull();
      expect(frameDriver.pendingFrameCount()).toBeGreaterThan(0);

      view.unmount();
      await frameDriver.flushMicrotasks();
    });
  });

  test("renders Git content as a tab without Dev Server content", () => {
    const html = renderPanel({
      ...basePanelModel,
      tabs: [
        { id: "git", label: "Git" },
        { id: "file_explorer", label: "File explorer" },
      ],
      activeTabId: "git",
      documentModel: null,
      ciChecksModel: null,
    });

    expect(html).toContain("Current");
    expect(html).toContain("Target");
    expect(html).toContain("origin/main");
    expect(html).not.toContain("agent-studio-dev-server-terminal");
  });

  test("renders a copyable file explorer working directory without a duplicate search input", () => {
    const html = renderPanel({
      ...basePanelModel,
      tabs: [
        { id: "git", label: "Git" },
        { id: "file_explorer", label: "File explorer" },
      ],
      activeTabId: "file_explorer",
      documentModel: null,
      fileExplorerModel: {
        rootPath: "/repo/.worktrees/task-12",
        targetBranch: "origin/main",
        unavailableReason: null,
        isActive: true,
        selectedFile: null,
        onSelectFile: () => {},
        onClearSelectedFile: () => {},
      },
      ciChecksModel: null,
    });

    expect(html).toContain("task-execution-file-explorer-root-path");
    expect(html).toContain("/repo/.worktrees/task-12");
    expect(html).toContain("task-execution-file-explorer-copy-root-path");
    expect(html).toContain("Copy working directory");
    expect(html).not.toContain("Search files");
    expect(lastFileTreeOptions?.initialExpansion).toBe("closed");
  });

  test("prepares file explorer paths through PierreTrees sorting instead of the presorted fast path", () => {
    renderPanelWithFileTreeData(
      {
        ...basePanelModel,
        tabs: [
          { id: "git", label: "Git" },
          { id: "file_explorer", label: "File explorer" },
        ],
        activeTabId: "file_explorer",
        documentModel: null,
        fileExplorerModel: {
          rootPath: "/repo/.worktrees/task-12",
          targetBranch: "origin/main",
          unavailableReason: null,
          isActive: true,
          selectedFile: null,
          onSelectFile: () => {},
          onClearSelectedFile: () => {},
        },
        ciChecksModel: null,
      },
      {
        rootPath: "/repo/.worktrees/task-12",
        entries: [
          {
            kind: "file",
            path: "package.json",
            size: 24,
            mtimeMs: 1_760_000_000_000,
            gitStatus: "modified",
          },
          {
            kind: "file",
            path: "apps/web.ts",
            size: 24,
            mtimeMs: 1_760_000_000_000,
            gitStatus: "modified",
          },
          {
            kind: "file",
            path: "README.md",
            size: 24,
            mtimeMs: 1_760_000_000_000,
            gitStatus: null,
          },
        ],
      },
    );

    expect(prepareFileTreeInputCalls).toContainEqual(["package.json", "apps/web.ts", "README.md"]);
    expect(preparePresortedFileTreeInputCalls).toEqual([]);
  });

  test("clears the PierreTrees selection when the file preview is closed", async () => {
    fileTreeSelectedPaths = ["src/old.ts"];
    const fileTree: WorkspaceFileTree = {
      rootPath: "/repo/.worktrees/task-12",
      entries: [
        {
          kind: "file",
          path: "src/old.ts",
          size: 24,
          mtimeMs: 1_760_000_000_000,
          gitStatus: null,
        },
      ],
    };
    const queryClient = createQueryClient();
    queryClient.setQueryData(filesystemQueryKeys.tree(fileTree.rootPath, "origin/main"), fileTree);

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          ThemeProvider,
          null,
          createElement(TaskExecutionPanel, {
            model: {
              ...basePanelModel,
              tabs: [
                { id: "git", label: "Git" },
                { id: "file_explorer", label: "File explorer" },
              ],
              activeTabId: "file_explorer",
              documentModel: null,
              fileExplorerModel: {
                rootPath: fileTree.rootPath,
                targetBranch: "origin/main",
                unavailableReason: null,
                isActive: true,
                selectedFile: null,
                onSelectFile: () => {},
                onClearSelectedFile: () => {},
              },
              ciChecksModel: null,
            },
          }),
        ),
      ),
    );

    await waitFor(() => expect(deselectedFileTreePaths).toEqual(["src/old.ts"]));
    expect(fileTreeSelectedPaths).toEqual([]);
    expect(selectedOnlyFileTreePaths).toEqual([]);
  });

  test("selects files with the canonical root returned by the host", async () => {
    const onSelectFile = mock(() => {});
    const requestedRoot = "/repo/symlinked-worktree";
    const fileTree: WorkspaceFileTree = {
      rootPath: "/private/repo/worktree",
      entries: [
        {
          kind: "file",
          path: "src/index.ts",
          size: 24,
          mtimeMs: 1_760_000_000_000,
          gitStatus: null,
        },
      ],
    };
    const queryClient = createQueryClient();
    queryClient.setQueryData(filesystemQueryKeys.tree(requestedRoot, "origin/main"), fileTree);
    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          ThemeProvider,
          null,
          createElement(TaskExecutionPanel, {
            model: {
              ...basePanelModel,
              tabs: [
                { id: "git", label: "Git" },
                { id: "file_explorer", label: "File explorer" },
              ],
              activeTabId: "file_explorer",
              documentModel: null,
              fileExplorerModel: {
                rootPath: requestedRoot,
                targetBranch: "origin/main",
                unavailableReason: null,
                isActive: true,
                selectedFile: null,
                onSelectFile,
                onClearSelectedFile: () => {},
              },
            },
          }),
        ),
      ),
    );

    await waitFor(() => expect(fileTreeSubscriber).not.toBeNull());
    fileTreeSelectedPaths = ["src/index.ts"];
    act(() => fileTreeSubscriber?.());

    expect(onSelectFile).toHaveBeenCalledWith({
      rootPath: fileTree.rootPath,
      relativePath: "src/index.ts",
    });
  });

  test("clears a selected preview when the canonical file tree root changes", async () => {
    const onClearSelectedFile = mock(() => {});
    const requestedRoot = "/repo/task-worktree";
    const fileTree: WorkspaceFileTree = {
      rootPath: "/private/repo/new-task-worktree",
      entries: [],
    };
    const queryClient = createQueryClient();
    queryClient.setQueryData(filesystemQueryKeys.tree(requestedRoot, "origin/main"), fileTree);

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          ThemeProvider,
          null,
          createElement(TaskExecutionPanel, {
            model: {
              ...basePanelModel,
              tabs: [
                { id: "git", label: "Git" },
                { id: "file_explorer", label: "File explorer" },
              ],
              activeTabId: "file_explorer",
              documentModel: null,
              fileExplorerModel: {
                rootPath: requestedRoot,
                targetBranch: "origin/main",
                unavailableReason: null,
                isActive: true,
                selectedFile: {
                  rootPath: "/private/repo/old-task-worktree",
                  relativePath: "src/index.ts",
                },
                onSelectFile: () => {},
                onClearSelectedFile,
              },
            },
          }),
        ),
      ),
    );

    await waitFor(() => expect(onClearSelectedFile).toHaveBeenCalledTimes(1));
  });

  test("renders Dev Servers below the task execution panel", () => {
    const html = renderPanel({
      ...basePanelModel,
      tabs: [
        { id: "git", label: "Git" },
        { id: "file_explorer", label: "File explorer" },
      ],
      activeTabId: "git",
      documentModel: null,
      ciChecksModel: null,
      devServerModel,
    });

    expect(html).toContain("Git");
    expect(html).toContain("origin/main");
    expect(html).toContain("Stop");
    expect(html).toContain("agent-studio-dev-server-terminal");
    expect(html).not.toContain("Dev Servers</button>");
  });

  test("renders the dev server settings action in compact mode", () => {
    const html = renderPanel({
      ...basePanelModel,
      devServerModel: { ...devServerModel, isExpanded: false },
    });

    expect(html).toContain("Configure dev server commands");
  });
});
