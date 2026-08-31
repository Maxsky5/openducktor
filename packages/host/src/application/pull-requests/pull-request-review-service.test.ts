import { describe, expect, mock, test } from "bun:test";
import {
  type GitProviderId,
  type GitProviderDescriptor,
  type PullRequest,
  type PullRequestReviewContext,
  type RepoConfig,
  repoConfigSchema,
  type TaskCard,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { GitProviderCapabilityError } from "../../ports/git-provider-errors";
import type { GitProviderPort, PullRequestProviderPort } from "../../ports/git-provider-port";
import type { PullRequestReviewProviderPort } from "../../ports/pull-request-review-provider-port";
import type { TaskReader } from "../../ports/task-repository-ports";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-service";
import { createGitProviderResolver } from "../git/git-provider-resolver";
import { createPullRequestReviewService } from "./pull-request-review-service";

const makeRepoConfig = (providerId: GitProviderId): RepoConfig =>
  repoConfigSchema.parse({
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    defaultRuntimeKind: "opencode",
    git: {
      provider: { id: providerId, enabled: true },
    },
  });

const makePullRequest = (providerId: GitProviderId): PullRequest => ({
  providerId,
  number: 42,
  url: `https://example.com/${providerId}/pull/42`,
  state: "open",
  createdAt: "2026-07-10T08:00:00.000Z",
  updatedAt: "2026-07-10T08:00:00.000Z",
});

const makeTask = (pullRequest: PullRequest | undefined): TaskCard => {
  const task: TaskCard = {
    id: "task-1",
    title: "Task",
    description: "",
    status: "in_progress",
    priority: 2,
    issueType: "task",
    aiReviewEnabled: true,
    availableActions: [],
    labels: [],
    subtaskIds: [],
    documentSummary: {
      spec: { has: false },
      plan: { has: false },
      qaReport: { has: false, verdict: "not_reviewed" },
    },
    agentWorkflows: {
      spec: { required: false, canSkip: true, available: true, completed: false },
      planner: { required: false, canSkip: true, available: true, completed: false },
      builder: { required: true, canSkip: false, available: true, completed: false },
      qa: { required: false, canSkip: true, available: false, completed: false },
    },
    createdAt: "2026-07-10T08:00:00.000Z",
    updatedAt: "2026-07-10T08:00:00.000Z",
  };
  if (pullRequest) {
    task.pullRequest = pullRequest;
  }
  return task;
};

const makeLoadedContext = (providerId: GitProviderId): PullRequestReviewContext => ({
  status: "loaded",
  providerId,
  pullRequest: {
    providerId,
    number: 42,
    title: "Task pull request",
    url: `https://example.com/${providerId}/pull/42`,
    state: "open",
  },
  aggregateStatus: "success",
  checks: [],
  comments: [
    {
      id: "review-1",
      author: "reviewer",
      authorAvatarUrl: null,
      body: "",
      patch: null,
      suggestionPatches: [],
      suggestionWarning: null,
      url: null,
      createdAt: "2026-07-10T08:00:00.000Z",
      updatedAt: null,
      path: null,
      line: null,
      threadId: null,
      isResolved: null,
      source: "review",
      reviewOutcome: "approved",
    },
  ],
  reviewThreads: { openCount: 0 },
  refreshedAt: "2026-07-10T08:00:00.000Z",
});

const makeProvider = (
  providerId: GitProviderId,
  readContext: PullRequestReviewProviderPort["readContext"],
  options: {
    supportsReview?: boolean;
    pullRequestReview?: GitProviderPort["pullRequestReview"];
  } = {},
): GitProviderPort => {
  const supportsReview = options.supportsReview ?? true;
  const providerDescriptor: GitProviderDescriptor = {
    id: providerId,
    label: providerId,
    description: `${providerId} provider`,
    capabilities: {
      supportsPullRequests: true,
      supportsPullRequestReview: supportsReview,
    },
  };
  const reviewPort: PullRequestReviewProviderPort = { providerId, readContext };
  const unexpectedProviderOperation = <Success>(): Effect.Effect<Success, never> =>
    Effect.die("Provider operation is not expected in review service tests");
  return {
    getDescriptor: () => providerDescriptor,
    repository: () => ({
      getReadRepository: () => unexpectedProviderOperation(),
      getWriteContext: () => unexpectedProviderOperation(),
    }),
    health: () => ({
      getStatus: () => unexpectedProviderOperation(),
    }),
    pullRequests: () =>
      Effect.succeed<PullRequestProviderPort>({
        findByBranch: () => unexpectedProviderOperation(),
        getByNumber: () => unexpectedProviderOperation(),
        upsert: () => unexpectedProviderOperation(),
      }),
    pullRequestReview:
      options.pullRequestReview ??
      (() =>
        supportsReview
          ? Effect.succeed(reviewPort)
          : Effect.fail(
              new GitProviderCapabilityError({
                providerId,
                capability: "pull_request_review",
                message: `Provider '${providerId}' does not support Pull Request review.`,
              }),
            )),
  };
};

const makeService = ({
  configuredProviderId,
  pullRequest,
  providers,
}: {
  configuredProviderId: GitProviderId;
  pullRequest?: PullRequest;
  providers: GitProviderPort[];
}) => {
  const taskReader: Pick<TaskReader, "getTask"> = {
    getTask: () => Effect.succeed(makeTask(pullRequest)),
  };
  const workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath"> = {
    getRepoConfigByRepoPath: () => Effect.succeed(makeRepoConfig(configuredProviderId)),
  };
  return createPullRequestReviewService({
    resolver: Effect.runSync(createGitProviderResolver(providers)),
    taskReader,
    workspaceSettingsService,
  });
};

describe("createPullRequestReviewService", () => {
  test("selects the provider that owns the linked pull request", async () => {
    const githubReadContext = mock(() => Effect.succeed(makeLoadedContext("github")));
    const gitlabReadContext = mock(() => Effect.succeed(makeLoadedContext("gitlab")));
    const service = makeService({
      configuredProviderId: "gitlab",
      pullRequest: makePullRequest("gitlab"),
      providers: [
        makeProvider("github", githubReadContext),
        makeProvider("gitlab", gitlabReadContext),
      ],
    });

    const context = await Effect.runPromise(
      service.getContext({ repoPath: "/repo", taskId: "task-1" }),
    );

    expect(context).toEqual(makeLoadedContext("gitlab"));
    expect(gitlabReadContext).toHaveBeenCalledTimes(1);
    expect(githubReadContext).not.toHaveBeenCalled();
  });

  test("does not fall back to another provider for an unsupported linked pull request", async () => {
    const githubReadContext = mock(() => Effect.succeed(makeLoadedContext("github")));
    const service = makeService({
      configuredProviderId: "gitlab",
      pullRequest: makePullRequest("gitlab"),
      providers: [makeProvider("github", githubReadContext)],
    });

    const context = await Effect.runPromise(
      service.getContext({ repoPath: "/repo", taskId: "task-1" }),
    );

    expect(context).toEqual({
      status: "unavailable",
      providerId: "gitlab",
      reason: "Git provider 'gitlab' has no registered implementation.",
    });
    expect(githubReadContext).not.toHaveBeenCalled();
  });

  test("reports the configured provider when its implementation is not registered", async () => {
    const githubReadContext = mock(() => Effect.succeed(makeLoadedContext("github")));
    const service = makeService({
      configuredProviderId: "gitlab",
      pullRequest: makePullRequest("github"),
      providers: [makeProvider("github", githubReadContext)],
    });

    const context = await Effect.runPromise(
      service.getContext({ repoPath: "/repo", taskId: "task-1" }),
    );

    expect(context).toEqual({
      status: "unavailable",
      providerId: "github",
      reason: "Git provider 'gitlab' has no registered implementation.",
    });
    expect(githubReadContext).not.toHaveBeenCalled();
  });

  test("does not use a configured provider for another provider's pull request", async () => {
    const githubReadContext = mock(() => Effect.succeed(makeLoadedContext("github")));
    const gitlabReadContext = mock(() => Effect.succeed(makeLoadedContext("gitlab")));
    const service = makeService({
      configuredProviderId: "github",
      pullRequest: makePullRequest("gitlab"),
      providers: [
        makeProvider("github", githubReadContext),
        makeProvider("gitlab", gitlabReadContext),
      ],
    });

    const context = await Effect.runPromise(
      service.getContext({ repoPath: "/repo", taskId: "task-1" }),
    );

    expect(context).toEqual({
      status: "unavailable",
      providerId: "gitlab",
      reason: "Pull request review provider 'gitlab' is not supported.",
    });
    expect(githubReadContext).not.toHaveBeenCalled();
    expect(gitlabReadContext).not.toHaveBeenCalled();
  });

  test("does not invoke any provider for an unlinked task", async () => {
    const githubReadContext = mock(() => Effect.succeed(makeLoadedContext("github")));
    const service = makeService({
      configuredProviderId: "github",
      providers: [makeProvider("github", githubReadContext)],
    });

    const context = await Effect.runPromise(
      service.getContext({ repoPath: "/repo", taskId: "task-1" }),
    );

    expect(context).toEqual({
      status: "no_pull_request",
      providerId: "unknown",
      reason: "Task task-1 has no linked pull request.",
    });
    expect(githubReadContext).not.toHaveBeenCalled();
  });

  test("does not read review context when the provider does not support review", async () => {
    const readContext = mock(() => Effect.succeed(makeLoadedContext("github")));
    const service = makeService({
      configuredProviderId: "github",
      pullRequest: makePullRequest("github"),
      providers: [makeProvider("github", readContext, { supportsReview: false })],
    });

    const context = await Effect.runPromise(
      service.getContext({ repoPath: "/repo", taskId: "task-1" }),
    );

    expect(context).toEqual({
      status: "unavailable",
      providerId: "github",
      reason: "Git provider 'github' does not support Pull Request review.",
    });
    expect(readContext).not.toHaveBeenCalled();
  });

  test("returns a capability access failure without reading review context", async () => {
    const readContext = mock(() => Effect.succeed(makeLoadedContext("github")));
    const capabilityError = new GitProviderCapabilityError({
      providerId: "github",
      capability: "pull_request_review",
      message: "GitHub review access is unavailable.",
    });
    let accessCount = 0;
    const provider = makeProvider("github", readContext, {
      pullRequestReview: () => {
        accessCount += 1;
        return accessCount === 1
          ? Effect.succeed({ providerId: "github", readContext })
          : Effect.fail(capabilityError);
      },
    });
    const service = makeService({
      configuredProviderId: "github",
      pullRequest: makePullRequest("github"),
      providers: [provider],
    });

    const context = await Effect.runPromise(
      service.getContext({ repoPath: "/repo", taskId: "task-1" }),
    );

    expect(context).toEqual({
      status: "unavailable",
      providerId: "github",
      reason: "GitHub review access is unavailable.",
    });
    expect(accessCount).toBe(2);
    expect(readContext).not.toHaveBeenCalled();
  });
});
