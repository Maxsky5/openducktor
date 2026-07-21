import { describe, expect, test } from "bun:test";
import { pullRequestReviewContextSchema } from "./pull-request-review-schemas";

describe("pullRequestReviewContextSchema", () => {
  test("accepts provider-neutral pull request review contexts", () => {
    expect(
      pullRequestReviewContextSchema.parse({
        status: "unavailable",
        providerId: "gitlab",
        reason: "GitLab integration is not configured.",
      }),
    ).toEqual({
      status: "unavailable",
      providerId: "gitlab",
      reason: "GitLab integration is not configured.",
    });
  });

  test.each([
    {
      status: "no_pull_request" as const,
      providerId: "github",
      reason: "No pull request is linked.",
    },
    {
      status: "error" as const,
      providerId: "github",
      reason: "GitHub could not be reached.",
    },
  ])("accepts the $status variant", (context) => {
    expect(pullRequestReviewContextSchema.parse(context)).toEqual(context);
  });

  test("accepts a loaded review context with validated provider data", () => {
    const context = {
      status: "loaded" as const,
      providerId: "github",
      pullRequest: {
        providerId: "github",
        number: 733,
        title: "feat(agent-studio): rework task panel",
        url: "https://github.com/Maxsky5/openducktor/pull/733",
        state: "open" as const,
      },
      aggregateStatus: "pending" as const,
      checks: [
        {
          name: "test",
          workflow: "CI",
          status: "in_progress" as const,
          conclusion: null,
          url: "https://github.com/Maxsky5/openducktor/actions/runs/1",
          details: null,
          startedAt: "2026-07-10T08:00:00Z",
          completedAt: null,
        },
      ],
      comments: [
        {
          id: "comment-1",
          author: "reviewer",
          authorAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
          body: "Please adjust this.",
          patch: null,
          suggestionPatches: [],
          url: "https://github.com/Maxsky5/openducktor/pull/733#discussion_r1",
          createdAt: "2026-07-10T08:01:00Z",
          updatedAt: "2026-07-10T08:02:00Z",
          path: "src/index.ts",
          line: 1,
          threadId: "thread-1",
          isResolved: false,
          source: "review_thread" as const,
        },
      ],
      reviewThreads: { openCount: 1 },
      refreshedAt: "2026-07-10T08:03:00Z",
    };

    expect(pullRequestReviewContextSchema.parse(context)).toEqual(context);
  });

  test.each([
    ["pull request URL", ["pullRequest", "url"], "not a URL"],
    ["check URL", ["checks", 0, "url"], "not a URL"],
    ["comment author avatar URL", ["comments", 0, "authorAvatarUrl"], "not a URL"],
    ["comment timestamp", ["comments", 0, "createdAt"], "yesterday"],
    ["refresh timestamp", ["refreshedAt"], "soon"],
  ])("rejects an invalid %s", (_label, path, value) => {
    const context = {
      status: "loaded" as const,
      providerId: "github",
      pullRequest: {
        providerId: "github",
        number: 733,
        title: "Panel",
        url: "https://github.com/Maxsky5/openducktor/pull/733",
        state: "open" as const,
      },
      aggregateStatus: "success" as const,
      checks: [
        {
          name: "test",
          workflow: null,
          status: "completed" as const,
          conclusion: "success" as const,
          url: "https://github.com/Maxsky5/openducktor/actions/runs/1",
          details: null,
          startedAt: "2026-07-10T08:00:00Z",
          completedAt: "2026-07-10T08:01:00Z",
        },
      ],
      comments: [
        {
          id: "comment-1",
          author: null,
          authorAvatarUrl: null,
          body: "Done",
          patch: null,
          suggestionPatches: [],
          url: null,
          createdAt: "2026-07-10T08:00:00Z",
          updatedAt: null,
          path: null,
          line: null,
          threadId: null,
          isResolved: null,
          source: "comment" as const,
        },
      ],
      reviewThreads: { openCount: 0 },
      refreshedAt: "2026-07-10T08:02:00Z",
    } as Record<string, unknown>;
    let current: unknown = context;
    for (const segment of path.slice(0, -1)) {
      current = (current as Record<string | number, unknown>)[segment];
    }
    (current as Record<string | number, unknown>)[path.at(-1) as string | number] = value;

    expect(() => pullRequestReviewContextSchema.parse(context)).toThrow();
  });
});
