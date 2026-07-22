import { describe, expect, mock, test } from "bun:test";
import { type PullRequestReviewContext, repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GithubCommandDependencies } from "../../../application/tasks/support/github-pull-requests";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import { createGithubPullRequestReviewAdapter } from "./github-pull-request-review-adapter";
import type { GithubPullRequestReviewReader } from "./github-pull-request-review-reader";

const loadedContext: PullRequestReviewContext = {
  status: "loaded",
  providerId: "github",
  pullRequest: {
    providerId: "github",
    number: 42,
    title: "Task pull request",
    url: "https://github.com/openai/openducktor/pull/42",
    state: "open",
  },
  aggregateStatus: "success",
  checks: [],
  comments: [],
  reviewThreads: { openCount: 0 },
  refreshedAt: "2026-07-10T08:00:00.000Z",
};

describe("createGithubPullRequestReviewAdapter", () => {
  test("uses the linked pull request without requiring a local Git remote", async () => {
    const systemCommands: Pick<SystemCommandPort, "runCommandAllowFailure"> = {
      runCommandAllowFailure: () =>
        Effect.succeed({
          ok: true,
          stdout: "",
          stderr: "",
        }),
    };
    const githubDependencies: GithubCommandDependencies = {
      resolveGithubCommand: () =>
        Effect.succeed({
          ghCommand: "gh",
          systemCommands: systemCommands as SystemCommandPort,
        }),
      systemCommands: systemCommands as SystemCommandPort,
      toolDiscovery: {} as GithubCommandDependencies["toolDiscovery"],
    };
    const read = mock(() => Effect.succeed(loadedContext));
    const reviewReader: GithubPullRequestReviewReader = { read };
    const adapter = createGithubPullRequestReviewAdapter({
      githubDependencies,
      reviewReader,
    });
    const repoConfig = repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultRuntimeKind: "opencode",
      git: {
        providers: {
          github: {
            enabled: true,
            repository: { host: "github.com", owner: "openai", name: "openducktor" },
          },
        },
      },
    });

    const context = await Effect.runPromise(
      adapter.readContext({
        repoConfig,
        linkedPullRequest: {
          providerId: "github",
          number: 42,
          url: "https://github.com/openai/openducktor/pull/42",
          state: "open",
          createdAt: "2026-07-10T08:00:00.000Z",
          updatedAt: "2026-07-10T08:00:00.000Z",
        },
      }),
    );

    expect(context).toBe(loadedContext);
    expect(read).toHaveBeenCalledWith({
      dependencies: githubDependencies,
      repoPath: "/repo",
      repository: { host: "github.com", owner: "openai", name: "openducktor" },
      pullRequestNumber: 42,
    });
  });
});
