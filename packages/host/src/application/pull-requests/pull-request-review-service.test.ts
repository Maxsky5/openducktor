import { describe, expect, mock, test } from "bun:test";
import {
  type GitProviderId,
  type PullRequest,
  type PullRequestReviewContext,
  type RepoConfig,
  repoConfigSchema,
  type TaskCard,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { PullRequestReviewProviderPort } from "../../ports/pull-request-review-provider-port";
import type { TaskReader } from "../../ports/task-repository-ports";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-service";
import { createPullRequestReviewService } from "./pull-request-review-service";

const makeRepoConfig = (): RepoConfig =>
  repoConfigSchema.parse({
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    defaultRuntimeKind: "opencode",
    git: {
      providers: {
        github: { enabled: true },
        gitlab: { enabled: true },
      },
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

const makeTask = (pullRequest: PullRequest | undefined): TaskCard => ({
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
  ...(pullRequest ? { pullRequest } : {}),
  createdAt: "2026-07-10T08:00:00.000Z",
  updatedAt: "2026-07-10T08:00:00.000Z",
});

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

const makeService = ({
  pullRequest,
  providers,
}: {
  pullRequest?: PullRequest;
  providers: PullRequestReviewProviderPort[];
}) => {
  const taskReader: Pick<TaskReader, "getTask"> = {
    getTask: () => Effect.succeed(makeTask(pullRequest)),
  };
  const workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath"> = {
    getRepoConfigByRepoPath: () => Effect.succeed(makeRepoConfig()),
  };
  return createPullRequestReviewService({
    providers,
    taskReader,
    workspaceSettingsService,
  });
};

describe("createPullRequestReviewService", () => {
  test("selects the provider that owns the linked pull request", async () => {
    const githubReadContext = mock(() => Effect.succeed(makeLoadedContext("github")));
    const gitlabReadContext = mock(() => Effect.succeed(makeLoadedContext("gitlab")));
    const service = makeService({
      pullRequest: makePullRequest("gitlab"),
      providers: [
        {
          providerId: "github",
          readContext: githubReadContext,
        },
        {
          providerId: "gitlab",
          readContext: gitlabReadContext,
        },
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
      pullRequest: makePullRequest("gitlab"),
      providers: [
        {
          providerId: "github",
          readContext: githubReadContext,
        },
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
  });

  test("does not invoke any provider for an unlinked task", async () => {
    const githubReadContext = mock(() => Effect.succeed(makeLoadedContext("github")));
    const service = makeService({
      providers: [
        {
          providerId: "github",
          readContext: githubReadContext,
        },
      ],
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
});
