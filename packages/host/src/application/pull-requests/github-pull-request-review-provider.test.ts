import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { GithubCommandDependencies } from "../tasks/support/github-pull-requests";
import { createGithubPullRequestReviewProvider } from "./github-pull-request-review-provider";

const createDependencies = ({
  commands = [],
  includeReviewId = true,
}: {
  commands?: string[][];
  includeReviewId?: boolean;
} = {}): GithubCommandDependencies => {
  const systemCommands: Pick<SystemCommandPort, "runCommandAllowFailure"> = {
    runCommandAllowFailure: (_command, args) => {
      commands.push(args);
      const command = args.join(" ");
      if (command.includes("pr view")) {
        return Effect.succeed({
          ok: true,
          stdout: JSON.stringify({
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
          }),
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
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [
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
                        ],
                      },
                    },
                  ],
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
    ]);
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
});
