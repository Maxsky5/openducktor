import { describe, expect, mock, test } from "bun:test";
import { type PullRequestReviewContext, repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../../../effect/host-errors";
import { createGithubPullRequestReviewAdapter } from "./adapter";
import type { GithubPullRequestReviewReader } from "./reader";
import { createGithubReviewTestCli } from "./test-support";

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

const createRepoConfig = ({ githubEnabled = true }: { githubEnabled?: boolean } = {}) =>
  repoConfigSchema.parse({
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    defaultRuntimeKind: "opencode",
    git: {
      provider: {
        id: "github",
        enabled: githubEnabled,
        repository: { host: "github.com", owner: "openai", name: "openducktor" },
      },
    },
  });

const linkedPullRequest = (providerId = "github") => ({
  providerId,
  number: 42,
  url: "https://github.com/openai/openducktor/pull/42",
  state: "open" as const,
  createdAt: "2026-07-10T08:00:00.000Z",
  updatedAt: "2026-07-10T08:00:00.000Z",
});

const createGithubCommands = () =>
  createGithubReviewTestCli(() => Effect.dieMessage("unexpected GitHub command"));

const repository = { host: "github.com", owner: "openai", name: "openducktor" };

describe("createGithubPullRequestReviewAdapter", () => {
  test("uses the linked pull request without requiring a local Git remote", async () => {
    const githubCli = createGithubCommands();
    const getRepository = mock(() => Effect.succeed(repository));
    const read = mock(() => Effect.succeed(loadedContext));
    const reviewReader: GithubPullRequestReviewReader = { read };
    const adapter = createGithubPullRequestReviewAdapter({
      githubCli,
      getRepository,
      reviewReader,
    });

    const context = await Effect.runPromise(
      adapter.readContext({
        repoConfig: createRepoConfig(),
        linkedPullRequest: linkedPullRequest(),
      }),
    );

    expect(context).toBe(loadedContext);
    expect(read).toHaveBeenCalledWith({
      githubCli,
      repoPath: "/repo",
      repository,
      pullRequestNumber: 42,
    });
    expect(getRepository).toHaveBeenCalledTimes(1);
  });

  test("rejects a linked pull request from another provider", async () => {
    const githubCli = createGithubCommands();
    const getRepository = mock(() => Effect.succeed(repository));
    const read = mock(() => Effect.succeed(loadedContext));
    const adapter = createGithubPullRequestReviewAdapter({
      githubCli,
      getRepository,
      reviewReader: { read },
    });

    const result = await Effect.runPromise(
      adapter
        .readContext({
          repoConfig: createRepoConfig(),
          linkedPullRequest: linkedPullRequest("gitlab"),
        })
        .pipe(Effect.either),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(HostValidationError);
      expect(result.left.field).toBe("pullRequest.providerId");
    }
    expect(read).not.toHaveBeenCalled();
    expect(getRepository).not.toHaveBeenCalled();
  });

  test("returns unavailable when the configured GitHub repository cannot be read", async () => {
    const githubCli = createGithubCommands();
    const getRepository = mock(() =>
      Effect.fail(
        new HostValidationError({
          field: "git.provider",
          message: "GitHub provider is not enabled.",
        }),
      ),
    );
    const read = mock(() => Effect.succeed(loadedContext));
    const adapter = createGithubPullRequestReviewAdapter({
      githubCli,
      getRepository,
      reviewReader: { read },
    });

    const context = await Effect.runPromise(
      adapter.readContext({
        repoConfig: createRepoConfig({ githubEnabled: false }),
        linkedPullRequest: linkedPullRequest(),
      }),
    );

    expect(context).toMatchObject({
      status: "unavailable",
      providerId: "github",
      reason: expect.stringContaining("not enabled"),
    });
    expect(read).not.toHaveBeenCalled();
    expect(getRepository).toHaveBeenCalledTimes(1);
  });

  test("preserves typed reader failures", async () => {
    const githubCli = createGithubCommands();
    const getRepository = mock(() => Effect.succeed(repository));
    const failure = new HostValidationError({
      field: "github.review",
      message: "GitHub review response is invalid.",
    });
    const read = mock(() => Effect.fail(failure));
    const adapter = createGithubPullRequestReviewAdapter({
      githubCli,
      getRepository,
      reviewReader: { read },
    });

    const result = await Effect.runPromise(
      adapter
        .readContext({
          repoConfig: createRepoConfig(),
          linkedPullRequest: linkedPullRequest(),
        })
        .pipe(Effect.either),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBe(failure);
    }
    expect(getRepository).toHaveBeenCalledTimes(1);
  });
});
