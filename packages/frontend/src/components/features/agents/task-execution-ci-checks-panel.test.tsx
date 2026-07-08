import { describe, expect, test } from "bun:test";
import type { PullRequestReviewContext } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createQueryClient } from "@/lib/query-client";
import { pullRequestReviewQueryKeys } from "@/state/queries/pull-request-review";
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
  refreshedAt: "2026-07-08T10:08:00Z",
} satisfies PullRequestReviewContext;

const noPullRequestContext = {
  status: "no_pull_request",
  providerId: "github",
  reason: "No pull request found for the current branch.",
} satisfies PullRequestReviewContext;

const renderPanel = (queryClient = createQueryClient()): string => {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(TaskExecutionCiChecksPanel, {
        model: {
          isActive: true,
          queryInput,
        },
      }),
    ),
  );
};

const renderLoadedPanel = (): string => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(pullRequestReviewQueryKeys.context(queryInput), loadedContext);

  return renderPanel(queryClient);
};

describe("TaskExecutionCiChecksPanel", () => {
  test("renders a useful loading state while review data is pending", () => {
    const html = renderPanel();

    expect(html).toContain("Loading CI checks");
    expect(html).toContain("Reading the current pull request");
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

    expect(html).toContain("PR #42");
    expect(html).toContain("Rework task execution panel");
    expect(html).toContain("GitHub");
    expect(html).toContain("1 failing");
    expect(html).toContain("Unit tests");
    expect(html).toContain("CI");
    expect(html).toContain("1 suite failed");
    expect(html).toContain("Started");
    expect(html).toContain("2026-07-08T10:00:00Z");
    expect(html).toContain("Completed");
    expect(html).toContain("2026-07-08T10:05:00Z");
    expect(html).toContain("Review thread");
    expect(html).toContain("All");
    expect(html).toContain("Humans");
    expect(html).toContain("Bots");
    expect(html).toContain("codex");
    expect(html).toContain("Bot");
    expect(html).toContain("Needs review");
    expect(html).toContain("Thread thread-1");
    expect(html).toContain("Unresolved");
    expect(html).toContain("<strong>This thread still needs work.</strong>");
    expect(html).toContain("isAnyLoading");
    expect(html).toContain("Created");
    expect(html).toContain("2026-07-08T10:06:00Z");
    expect(html).toContain("Updated");
    expect(html).toContain("2026-07-08T10:07:00Z");
    expect(html).not.toContain("Open pull request #42");
  });

  test("classifies common automation authors as bots", () => {
    expect(isBotCommentAuthor("codex")).toBe(true);
    expect(isBotCommentAuthor("github-actions[bot]")).toBe(true);
    expect(isBotCommentAuthor("gemini-code-assist")).toBe(true);
    expect(isBotCommentAuthor("reviewer")).toBe(false);
  });
});
