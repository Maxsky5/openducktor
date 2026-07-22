import { describe, expect, mock, test } from "bun:test";
import { type PullRequestReviewContext, repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GithubCommandDependencies } from "../../../application/tasks/support/github-pull-requests";
import { HostValidationError } from "../../../effect/host-errors";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../../ports/tool-discovery-port";
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

const createRepoConfig = ({ githubEnabled = true }: { githubEnabled?: boolean } = {}) =>
  repoConfigSchema.parse({
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    defaultRuntimeKind: "opencode",
    git: {
      providers: {
        github: {
          enabled: githubEnabled,
          repository: { host: "github.com", owner: "openai", name: "openducktor" },
        },
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

const createGithubDependencies = () => {
  const runCommandAllowFailure = mock((_command: string, args: string[]) => {
    expect(args).toEqual(["auth", "status", "--hostname", "github.com"]);
    return Effect.succeed({ ok: true, stdout: "", stderr: "" });
  });
  const systemCommands: Pick<SystemCommandPort, "runCommandAllowFailure"> = {
    runCommandAllowFailure,
  };
  const toolDiscovery: ToolDiscoveryPort = {
    resolveTool: () =>
      Effect.succeed({
        displayLabel: "GitHub CLI",
        path: "gh",
        sourceCategory: "system_path",
      }),
    resolveToolPath: () => Effect.succeed("gh"),
  };
  const dependencies: GithubCommandDependencies = {
    resolveGithubCommand: () =>
      Effect.succeed({
        ghCommand: "gh",
        systemCommands: systemCommands as SystemCommandPort,
      }),
    systemCommands: systemCommands as SystemCommandPort,
    toolDiscovery,
  };
  return { dependencies, runCommandAllowFailure };
};

describe("createGithubPullRequestReviewAdapter", () => {
  test("uses the linked pull request without requiring a local Git remote", async () => {
    const { dependencies: githubDependencies, runCommandAllowFailure } = createGithubDependencies();
    const read = mock(() => Effect.succeed(loadedContext));
    const reviewReader: GithubPullRequestReviewReader = { read };
    const adapter = createGithubPullRequestReviewAdapter({
      githubDependencies,
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
      dependencies: githubDependencies,
      repoPath: "/repo",
      repository: { host: "github.com", owner: "openai", name: "openducktor" },
      pullRequestNumber: 42,
    });
    expect(runCommandAllowFailure).toHaveBeenCalledTimes(1);
  });

  test("rejects a linked pull request from another provider", async () => {
    const { dependencies: githubDependencies, runCommandAllowFailure } = createGithubDependencies();
    const read = mock(() => Effect.succeed(loadedContext));
    const adapter = createGithubPullRequestReviewAdapter({
      githubDependencies,
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
    expect(runCommandAllowFailure).not.toHaveBeenCalled();
  });

  test("returns unavailable when the configured GitHub repository cannot be read", async () => {
    const { dependencies: githubDependencies, runCommandAllowFailure } = createGithubDependencies();
    const read = mock(() => Effect.succeed(loadedContext));
    const adapter = createGithubPullRequestReviewAdapter({
      githubDependencies,
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
    expect(runCommandAllowFailure).not.toHaveBeenCalled();
  });

  test("preserves typed reader failures", async () => {
    const { dependencies: githubDependencies, runCommandAllowFailure } = createGithubDependencies();
    const failure = new HostValidationError({
      field: "github.review",
      message: "GitHub review response is invalid.",
    });
    const read = mock(() => Effect.fail(failure));
    const adapter = createGithubPullRequestReviewAdapter({
      githubDependencies,
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
    expect(runCommandAllowFailure).toHaveBeenCalledTimes(1);
  });
});
