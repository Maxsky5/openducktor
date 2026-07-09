import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { GithubCommandDependencies } from "../tasks/support/github-pull-requests";
import { createGithubPullRequestReviewProvider } from "./github-pull-request-review-provider";

const createDependencies = ({
  commands = [],
  includeReviewId = true,
  pullRequestViewResponse = defaultPullRequestViewResponse(includeReviewId),
  reviewThreadNodes = defaultReviewThreadNodes,
}: {
  commands?: string[][];
  includeReviewId?: boolean;
  pullRequestViewResponse?: unknown;
  reviewThreadNodes?: unknown[];
} = {}): GithubCommandDependencies => {
  const systemCommands: Pick<SystemCommandPort, "runCommandAllowFailure"> = {
    runCommandAllowFailure: (_command, args) => {
      commands.push(args);
      const command = args.join(" ");
      if (command.includes("pr view")) {
        return Effect.succeed({
          ok: true,
          stdout: JSON.stringify(pullRequestViewResponse),
          stderr: "",
        });
      }
      if (command.includes("pr checks")) {
        return Effect.succeed({
          ok: true,
          stdout: JSON.stringify([
            {
              name: "lint",
              workflow: "CI",
              state: "SUCCESS",
              bucket: "pass",
              link: "https://github.com/openai/openducktor/actions/runs/1",
            },
            {
              name: "test",
              workflow: "CI",
              state: "FAILURE",
              bucket: "fail",
              link: "https://github.com/openai/openducktor/actions/runs/2",
            },
          ]),
          stderr: "",
        });
      }
      if (command.includes("api graphql")) {
        return Effect.succeed({
          ok: true,
          stdout: JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  reviewThreads: {
                    nodes: reviewThreadNodes,
                  },
                },
              },
            },
          }),
          stderr: "",
        });
      }
      return Effect.fail(
        new HostOperationError({
          operation: "gh",
          message: `Unexpected gh command: ${command}`,
        }),
      );
    },
  };

  return {
    resolveGithubCommand: () =>
      Effect.succeed({
        ghCommand: "gh",
        systemCommands: systemCommands as SystemCommandPort,
      }),
    systemCommands: systemCommands as SystemCommandPort,
    toolDiscovery: {} as GithubCommandDependencies["toolDiscovery"],
  };
};

const defaultPullRequestViewResponse = (includeReviewId: boolean): unknown => ({
  number: 42,
  title: "Rework panel",
  url: "https://github.com/openai/openducktor/pull/42",
  state: "OPEN",
  isDraft: false,
  comments: [
    {
      id: "comment-1",
      author: { login: "reviewer" },
      body: "Please check spacing.",
      url: "https://github.com/openai/openducktor/pull/42#issuecomment-1",
      createdAt: "2026-07-08T10:00:00Z",
      updatedAt: "2026-07-08T10:01:00Z",
    },
  ],
  reviews: [
    {
      ...(includeReviewId ? { id: "review-1" } : {}),
      author: { login: "reviewer" },
      body: "Changes requested.",
      state: "CHANGES_REQUESTED",
      submittedAt: "2026-07-08T10:02:00Z",
    },
  ],
});

const defaultReviewThreadNodes = [
  {
    id: "thread-1",
    isResolved: true,
    comments: {
      nodes: [
        {
          id: "thread-comment-1",
          author: { login: "reviewer" },
          body: "Resolved thread.",
          url: "https://github.com/openai/openducktor/pull/42#discussion_r1",
          createdAt: "2026-07-08T10:03:00Z",
          updatedAt: "2026-07-08T10:04:00Z",
          path: "packages/frontend/src/panel.tsx",
          line: 12,
        },
      ],
    },
  },
  {
    id: "thread-2",
    isResolved: false,
    comments: {
      nodes: [
        {
          id: "thread-comment-2",
          author: { login: "reviewer" },
          body: "Still open.",
          url: "https://github.com/openai/openducktor/pull/42#discussion_r2",
          createdAt: "2026-07-08T10:05:00Z",
          updatedAt: "2026-07-08T10:06:00Z",
          path: "packages/host/src/provider.ts",
          line: 33,
        },
        {
          id: "thread-comment-3",
          author: { login: "reviewer" },
          body: "Still open follow-up.",
          url: "https://github.com/openai/openducktor/pull/42#discussion_r3",
          createdAt: "2026-07-08T10:07:00Z",
          updatedAt: "2026-07-08T10:08:00Z",
          path: "packages/host/src/provider.ts",
          line: 34,
        },
      ],
    },
  },
];

const fairnestPullRequestReviewThreadNodes = [
  {
    id: "thread-fairnest-1",
    isResolved: false,
    comments: {
      nodes: [
        {
          id: "thread-comment-fairnest-1",
          author: { login: "gemini-code-assist" },
          body: "Disable all login options while any login flow is active.",
          url: "https://github.com/Maxsky5/fairnest/pull/128#discussion_r1",
          createdAt: "2026-07-08T20:19:39Z",
          updatedAt: "2026-07-08T20:19:39Z",
          path: "apps/web/src/components/LandingPage.tsx",
          line: 16,
        },
      ],
    },
  },
  {
    id: "thread-fairnest-2",
    isResolved: false,
    comments: {
      nodes: [
        {
          id: "thread-comment-fairnest-2",
          author: { login: "gemini-code-assist" },
          body: "The Facebook loading state should be included in the shared guard.",
          url: "https://github.com/Maxsky5/fairnest/pull/128#discussion_r2",
          createdAt: "2026-07-08T20:19:40Z",
          updatedAt: "2026-07-08T20:19:40Z",
          path: "apps/web/src/components/LandingPage.tsx",
          line: 86,
        },
      ],
    },
  },
  {
    id: "thread-fairnest-3",
    isResolved: false,
    comments: {
      nodes: [
        {
          id: "thread-comment-fairnest-3",
          author: { login: "gemini-code-assist" },
          body: "Apply the shared loading state to the Facebook button.",
          url: "https://github.com/Maxsky5/fairnest/pull/128#discussion_r3",
          createdAt: "2026-07-08T20:19:41Z",
          updatedAt: "2026-07-08T20:19:41Z",
          path: "apps/web/src/components/LandingPage.tsx",
          line: 119,
        },
      ],
    },
  },
  {
    id: "thread-fairnest-4",
    isResolved: false,
    comments: {
      nodes: [
        {
          id: "thread-comment-fairnest-4",
          author: { login: "chatgpt-codex-connector" },
          body: "The OAuth provider should be configured with the expected env values.",
          url: "https://github.com/Maxsky5/fairnest/pull/128#discussion_r4",
          createdAt: "2026-07-08T20:25:20Z",
          updatedAt: "2026-07-08T20:25:20Z",
          path: "apps/api/src/lib/auth.ts",
          line: 56,
        },
      ],
    },
  },
  {
    id: "thread-fairnest-5",
    isResolved: false,
    comments: {
      nodes: [
        {
          id: "thread-comment-fairnest-5",
          author: { login: "chatgpt-codex-connector" },
          body: "Validate the Facebook OAuth callback URL matches the app config.",
          url: "https://github.com/Maxsky5/fairnest/pull/128#discussion_r5",
          createdAt: "2026-07-08T20:25:21Z",
          updatedAt: "2026-07-08T20:25:21Z",
          path: "apps/api/src/lib/auth.ts",
          line: 56,
        },
      ],
    },
  },
];

const fairnestPullRequestViewResponse = {
  number: 128,
  title: "feat(auth): add Facebook OAuth login provider",
  url: "https://github.com/Maxsky5/fairnest/pull/128",
  state: "OPEN",
  isDraft: false,
  comments: [],
  reviews: [
    {
      id: "review-fairnest-gemini",
      author: { login: "gemini-code-assist" },
      body: "Code Review",
      state: "COMMENTED",
      submittedAt: "2026-07-08T20:19:39Z",
    },
    {
      id: "review-fairnest-codex",
      author: { login: "chatgpt-codex-connector" },
      body: "Codex Review",
      state: "COMMENTED",
      submittedAt: "2026-07-08T20:25:20Z",
    },
  ],
};

describe("createGithubPullRequestReviewProvider", () => {
  test("loads checks and comments through the gh command boundary", async () => {
    const provider = createGithubPullRequestReviewProvider();

    const context = await Effect.runPromise(
      provider.read({
        dependencies: createDependencies(),
        repoPath: "/repo",
        context: {
          repository: { host: "github.com", owner: "openai", name: "openducktor" },
          remoteName: "origin",
        },
        pullRequestNumber: 42,
      }),
    );

    expect(context.status).toBe("loaded");
    if (context.status !== "loaded") {
      return;
    }
    expect(context.pullRequest).toMatchObject({
      providerId: "github",
      number: 42,
      title: "Rework panel",
      state: "open",
    });
    expect(context.aggregateStatus).toBe("failure");
    expect(context.checks.map((check) => [check.name, check.conclusion])).toEqual([
      ["lint", "success"],
      ["test", "failure"],
    ]);
    expect(context.comments.map((comment) => [comment.id, comment.source])).toEqual([
      ["comment-1", "comment"],
      ["review-1", "review"],
      ["thread-comment-1", "review_thread"],
      ["thread-comment-2", "review_thread"],
      ["thread-comment-3", "review_thread"],
    ]);
    expect(context.reviewThreads).toEqual({
      openCount: 1,
    });
    expect(
      context.comments
        .filter((comment) => comment.source === "review_thread")
        .map((comment) => [
          comment.id,
          comment.threadId,
          comment.isResolved,
          comment.path,
          comment.line,
        ]),
    ).toEqual([
      ["thread-comment-1", "thread-1", true, "packages/frontend/src/panel.tsx", 12],
      ["thread-comment-2", "thread-2", false, "packages/host/src/provider.ts", 33],
      ["thread-comment-3", "thread-2", false, "packages/host/src/provider.ts", 34],
    ]);
  });

  test("scopes pull request gh commands with --repo instead of --hostname", async () => {
    const provider = createGithubPullRequestReviewProvider();
    const commands: string[][] = [];

    await Effect.runPromise(
      provider.read({
        dependencies: createDependencies({ commands }),
        repoPath: "/repo",
        context: {
          repository: { host: "github.com", owner: "openai", name: "openducktor" },
          remoteName: "origin",
        },
        pullRequestNumber: 42,
      }),
    );

    const pullRequestCommands = commands.filter((args) => args[0] === "pr");
    expect(pullRequestCommands).toEqual([
      [
        "pr",
        "view",
        "42",
        "--json",
        "number,title,url,state,isDraft,comments,reviews,latestReviews",
        "--repo",
        "openai/openducktor",
      ],
      [
        "pr",
        "checks",
        "42",
        "--json",
        "bucket,completedAt,description,event,link,name,startedAt,state,workflow",
        "--repo",
        "openai/openducktor",
      ],
    ]);
    expect(pullRequestCommands.flat()).not.toContain("--hostname");
  });

  test("loads review rows when gh omits review ids", async () => {
    const provider = createGithubPullRequestReviewProvider();

    const context = await Effect.runPromise(
      provider.read({
        dependencies: createDependencies({ includeReviewId: false }),
        repoPath: "/repo",
        context: {
          repository: { host: "github.com", owner: "openai", name: "openducktor" },
          remoteName: "origin",
        },
        pullRequestNumber: 42,
      }),
    );

    expect(context.status).toBe("loaded");
    if (context.status !== "loaded") {
      return;
    }
    expect(context.comments.map((comment) => [comment.id, comment.source])).toContainEqual([
      "github-review:0",
      "review",
    ]);
  });

  test("includes unresolved code review threads alongside review summaries", async () => {
    const provider = createGithubPullRequestReviewProvider();

    const context = await Effect.runPromise(
      provider.read({
        dependencies: createDependencies({
          pullRequestViewResponse: fairnestPullRequestViewResponse,
          reviewThreadNodes: fairnestPullRequestReviewThreadNodes,
        }),
        repoPath: "/repo",
        context: {
          repository: { host: "github.com", owner: "Maxsky5", name: "fairnest" },
          remoteName: "origin",
        },
        pullRequestNumber: 128,
      }),
    );

    expect(context.status).toBe("loaded");
    if (context.status !== "loaded") {
      return;
    }
    expect(context.comments).toHaveLength(7);
    expect(context.reviewThreads).toEqual({ openCount: 5 });
    expect(context.comments.map((comment) => comment.source)).toEqual([
      "review",
      "review",
      "review_thread",
      "review_thread",
      "review_thread",
      "review_thread",
      "review_thread",
    ]);
    expect(
      context.comments
        .filter((comment) => comment.source === "review_thread")
        .map((comment) => [comment.author, comment.path, comment.line, comment.isResolved]),
    ).toEqual([
      ["gemini-code-assist", "apps/web/src/components/LandingPage.tsx", 16, false],
      ["gemini-code-assist", "apps/web/src/components/LandingPage.tsx", 86, false],
      ["gemini-code-assist", "apps/web/src/components/LandingPage.tsx", 119, false],
      ["chatgpt-codex-connector", "apps/api/src/lib/auth.ts", 56, false],
      ["chatgpt-codex-connector", "apps/api/src/lib/auth.ts", 56, false],
    ]);
  });
});
