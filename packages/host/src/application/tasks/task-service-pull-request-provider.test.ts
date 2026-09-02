import { describe, expect, mock, test } from "bun:test";
import type { GitProviderDescriptor, PullRequest } from "@openducktor/contracts";
import { Effect } from "effect";
import { GitProviderCapabilityError } from "../../ports/git-provider-errors";
import type {
  GitProviderPort,
  PullRequestProviderPort,
  ProviderPullRequest,
} from "../../ports/git-provider-port";
import type { PullRequestReviewProviderPort } from "../../ports/pull-request-review-provider-port";
import { createGitProviderResolver } from "../git/git-provider-resolver";
import {
  createBuildSettingsConfig,
  createBuildWorkspaceSettingsService,
  createDirectMergeDevServerService,
  createDirectMergeGitPort,
  createDirectMergeTaskWorktreeService,
  createTaskService,
  extendGitPort,
  type TaskStorePort,
  task,
} from "./test-support/task-workflow-harness";

const linkedPullRequest = (providerId: string): PullRequest => ({
  providerId,
  number: 42,
  url: `https://example.com/${providerId}/pull/42`,
  state: "open",
  createdAt: "2026-05-01T10:00:00Z",
  updatedAt: "2026-05-02T10:00:00Z",
});

const resolvedPullRequest = (providerId: string): ProviderPullRequest => ({
  record: linkedPullRequest(providerId),
  sourceBranch: "odt/task-42",
  targetBranch: "main",
});

const mergedPullRequest = (providerId: string): PullRequest => ({
  ...linkedPullRequest(providerId),
  state: "merged",
  mergedAt: "2026-05-02T10:00:00Z",
});

const unexpected = <Success>(): Effect.Effect<Success, never> =>
  Effect.dieMessage("unexpected provider operation");

const createPullRequestPort = (
  providerId: string,
  overrides: Partial<PullRequestProviderPort> = {},
): PullRequestProviderPort => ({
  providerId,
  findOpenForSourceBranch: () => unexpected(),
  findLatestMergedForSourceBranch: () => unexpected(),
  getByNumber: () => unexpected(),
  refresh: () => unexpected(),
  resolvePublishRemote: () => unexpected(),
  upsert: () => unexpected(),
  ...overrides,
});

const createProvider = (
  providerDescriptor: GitProviderDescriptor,
  pullRequests: PullRequestProviderPort,
): GitProviderPort => {
  const reviewPort: PullRequestReviewProviderPort = {
    providerId: providerDescriptor.id,
    readContext: () => unexpected(),
  };
  return {
    getDescriptor: () => providerDescriptor,
    repository: () => ({
      detectRepository: () => unexpected(),
      getRepository: () => unexpected(),
      getMapping: () => unexpected(),
    }),
    health: () => ({ getStatus: () => unexpected() }),
    pullRequests: () => Effect.succeed(pullRequests),
    pullRequestReview: () =>
      providerDescriptor.capabilities.supportsPullRequestReview
        ? Effect.succeed(reviewPort)
        : Effect.fail(
            new GitProviderCapabilityError({
              providerId: providerDescriptor.id,
              capability: "pull_request_review",
              message: "Pull Request review is not supported.",
            }),
          ),
  };
};

const gitlabDescriptor: GitProviderDescriptor = {
  id: "gitlab",
  label: "GitLab",
  description: "Test Git provider",
  capabilities: {
    supportsPullRequests: true,
    supportsPullRequestReview: false,
  },
};

const workspaceSettingsService = createBuildWorkspaceSettingsService({
  workspaceId: "repo",
  repoPath: "/repo",
  hooks: { preStart: [], postComplete: [] },
  git: {
    provider: {
      id: "gitlab",
      enabled: true,
      repository: { host: "gitlab.example.com", owner: "openai", name: "openducktor" },
      autoDetected: false,
    },
  },
});

describe("createTaskService Pull Request provider ports", () => {
  test("detects an open Pull Request through the configured provider port", async () => {
    const findOpenForSourceBranch = mock(() => Effect.succeed(resolvedPullRequest("gitlab")));
    const pullRequests = createPullRequestPort("gitlab", { findOpenForSourceBranch });
    const provider = createProvider(gitlabDescriptor, pullRequests);
    const gitProviderResolver = Effect.runSync(createGitProviderResolver([provider]));
    const setPullRequest = mock(() => Effect.succeed(true));
    const taskStore: TaskStorePort = {
      getTask: () => Effect.succeed(task({ status: "human_review" })),
      getTaskMetadata: () =>
        Effect.succeed({
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        }),
      setPullRequest,
    };
    const service = createTaskService({
      gitPort: createDirectMergeGitPort({
        calls: [],
        currentBranches: {
          "/worktrees/repo/task-1": { name: "odt/task-42", detached: false },
        },
      }),
      gitProviderResolver,
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService,
    });

    const result = await Effect.runPromise(
      service.detectPullRequest({ repoPath: "/repo", taskId: "task-1" }),
    );

    expect(result).toEqual({
      outcome: "linked",
      pullRequest: linkedPullRequest("gitlab"),
    });
    expect(findOpenForSourceBranch).toHaveBeenCalledWith({
      repoConfig: expect.objectContaining({ repoPath: "/repo" }),
      sourceBranch: "odt/task-42",
    });
  });

  test("links a Pull Request through the configured provider port", async () => {
    const getByNumber = mock(() => Effect.succeed(resolvedPullRequest("gitlab")));
    const pullRequests = createPullRequestPort("gitlab", { getByNumber });
    const provider = createProvider(gitlabDescriptor, pullRequests);
    const gitProviderResolver = Effect.runSync(createGitProviderResolver([provider]));
    const setPullRequest = mock(() => Effect.succeed(true));
    const taskStore: TaskStorePort = {
      getTask: () => Effect.succeed(task({ status: "human_review" })),
      getTaskMetadata: () =>
        Effect.succeed({
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        }),
      setPullRequest,
    };
    const service = createTaskService({
      gitProviderResolver,
      taskStore,
      workspaceSettingsService,
    });

    const result = await Effect.runPromise(
      service.linkPullRequest({
        repoPath: "/repo",
        taskId: "task-1",
        providerId: "gitlab",
        number: 42,
      }),
    );

    expect(result).toEqual(linkedPullRequest("gitlab"));
    expect(getByNumber).toHaveBeenCalledWith({
      repoConfig: expect.objectContaining({ repoPath: "/repo" }),
      number: 42,
    });
    expect(setPullRequest).toHaveBeenCalledWith({
      repoPath: "/repo",
      taskId: "task-1",
      pullRequest: linkedPullRequest("gitlab"),
    });
  });

  test("rejects a Pull Request returned with a foreign provider identity", async () => {
    const getByNumber = mock(() => Effect.succeed(resolvedPullRequest("github")));
    const pullRequests = createPullRequestPort("gitlab", { getByNumber });
    const provider = createProvider(gitlabDescriptor, pullRequests);
    const gitProviderResolver = Effect.runSync(createGitProviderResolver([provider]));
    const setPullRequest = mock(() => Effect.succeed(true));
    const service = createTaskService({
      gitProviderResolver,
      taskStore: {
        getTask: () => Effect.succeed(task({ status: "human_review" })),
        getTaskMetadata: () =>
          Effect.succeed({
            spec: { markdown: "# Spec" },
            plan: { markdown: "# Plan" },
            agentSessions: [],
          }),
        setPullRequest,
      },
      workspaceSettingsService,
    });

    const failure = await Effect.runPromise(
      service
        .linkPullRequest({
          repoPath: "/repo",
          taskId: "task-1",
          providerId: "gitlab",
          number: 42,
        })
        .pipe(Effect.flip),
    );

    expect(failure).toMatchObject({
      _tag: "HostValidationError",
      field: "pullRequest.providerId",
    });
    expect(setPullRequest).not.toHaveBeenCalled();
  });

  test("rejects a linked Pull Request from a provider other than the configured provider", async () => {
    const refresh = mock(() => Effect.succeed(resolvedPullRequest("github")));
    const pullRequests = createPullRequestPort("gitlab", { refresh });
    const provider = createProvider(gitlabDescriptor, pullRequests);
    const gitProviderResolver = Effect.runSync(createGitProviderResolver([provider]));
    const taskStore: TaskStorePort = {
      listPullRequestSyncCandidates: () =>
        Effect.succeed([
          {
            ...task({ status: "human_review" }),
            pullRequest: linkedPullRequest("github"),
          },
        ]),
    };
    const service = createTaskService({
      gitProviderResolver,
      taskStore,
      workspaceSettingsService,
    });

    const failure = await Effect.runPromise(
      service.repoPullRequestSyncDetailed({ repoPath: "/repo" }).pipe(Effect.flip),
    );

    expect(failure).toMatchObject({
      _tag: "HostValidationError",
      field: "pullRequest.providerId",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("uses the provider port to resolve the publish remote and upsert", async () => {
    const calls: unknown[] = [];
    const resolvePublishRemote = mock(() => Effect.succeed("publish"));
    const upsert = mock(() => Effect.succeed(linkedPullRequest("gitlab")));
    const pullRequests = createPullRequestPort("gitlab", {
      resolvePublishRemote,
      upsert,
    });
    const provider = createProvider(gitlabDescriptor, pullRequests);
    const gitProviderResolver = Effect.runSync(createGitProviderResolver([provider]));
    const taskStore: TaskStorePort = {
      getTask: () => Effect.succeed(task({ status: "human_review" })),
      getTaskMetadata: () =>
        Effect.succeed({
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        }),
      setPullRequest: () => Effect.succeed(true),
    };
    const gitPort = extendGitPort(
      createDirectMergeGitPort({
        calls,
        currentBranches: {
          "/worktrees/repo/task-1": { name: "odt/task-42", detached: false },
        },
      }),
      {
        getWorktreeStatusSummaryData: () =>
          Effect.succeed({
            currentBranch: { name: "odt/task-42", detached: false },
            fileStatuses: [],
            fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
          }),
        suggestedSquashCommitMessage: () => Effect.succeed("Task 42"),
        pushBranch: (workingDirectory, branch, options) =>
          Effect.sync(() => {
            calls.push({ type: "pushBranch", workingDirectory, branch, options });
            return { outcome: "pushed", remote: "publish", branch, output: "pushed" };
          }),
      },
    );
    const service = createTaskService({
      gitPort,
      gitProviderResolver,
      settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService,
    });

    await Effect.runPromise(
      service.upsertPullRequest({
        repoPath: "/repo",
        taskId: "task-1",
        content: { title: "Task 42", body: "Task body" },
      }),
    );

    expect(resolvePublishRemote).toHaveBeenCalledWith({
      repoConfig: expect.objectContaining({ repoPath: "/repo" }),
    });
    expect(calls).toContainEqual({
      type: "pushBranch",
      workingDirectory: "/worktrees/repo/task-1",
      branch: "odt/task-42",
      options: { remote: "publish", setUpstream: true, forceWithLease: false },
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        repoConfig: expect.objectContaining({ repoPath: "/repo" }),
        title: "Task 42",
        body: "Task body",
      }),
    );
  });

  test("rejects a detected merged Pull Request from another provider", async () => {
    const pullRequests = createPullRequestPort("gitlab");
    const provider = createProvider(gitlabDescriptor, pullRequests);
    const gitProviderResolver = Effect.runSync(createGitProviderResolver([provider]));
    const taskStore: TaskStorePort = {
      listTasks: () => Effect.succeed([task({ status: "human_review" })]),
      getTaskMetadata: () =>
        Effect.succeed({
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        }),
    };
    const service = createTaskService({
      devServerService: createDirectMergeDevServerService([]),
      gitPort: createDirectMergeGitPort({ calls: [] }),
      gitProviderResolver,
      settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService,
    });

    const failure = await Effect.runPromise(
      service
        .linkMergedPullRequest({
          repoPath: "/repo",
          taskId: "task-1",
          pullRequest: mergedPullRequest("github"),
        })
        .pipe(Effect.flip),
    );

    expect(failure).toMatchObject({
      _tag: "HostValidationError",
      field: "pullRequest.providerId",
    });
  });
});
