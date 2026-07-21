import { describe, expect, test } from "bun:test";
import type { PullRequestReviewComment, PullRequestReviewContext } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { type PropsWithChildren, type ReactElement, useState } from "react";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { QueryProvider } from "@/lib/query-provider";
import { pullRequestReviewQueryKeys } from "@/state/queries/pull-request-review";
import { withAnimationFrameTestDriver } from "@/test-utils/animation-frame-test-driver";
import type { AgentStudioGitPanelModel } from "./agent-studio-git-panel";
import {
  TaskExecutionPanel,
  type TaskExecutionPanelModel,
  TaskExecutionPanelToggleButton,
} from "./task-execution-panel";

const ciQueryInput = {
  repoPath: "/repo",
  taskId: "task-12",
};

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

const createLoadedCiContext = (comments: PullRequestReviewComment[]): PullRequestReviewContext => ({
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
  checks: [],
  comments,
  reviewThreads: {
    openCount: comments.length,
  },
  refreshedAt: "2026-07-08T10:08:00Z",
});

const gitModel: AgentStudioGitPanelModel = {
  contextMode: "worktree",
  branch: "feature/task-12",
  worktreePath: "/tmp/worktree/task-12",
  targetBranch: "origin/main",
  diffScope: "target",
  scopeStatesByScope: {
    target: {
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
    },
    uncommitted: {
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
    },
  },
  loadedScopesByScope: { target: true, uncommitted: true },
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

const basePanelModel = {
  tabs: [
    { id: "git", label: "Git" },
    { id: "ci_checks", label: "CI Checks" },
  ],
  activeTabId: "git",
  onActiveTabChange: () => {},
  documentModel: null,
  gitModel,
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
    queryInput: ciQueryInput,
  },
  devServerModel: null,
} satisfies TaskExecutionPanelModel;

function CiPerformanceHarness({
  initiallyOpen,
  initialTabId,
}: {
  initiallyOpen: boolean;
  initialTabId: TaskExecutionPanelModel["activeTabId"];
}): ReactElement {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [activeTabId, setActiveTabId] = useState(initialTabId);

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

function SeedCiPerformanceContext({
  children,
  context,
}: PropsWithChildren<{ context: PullRequestReviewContext }>): ReactElement {
  const queryClient = useQueryClient();
  useState(() => {
    queryClient.setQueryData(pullRequestReviewQueryKeys.context(ciQueryInput), context);
    return context;
  });
  return <>{children}</>;
}

const renderCiPerformanceHarness = ({
  comments,
  initiallyOpen,
  initialTabId,
}: {
  comments: PullRequestReviewComment[];
  initiallyOpen: boolean;
  initialTabId: TaskExecutionPanelModel["activeTabId"];
}) =>
  render(
    <QueryProvider useIsolatedClient>
      <ThemeProvider defaultTheme="light">
        <SeedCiPerformanceContext context={createLoadedCiContext(comments)}>
          <CiPerformanceHarness initiallyOpen={initiallyOpen} initialTabId={initialTabId} />
        </SeedCiPerformanceContext>
      </ThemeProvider>
    </QueryProvider>,
  );

describe("TaskExecutionPanel CI performance", () => {
  test("activates cached CI content before queued comment body work", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      const comments = Array.from({ length: 100 }, (_, index) => createPerformanceComment(index));
      const view = renderCiPerformanceHarness({
        comments,
        initiallyOpen: true,
        initialTabId: "git",
      });
      const ciTab = screen.getByRole("tab", { name: /CI Checks/ });

      expect(screen.queryByText("Performance marker 0")).toBeNull();
      fireEvent.mouseDown(ciTab, { button: 0, ctrlKey: false });

      expect(ciTab.getAttribute("aria-selected")).toBe("true");
      expect(screen.getAllByRole("article")).toHaveLength(100);
      expect(screen.queryByText("Performance marker 0")).toBeNull();
      expect(frameDriver.pendingFrameCount()).toBeGreaterThan(0);

      view.unmount();
      await frameDriver.flushMicrotasks();
    });
  });

  test("cancels hidden CI work and schedules it again when reopened", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      const comments = Array.from({ length: 100 }, (_, index) => createPerformanceComment(index));
      const view = renderCiPerformanceHarness({
        comments,
        initiallyOpen: true,
        initialTabId: "ci_checks",
      });
      const gitTab = screen.getByRole("tab", { name: "Git" });

      expect(screen.getByText("Comments")).toBeTruthy();
      expect(screen.queryByText("Performance marker 0")).toBeNull();
      expect(frameDriver.pendingFrameCount()).toBeGreaterThan(0);

      fireEvent.mouseDown(gitTab, { button: 0, ctrlKey: false });

      expect(gitTab.getAttribute("aria-selected")).toBe("true");
      expect(screen.queryByText("Comments")).toBeNull();

      const reopenedCiTab = screen.getByRole("tab", { name: /CI Checks/ });
      fireEvent.mouseDown(reopenedCiTab, { button: 0, ctrlKey: false });

      expect(reopenedCiTab.getAttribute("aria-selected")).toBe("true");
      expect(screen.getByText("Comments")).toBeTruthy();
      expect(screen.queryByText("Performance marker 0")).toBeNull();
      expect(frameDriver.pendingFrameCount()).toBeGreaterThan(0);

      view.unmount();
      await frameDriver.flushMicrotasks();
    });
  });

  test("reopens a selected CI panel before queued comment body work", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      const comments = Array.from({ length: 40 }, (_, index) => createPerformanceComment(index));
      const view = renderCiPerformanceHarness({
        comments,
        initiallyOpen: false,
        initialTabId: "ci_checks",
      });

      fireEvent.click(screen.getByRole("button", { name: "Show task execution panel" }));

      expect(screen.getByRole("tab", { name: /CI Checks/ }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(screen.getAllByRole("article")).toHaveLength(40);
      expect(screen.queryByText("Performance marker 0")).toBeNull();
      expect(frameDriver.pendingFrameCount()).toBeGreaterThan(0);

      view.unmount();
      await frameDriver.flushMicrotasks();
    });
  });
});
