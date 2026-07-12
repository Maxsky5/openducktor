import { describe, expect, test } from "bun:test";
import type { PullRequestReviewContext } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/query-client";
import { pullRequestReviewQueryKeys } from "@/state/queries/pull-request-review";
import { TaskExecutionCiCheckCard } from "./task-execution-ci-check-card";
import { TaskExecutionCiChecksPanel } from "./task-execution-ci-checks-panel";
import { TaskExecutionCiPanelState } from "./task-execution-ci-panel-state";
import { isBotCommentAuthor } from "./task-execution-ci-presentation";

const queryInput = {
  repoPath: "/repo",
  taskId: "task-12",
  workingDirectory: "/repo/worktree",
};

const loadedContext = {
  status: "loaded",
  providerId: "github",
  pullRequest: {
    providerId: "github",
    number: 42,
    title: "Rework task execution panel",
    url: "https://github.com/openai/openducktor/pull/42",
    state: "draft",
  },
  aggregateStatus: "failure",
  checks: [
    {
      name: "Unit tests",
      workflow: "CI",
      status: "completed",
      conclusion: "failure",
      url: "https://github.com/openai/openducktor/actions/runs/1",
      details: "1 suite failed",
      startedAt: "2026-07-08T10:00:00Z",
      completedAt: "2026-07-08T10:05:00Z",
    },
  ],
  comments: [
    {
      id: "thread-comment-1",
      author: "codex",
      body: "**This thread still needs work.** Use `isAnyLoading` before redirecting.",
      patch:
        "@@ -10,3 +10,3 @@\n-const isAnyLoading = isLoading;\n+const isAnyLoading = isGoogleLoading || isFacebookLoading || isLoading;\n",
      suggestionPatches: [
        "@@ -12,1 +12,1 @@\n-const isAnyLoading = isGoogleLoading || isFacebookLoading || isLoading;\n+const isAnyLoading = auth.isLoading;",
      ],
      url: "https://github.com/openai/openducktor/pull/42#discussion_r1",
      createdAt: "2026-07-08T10:06:00Z",
      updatedAt: "2026-07-08T10:07:00Z",
      path: "packages/frontend/src/panel.tsx",
      line: 12,
      threadId: "thread-1",
      isResolved: false,
      source: "review_thread",
    },
  ],
  reviewThreads: {
    openCount: 1,
  },
  refreshedAt: "2026-07-08T10:08:00Z",
} satisfies PullRequestReviewContext;

const noPullRequestContext = {
  status: "no_pull_request",
  providerId: "github",
  reason: "No pull request found for the current branch.",
} satisfies PullRequestReviewContext;

const renderPanel = (queryClient = createQueryClient()): string => {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <TaskExecutionCiChecksPanel
            model={{
              isActive: true,
              queryInput,
            }}
          />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
};

const renderLoadedPanel = (): string => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(pullRequestReviewQueryKeys.context(queryInput), loadedContext);

  return renderPanel(queryClient);
};

const renderPendingPanel = (): string => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(pullRequestReviewQueryKeys.context(queryInput), {
    ...loadedContext,
    aggregateStatus: "pending",
    comments: [],
    checks: [
      {
        name: "Unit tests",
        workflow: "CI",
        status: "in_progress",
        conclusion: null,
        url: "https://github.com/openai/openducktor/actions/runs/1",
        details: null,
        startedAt: "2026-07-08T10:00:00Z",
        completedAt: null,
      },
    ],
    reviewThreads: {
      openCount: 0,
    },
  } satisfies PullRequestReviewContext);

  return renderPanel(queryClient);
};

const renderCheckCard = (status: "queued" | "in_progress" | "unknown"): string =>
  renderToStaticMarkup(
    <TaskExecutionCiCheckCard
      check={{
        name: `${status} check`,
        workflow: "CI",
        status,
        conclusion: null,
        url: null,
        details: null,
        startedAt: null,
        completedAt: null,
      }}
    />,
  );

describe("TaskExecutionCiChecksPanel", () => {
  test("renders a useful loading state while review data is pending", () => {
    const html = renderPanel();

    expect(html).toContain("Loading CI checks");
    expect(html).toContain("Reading the current pull request");
    expect(html).not.toContain("h-8 rounded-md bg-muted");
  });

  test("renders an actionable unavailable state with the provider reason", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(pullRequestReviewQueryKeys.context(queryInput), noPullRequestContext);

    const html = renderPanel(queryClient);

    expect(html).toContain("No pull request found");
    expect(html).toContain("Create or link a pull request");
    expect(html).toContain("No pull request found for the current branch.");
    expect(html).toContain("Refresh");
  });

  test("renders error states with context, details, and retry affordance", () => {
    const html = renderToStaticMarkup(
      createElement(TaskExecutionCiPanelState, {
        kind: "error",
        title: "Could not load CI checks",
        message: "OpenDucktor could not read pull request review data from GitHub.",
        detail: "Failed to fetch",
        actionLabel: "Retry",
        onAction: () => undefined,
      }),
    );

    expect(html).toContain("Could not load CI checks");
    expect(html).toContain("OpenDucktor could not read pull request review data from GitHub.");
    expect(html).toContain("Failed to fetch");
    expect(html).toContain("Retry");
  });

  test("renders visible feedback while a state action is pending", () => {
    const html = renderToStaticMarkup(
      createElement(TaskExecutionCiPanelState, {
        kind: "error",
        title: "Could not load CI checks",
        message: "OpenDucktor could not read pull request review data from GitHub.",
        detail: "Failed to fetch",
        actionLabel: "Refresh",
        actionPendingLabel: "Refreshing",
        isActionPending: true,
        onAction: () => undefined,
      }),
    );

    expect(html).toContain("Refreshing");
    expect(html).toContain("disabled");
  });

  test("renders provider-neutral PR, check, and review-thread metadata", () => {
    const html = renderLoadedPanel();

    expect(html).toContain("Rework task execution panel");
    expect(html).toContain("1 failing");
    expect(html).toContain("Unit tests");
    expect(html).toContain("CI");
    expect(html).toContain("1 suite failed");
    expect(html).toContain("Started");
    expect(html).toContain("2026-07-08T10:00:00Z");
    expect(html).toContain("Completed");
    expect(html).toContain("2026-07-08T10:05:00Z");
    expect(html).not.toContain("Review thread");
    expect(html).toContain("All");
    expect(html).toContain("Humans");
    expect(html).toContain("Bots");
    expect(html).toContain("codex");
    expect(html).toContain("Bot");
    expect(html).toContain("Needs review");
    expect(html).toContain("Unresolved");
    expect(html).toContain("This thread still needs work.");
    expect(html).toContain("isAnyLoading");
    expect(html).not.toContain('Updated <time dateTime="2026-07-08T10:06:00Z"');
    expect(html).not.toContain('Created <time dateTime="2026-07-08T10:06:00Z"');
    expect(html).toContain("ago");
    expect(html).toContain("2026-07-08T10:06:00Z");
    expect(html).toContain('data-testid="ci-review-comment-diff"');
    expect(html).toContain('data-testid="ci-review-comment-suggestion-diff"');
    expect(html.indexOf('data-testid="ci-review-comment-diff"')).toBeLessThan(
      html.indexOf("This thread still needs work."),
    );
    expect(html.indexOf("This thread still needs work.")).toBeLessThan(
      html.indexOf('data-testid="ci-review-comment-suggestion-diff"'),
    );
    expect(html).not.toContain("language-ts");
    expect(html).toContain('aria-label="Open comment from codex"');
    expect(html).toContain("prose-pre:whitespace-pre-wrap");
    expect(html).toContain("prose-pre:break-words");
    expect(html).not.toContain("<footer");
    expect(html).not.toContain("Thread thread-1");
    expect(html).not.toContain("PR #42");
    expect(html).not.toContain(">GitHub<");
    expect(html).not.toContain("Open pull request #42");
  });

  test("renders pending check icons and labels as informational blue", () => {
    const html = renderPendingPanel();

    expect(html).toContain("1 pending");
    expect(html).toContain("in progress");
    expect(html).toContain("bg-info-surface");
    expect(html).toContain("text-info-surface-foreground");
    expect(html).toContain("text-info-muted");
  });

  test("colors only queued and in-progress check rows as informational blue", () => {
    for (const status of ["queued", "in_progress"] as const) {
      const html = renderCheckCard(status);

      expect(html).toContain("lucide-clock");
      expect(html.match(/text-info-muted/g)?.length).toBe(2);
    }

    const unknownHtml = renderCheckCard("unknown");

    expect(unknownHtml).toContain("lucide-circle-dashed");
    expect(unknownHtml).toContain("text-muted-foreground");
    expect(unknownHtml).not.toContain("text-info-muted");
  });

  test("classifies common automation authors as bots", () => {
    expect(isBotCommentAuthor("codex")).toBe(true);
    expect(isBotCommentAuthor("github-actions[bot]")).toBe(true);
    expect(isBotCommentAuthor("gemini-code-assist")).toBe(true);
    expect(isBotCommentAuthor("reviewer")).toBe(false);
  });
});
