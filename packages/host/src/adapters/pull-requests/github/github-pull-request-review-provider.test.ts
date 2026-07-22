import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { GithubCommandDependencies } from "../../../application/tasks/support/github-pull-requests";
import { HostOperationError } from "../../../effect/host-errors";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import { createGithubPullRequestReviewProvider } from "./github-pull-request-review-provider";

const createDependencies = ({
  commandActivity,
  commandDelayMs = 0,
  commands = [],
  pullRequestViewResponse = defaultPullRequestViewResponse(),
  reviewThreadNodes = defaultReviewThreadNodes,
  reviewThreadResponse,
  checksResponse,
}: {
  commandActivity?: { active: number; maxActive: number };
  commandDelayMs?: number;
  commands?: string[][];
  pullRequestViewResponse?: unknown;
  reviewThreadNodes?: unknown[];
  reviewThreadResponse?: (args: string[]) => unknown;
  checksResponse?: {
    ok: boolean;
    stdout: unknown;
    rawStdout?: string;
    stderr?: string;
    exitCode?: number | null;
  };
} = {}): GithubCommandDependencies => {
  const succeed = (stdout: unknown) =>
    Effect.gen(function* () {
      if (commandActivity) {
        commandActivity.active += 1;
        commandActivity.maxActive = Math.max(commandActivity.maxActive, commandActivity.active);
      }
      if (commandDelayMs > 0) {
        yield* Effect.sleep(`${commandDelayMs} millis`);
      }
      if (commandActivity) {
        commandActivity.active -= 1;
      }
      return {
        ok: true,
        stdout: JSON.stringify(stdout),
        stderr: "",
      };
    });
  const systemCommands: Pick<SystemCommandPort, "runCommandAllowFailure"> = {
    runCommandAllowFailure: (_command, args) => {
      commands.push(args);
      const command = args.join(" ");
      if (command.includes("pr checks")) {
        if (checksResponse) {
          return Effect.succeed({
            ok: checksResponse.ok,
            stdout: checksResponse.rawStdout ?? JSON.stringify(checksResponse.stdout),
            stderr: checksResponse.stderr ?? "",
            exitCode: checksResponse.exitCode,
          });
        }
        return succeed([
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
        ]);
      }
      if (command.includes("api graphql")) {
        if (command.includes("PullRequestReviewOverview")) {
          const view = pullRequestViewResponse as {
            comments?: unknown[];
            reviews?: unknown[];
            [key: string]: unknown;
          };
          return succeed({
            data: {
              repository: {
                pullRequest: {
                  ...view,
                  comments: {
                    nodes: view.comments ?? [],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                  reviews: {
                    nodes: view.reviews ?? [],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              },
            },
          });
        }
        return succeed(
          reviewThreadResponse?.(args) ?? {
            data: {
              repository: {
                pullRequest: {
                  reviewThreads: {
                    nodes: reviewThreadNodes,
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              },
            },
          },
        );
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

const reviewerAvatarUrl = "https://avatars.githubusercontent.com/u/1?v=4";

const defaultPullRequestViewResponse = (): unknown => ({
  number: 42,
  title: "Rework panel",
  url: "https://github.com/openai/openducktor/pull/42",
  state: "OPEN",
  isDraft: false,
  comments: [
    {
      id: "comment-1",
      author: { login: "reviewer", avatarUrl: reviewerAvatarUrl },
      body: "Please check spacing.",
      url: "https://github.com/openai/openducktor/pull/42#issuecomment-1",
      createdAt: "2026-07-08T10:00:00Z",
      updatedAt: "2026-07-08T10:01:00Z",
    },
  ],
  reviews: [
    {
      id: "review-1",
      author: { login: "reviewer", avatarUrl: reviewerAvatarUrl },
      body: "Changes requested.",
      state: "CHANGES_REQUESTED",
      url: "https://github.com/openai/openducktor/pull/42#pullrequestreview-1",
      createdAt: "2026-07-08T10:02:00Z",
      submittedAt: "2026-07-08T10:02:00Z",
      updatedAt: "2026-07-08T10:02:00Z",
    },
  ],
});

const defaultReviewThreadNodes = [
  {
    id: "thread-1",
    isResolved: true,
    comments: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        {
          id: "thread-comment-1",
          author: { login: "reviewer", avatarUrl: reviewerAvatarUrl },
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
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        {
          id: "thread-comment-2",
          author: { login: "reviewer", avatarUrl: reviewerAvatarUrl },
          body: "Still open.",
          url: "https://github.com/openai/openducktor/pull/42#discussion_r2",
          createdAt: "2026-07-08T10:05:00Z",
          updatedAt: "2026-07-08T10:06:00Z",
          path: "packages/host/src/provider.ts",
          line: 33,
        },
        {
          id: "thread-comment-3",
          author: { login: "reviewer", avatarUrl: reviewerAvatarUrl },
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

const fairnestSuggestionBody = [
  "Disable all login options while any login flow is active.",
  "",
  "```suggestion",
  "  const [isGoogleLoading, setIsGoogleLoading] = useState(false);",
  "  const [isFacebookLoading, setIsFacebookLoading] = useState(false);",
  "",
  "  const isAnyLoading = isGoogleLoading || isFacebookLoading || isLoading;",
  "```",
].join("\n");

const fairnestPullRequestReviewThreadNodes = [
  {
    id: "thread-fairnest-1",
    isResolved: false,
    comments: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        {
          id: "thread-comment-fairnest-1",
          author: { login: "gemini-code-assist" },
          body: fairnestSuggestionBody,
          diffHunk: [
            "@@ -12,7 +12,8 @@ export default function LandingPage() {",
            "   const { login } = useAuth();",
            "   const [devEmail, setDevEmail] = useState('');",
            "   const [isLoading, setIsLoading] = useState(false);",
            "-  const [isLoggingIn, setIsLoggingIn] = useState(false);",
            "+  const [isGoogleLoading, setIsGoogleLoading] = useState(false);",
            "+  const [isFacebookLoading, setIsFacebookLoading] = useState(false);",
          ].join("\n"),
          url: "https://github.com/Maxsky5/fairnest/pull/128#discussion_r1",
          createdAt: "2026-07-08T20:19:39Z",
          updatedAt: "2026-07-08T20:19:39Z",
          path: "apps/web/src/components/LandingPage.tsx",
          startLine: 15,
          line: 16,
        },
      ],
    },
  },
  {
    id: "thread-fairnest-2",
    isResolved: false,
    comments: {
      pageInfo: { hasNextPage: false, endCursor: null },
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
      pageInfo: { hasNextPage: false, endCursor: null },
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
      pageInfo: { hasNextPage: false, endCursor: null },
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
      pageInfo: { hasNextPage: false, endCursor: null },
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
    const commands: string[][] = [];

    const context = await Effect.runPromise(
      provider.read({
        dependencies: createDependencies({ commands }),
        repoPath: "/repo",
        repository: { host: "github.com", owner: "openai", name: "openducktor" },
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
    expect(context.comments.map((comment) => comment.authorAvatarUrl)).toEqual([
      reviewerAvatarUrl,
      reviewerAvatarUrl,
      reviewerAvatarUrl,
      reviewerAvatarUrl,
      reviewerAvatarUrl,
    ]);
    const overviewCommand = commands.find((args) =>
      args.join(" ").includes("PullRequestReviewOverview"),
    );
    expect(overviewCommand?.join(" ")).toContain("avatarUrl(size: 64)");
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

  test("scopes pull request gh commands to the configured host and repository", async () => {
    const provider = createGithubPullRequestReviewProvider();
    const commands: string[][] = [];

    await Effect.runPromise(
      provider.read({
        dependencies: createDependencies({ commands }),
        repoPath: "/repo",
        repository: { host: "github.com", owner: "openai", name: "openducktor" },
        pullRequestNumber: 42,
      }),
    );

    const pullRequestCommands = commands.filter((args) => args[0] === "pr");
    expect(pullRequestCommands).toHaveLength(1);
    expect(pullRequestCommands).toContainEqual([
      "pr",
      "checks",
      "42",
      "--json",
      "bucket,completedAt,description,event,link,name,startedAt,state,workflow",
      "--repo",
      "github.com/openai/openducktor",
    ]);
    expect(pullRequestCommands.flat()).not.toContain("--hostname");
  });

  test("uses the full review history", async () => {
    const provider = createGithubPullRequestReviewProvider();
    const pullRequestViewResponse = defaultPullRequestViewResponse() as {
      reviews: unknown[];
    };
    pullRequestViewResponse.reviews.push({
      id: "review-2",
      author: { login: "reviewer" },
      body: "Follow-up review.",
      state: "COMMENTED",
      submittedAt: "2026-07-08T10:03:00Z",
    });

    const context = await Effect.runPromise(
      provider.read({
        dependencies: createDependencies({ pullRequestViewResponse }),
        repoPath: "/repo",
        repository: { host: "github.com", owner: "openai", name: "openducktor" },
        pullRequestNumber: 42,
      }),
    );

    expect(context.status).toBe("loaded");
    if (context.status !== "loaded") {
      return;
    }
    expect(
      context.comments
        .filter((comment) => comment.source === "review")
        .map((comment) => [comment.body, comment.reviewOutcome]),
    ).toEqual([
      ["Changes requested.", "changes_requested"],
      ["Follow-up review.", "commented"],
    ]);
  });

  test("includes unresolved code review threads alongside review summaries", async () => {
    const provider = createGithubPullRequestReviewProvider();
    const commands: string[][] = [];

    const context = await Effect.runPromise(
      provider.read({
        dependencies: createDependencies({
          commands,
          pullRequestViewResponse: fairnestPullRequestViewResponse,
          reviewThreadNodes: fairnestPullRequestReviewThreadNodes,
        }),
        repoPath: "/repo",
        repository: { host: "github.com", owner: "Maxsky5", name: "fairnest" },
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
        .map((comment) => [
          comment.author,
          comment.path,
          comment.line,
          comment.isResolved,
          comment.patch,
        ]),
    ).toEqual([
      [
        "gemini-code-assist",
        "apps/web/src/components/LandingPage.tsx",
        16,
        false,
        [
          "@@ -12,7 +12,8 @@ export default function LandingPage() {",
          "   const { login } = useAuth();",
          "   const [devEmail, setDevEmail] = useState('');",
          "   const [isLoading, setIsLoading] = useState(false);",
          "-  const [isLoggingIn, setIsLoggingIn] = useState(false);",
          "+  const [isGoogleLoading, setIsGoogleLoading] = useState(false);",
          "+  const [isFacebookLoading, setIsFacebookLoading] = useState(false);",
        ].join("\n"),
      ],
      ["gemini-code-assist", "apps/web/src/components/LandingPage.tsx", 86, false, null],
      ["gemini-code-assist", "apps/web/src/components/LandingPage.tsx", 119, false, null],
      ["chatgpt-codex-connector", "apps/api/src/lib/auth.ts", 56, false, null],
      ["chatgpt-codex-connector", "apps/api/src/lib/auth.ts", 56, false, null],
    ]);
    expect(context.comments[2]?.body).toBe(
      "Disable all login options while any login flow is active.",
    );
    expect(context.comments[2]?.suggestionPatches).toEqual([
      [
        "@@ -15,2 +15,4 @@",
        "-  const [isGoogleLoading, setIsGoogleLoading] = useState(false);",
        "-  const [isFacebookLoading, setIsFacebookLoading] = useState(false);",
        "+  const [isGoogleLoading, setIsGoogleLoading] = useState(false);",
        "+  const [isFacebookLoading, setIsFacebookLoading] = useState(false);",
        "+",
        "+  const isAnyLoading = isGoogleLoading || isFacebookLoading || isLoading;",
      ].join("\n"),
    ]);
    expect(commands.flat().join(" ")).toContain("diffHunk");
  });

  test("preserves suggestion-only review thread comments", async () => {
    const suggestionBody = ["```suggestion", "const enabled = isReady && isValid;", "```"].join(
      "\n",
    );
    const provider = createGithubPullRequestReviewProvider();
    const context = await Effect.runPromise(
      provider.read({
        dependencies: createDependencies({
          pullRequestViewResponse: fairnestPullRequestViewResponse,
          reviewThreadNodes: [
            {
              id: "thread-suggestion-only",
              isResolved: false,
              comments: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "thread-comment-suggestion-only",
                    author: { login: "reviewer" },
                    body: suggestionBody,
                    diffHunk: "@@ -1,1 +1,1 @@\n const enabled = false;",
                    url: "https://github.com/Maxsky5/fairnest/pull/128#discussion-suggestion",
                    createdAt: "2026-07-08T20:19:39Z",
                    updatedAt: "2026-07-08T20:19:39Z",
                    path: "apps/web/src/example.ts",
                    line: 1,
                  },
                ],
              },
            },
          ],
        }),
        repoPath: "/repo",
        repository: { host: "github.com", owner: "Maxsky5", name: "fairnest" },
        pullRequestNumber: 128,
      }),
    );

    expect(context.status).toBe("loaded");
    if (context.status !== "loaded") {
      return;
    }
    const suggestionComment = context.comments.find(
      (comment) => comment.id === "thread-comment-suggestion-only",
    );
    expect(suggestionComment?.body).toBe("");
    expect(suggestionComment?.suggestionPatches).toEqual([
      "@@ -1,1 +1,1 @@\n-const enabled = false;\n+const enabled = isReady && isValid;",
    ]);
  });

  test("preserves suggestion markdown when an outdated comment has no line metadata", async () => {
    const suggestionBody = ["```suggestion", "const enabled = true;", "```"].join("\n");
    const provider = createGithubPullRequestReviewProvider();
    const context = await Effect.runPromise(
      provider.read({
        dependencies: createDependencies({
          pullRequestViewResponse: fairnestPullRequestViewResponse,
          reviewThreadNodes: [
            {
              id: "thread-outdated-suggestion",
              isResolved: false,
              comments: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "thread-comment-outdated-suggestion",
                    author: { login: "reviewer" },
                    body: suggestionBody,
                    diffHunk: "@@ -1,1 +1,1 @@\n const enabled = false;",
                    url: "https://github.com/Maxsky5/fairnest/pull/128#discussion-outdated",
                    createdAt: "2026-07-08T20:19:39Z",
                    updatedAt: "2026-07-08T20:19:39Z",
                    path: "apps/web/src/example.ts",
                    line: null,
                    originalLine: null,
                  },
                ],
              },
            },
          ],
        }),
        repoPath: "/repo",
        repository: { host: "github.com", owner: "Maxsky5", name: "fairnest" },
        pullRequestNumber: 128,
      }),
    );

    expect(context.status).toBe("loaded");
    if (context.status !== "loaded") {
      return;
    }
    const suggestionComment = context.comments.find(
      (comment) => comment.id === "thread-comment-outdated-suggestion",
    );
    expect(suggestionComment?.body).toBe(suggestionBody);
    expect(suggestionComment?.suggestionPatches).toEqual([]);
  });

  test("loads every review thread and comment page", async () => {
    const commands: string[][] = [];
    const provider = createGithubPullRequestReviewProvider();
    const reviewThreadResponse = (args: string[]): unknown => {
      const command = args.join(" ");
      if (command.includes("PullRequestReviewThreadComments")) {
        expect(command).toContain("threadId=thread-1");
        expect(command).toContain("commentsCursor=comments-page-2");
        return {
          data: {
            node: {
              id: "thread-1",
              isResolved: false,
              comments: {
                nodes: [
                  {
                    id: "thread-1-comment-2",
                    author: { login: "reviewer" },
                    body: "Second comment page",
                    url: "https://example.com/thread-1-comment-2",
                    createdAt: "2026-07-10T08:02:00.000Z",
                    updatedAt: "2026-07-10T08:02:00.000Z",
                    path: "src/one.ts",
                    line: 2,
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        };
      }
      if (command.includes("threadsCursor=threads-page-2")) {
        return {
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [
                    {
                      id: "thread-2",
                      isResolved: false,
                      comments: {
                        nodes: [
                          {
                            id: "thread-2-comment-1",
                            author: { login: "reviewer" },
                            body: "Second thread page",
                            url: "https://example.com/thread-2-comment-1",
                            createdAt: "2026-07-10T08:03:00.000Z",
                            updatedAt: "2026-07-10T08:03:00.000Z",
                            path: "src/two.ts",
                            line: 3,
                          },
                        ],
                        pageInfo: { hasNextPage: false, endCursor: null },
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        };
      }
      return {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    id: "thread-1",
                    isResolved: false,
                    comments: {
                      nodes: [
                        {
                          id: "thread-1-comment-1",
                          author: { login: "reviewer" },
                          body: "First comment page",
                          url: "https://example.com/thread-1-comment-1",
                          createdAt: "2026-07-10T08:01:00.000Z",
                          updatedAt: "2026-07-10T08:01:00.000Z",
                          path: "src/one.ts",
                          line: 1,
                        },
                      ],
                      pageInfo: { hasNextPage: true, endCursor: "comments-page-2" },
                    },
                  },
                ],
                pageInfo: { hasNextPage: true, endCursor: "threads-page-2" },
              },
            },
          },
        },
      };
    };

    const context = await Effect.runPromise(
      provider.read({
        dependencies: createDependencies({ commands, reviewThreadResponse }),
        repoPath: "/repo",
        repository: { host: "github.com", owner: "openai", name: "openducktor" },
        pullRequestNumber: 42,
      }),
    );

    expect(context.status).toBe("loaded");
    if (context.status !== "loaded") {
      return;
    }
    expect(
      context.comments
        .filter((comment) => comment.source === "review_thread")
        .map((comment) => comment.id),
    ).toEqual(["thread-1-comment-1", "thread-1-comment-2", "thread-2-comment-1"]);
    expect(context.reviewThreads).toEqual({ openCount: 2 });
    expect(commands.filter((args) => args.includes("api"))).toHaveLength(4);
  });

  test("loads independent pull request resources concurrently", async () => {
    const commandActivity = { active: 0, maxActive: 0 };
    const provider = createGithubPullRequestReviewProvider();

    await Effect.runPromise(
      provider.read({
        dependencies: createDependencies({ commandActivity, commandDelayMs: 20 }),
        repoPath: "/repo",
        repository: { host: "github.com", owner: "openai", name: "openducktor" },
        pullRequestNumber: 42,
      }),
    );

    expect(commandActivity.maxActive).toBe(3);
  });

  test("loads pending checks from gh exit code 8", async () => {
    const provider = createGithubPullRequestReviewProvider();

    const context = await Effect.runPromise(
      provider.read({
        dependencies: createDependencies({
          checksResponse: {
            ok: false,
            exitCode: 8,
            stdout: [
              {
                name: "build",
                workflow: "CI",
                state: "IN_PROGRESS",
                bucket: "pending",
                link: "https://github.com/openai/openducktor/actions/runs/3",
              },
            ],
          },
        }),
        repoPath: "/repo",
        repository: { host: "github.com", owner: "openai", name: "openducktor" },
        pullRequestNumber: 42,
      }),
    );

    expect(context.status).toBe("loaded");
    if (context.status !== "loaded") {
      return;
    }
    expect(context.aggregateStatus).toBe("pending");
    expect(context.checks).toMatchObject([
      { name: "build", status: "in_progress", conclusion: null },
    ]);
  });

  test("loads an empty check list when gh reports no checks", async () => {
    const provider = createGithubPullRequestReviewProvider();

    const context = await Effect.runPromise(
      provider.read({
        dependencies: createDependencies({
          checksResponse: {
            ok: false,
            exitCode: 1,
            stdout: [],
            rawStdout: "",
            stderr: "no checks reported on the 'feature/review' branch",
          },
        }),
        repoPath: "/repo",
        repository: { host: "github.com", owner: "openai", name: "openducktor" },
        pullRequestNumber: 42,
      }),
    );

    expect(context.status).toBe("loaded");
    if (context.status !== "loaded") {
      return;
    }
    expect(context.aggregateStatus).toBe("unknown");
    expect(context.checks).toEqual([]);
  });

  test("returns malformed review contexts through the typed error channel", async () => {
    const provider = createGithubPullRequestReviewProvider();
    const malformedView = {
      ...(defaultPullRequestViewResponse() as Record<string, unknown>),
      url: "not-a-url",
    };

    const result = await Effect.runPromise(
      provider
        .read({
          dependencies: createDependencies({ pullRequestViewResponse: malformedView }),
          repoPath: "/repo",
          repository: { host: "github.com", owner: "openai", name: "openducktor" },
          pullRequestNumber: 42,
        })
        .pipe(Effect.either),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("HostValidationError");
      expect(result.left.field).toBe("github.review_context");
    }
  });

  test("maps the gh cancel bucket to a cancelled check", async () => {
    const provider = createGithubPullRequestReviewProvider();

    const context = await Effect.runPromise(
      provider.read({
        dependencies: createDependencies({
          checksResponse: {
            ok: true,
            stdout: [
              {
                name: "build",
                workflow: "CI",
                state: "COMPLETED",
                bucket: "cancel",
                link: "https://github.com/openai/openducktor/actions/runs/4",
              },
            ],
          },
        }),
        repoPath: "/repo",
        repository: { host: "github.com", owner: "openai", name: "openducktor" },
        pullRequestNumber: 42,
      }),
    );

    expect(context.status).toBe("loaded");
    if (context.status !== "loaded") {
      return;
    }
    expect(context.aggregateStatus).toBe("failure");
    expect(context.checks[0]?.conclusion).toBe("cancelled");
  });

  test("rejects non-pending gh checks failures", async () => {
    const provider = createGithubPullRequestReviewProvider();

    await expect(
      Effect.runPromise(
        provider.read({
          dependencies: createDependencies({
            checksResponse: {
              ok: false,
              exitCode: 1,
              stdout: [],
              stderr: "authentication failed",
            },
          }),
          repoPath: "/repo",
          repository: { host: "github.com", owner: "openai", name: "openducktor" },
          pullRequestNumber: 42,
        }),
      ),
    ).rejects.toThrow("authentication failed");
  });
});
