import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { describe, expect, mock, test } from "bun:test";
import type { GitProviderDescriptor, PullRequest } from "@openducktor/contracts";
import { Effect } from "effect";
import { and, eq } from "drizzle-orm";
import {
  applyHostSharedConfigEdits,
  readHostSharedConfig,
} from "../../adapters/sqlite/sqlite-host-settings-store";
import { tasks } from "../../adapters/sqlite/sqlite-host-database-schema";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createWorkspaceSettingsServiceTestDouble } from "../../test-support/service-test-doubles";
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
  createDirectMergeGitPort,
  createDirectMergeTaskWorktreeService,
  createTaskService,
  extendGitPort,
  type TaskStorePort,
  task,
} from "./test-support/task-workflow-harness";

test.each(["not_configured", "disabled"] as const)(
  "reports a provider skip when it is %s",
  async (reason) => {
    const gitProviderResolver = Effect.runSync(createGitProviderResolver([]));
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      gitProviderResolver,
      taskStore: {},
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { postComplete: [] },
        git:
          reason === "disabled"
            ? {
                provider: {
                  id: "github",
                  enabled: false,
                  repository: { host: "github.com", owner: "openai", name: "openducktor" },
                  autoDetected: false,
                },
              }
            : {},
      }),
    });
    expect(
      await Effect.runPromise(
        service.repoPullRequestSync({ workspaceId: "repo", repoPath: "/repo" }),
      ),
    ).toMatchObject({
      ok: false,
      reason,
      message: expect.stringContaining("Git provider settings"),
    });
  },
);

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

const resolvedMergedPullRequest = (providerId: string): ProviderPullRequest => ({
  record: mergedPullRequest(providerId),
  sourceBranch: "odt/task-42",
  targetBranch: "main",
});

const unexpected = <Success>(): Effect.Effect<Success, never> =>
  Effect.die(new Error("unexpected provider operation"));

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
    issues: () =>
      Effect.fail(
        new GitProviderCapabilityError({
          providerId: providerDescriptor.id,
          capability: "issues",
          message: "Issue import is not supported.",
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
  hooks: { postComplete: [] },
  git: {
    provider: {
      id: "gitlab",
      enabled: true,
      repository: { host: "gitlab.example.com", owner: "openai", name: "openducktor" },
      autoDetected: false,
    },
  },
});

const createClosedLinkService = (persistedProviderId: string) => {
  const provider = createProvider(gitlabDescriptor, createPullRequestPort("gitlab"));
  const gitProviderResolver = Effect.runSync(createGitProviderResolver([provider]));
  const setPullRequest = mock(() => Effect.succeed(true));
  const transitionTask = mock(() => Effect.succeed(task({ status: "closed" })));
  const service = createTaskService({
    taskWorkflows: builtinTaskWorkflows,
    gitProviderResolver,
    taskStore: {
      listTasks: () => Effect.succeed([task({ status: "closed" })]),
      getTaskMetadata: () =>
        Effect.succeed({
          artifacts: { spec: { markdown: "# Spec" }, plan: { markdown: "# Plan" } },
          pullRequest: mergedPullRequest(persistedProviderId),
          agentSessions: [],
        }),
      setPullRequest,
      transitionTask,
    },
    workspaceSettingsService,
  });
  return { service, setPullRequest, transitionTask };
};

describe("createTaskService Pull Request provider ports", () => {
  test("syncs the selected workspace when repository paths and task IDs are identical", async () => {
    const harness = await createSqliteTaskStoreHarness({
      workspaceId: "abcdefghij-one",
      repoPath: "/repo",
    });
    try {
      const template = await Effect.runPromise(workspaceSettingsService.getRepoConfig("repo"));
      const first = { ...template, workspaceId: harness.workspaceId };
      const second = { ...template, workspaceId: "abcdefghij-two" };
      await Effect.runPromise(
        harness.withHostDatabase("test.workspaces", (session) =>
          session.transaction("test.workspaces", (transaction) =>
            Effect.gen(function* () {
              const current = yield* readHostSharedConfig(transaction);
              yield* applyHostSharedConfigEdits(transaction, current, {
                ...current,
                workspaces: { [first.workspaceId]: first, [second.workspaceId]: second },
              });
            }),
          ),
        ),
      );
      const created = await Effect.runPromise(
        harness.store.createTask({
          workspaceId: first.workspaceId,
          repoPath: "/repo",
          status: "human_review",
          task: { title: "First", issueType: "task", priority: 2 },
        }),
      );
      await Effect.runPromise(
        harness.withHostDatabase("test.sameTaskId", (session) =>
          session.transaction("test.sameTaskId", (transaction) =>
            Effect.gen(function* () {
              const [row] = yield* transaction.execute(
                (db) =>
                  db
                    .select()
                    .from(tasks)
                    .where(and(eq(tasks.workspaceId, first.workspaceId), eq(tasks.id, created.id))),
                "test.firstTask",
              );
              if (!row) return yield* Effect.die(new Error("Missing fixture task."));
              yield* transaction.execute(
                (db) =>
                  db.insert(tasks).values({
                    ...row,
                    workspaceId: second.workspaceId,
                    title: "Second",
                  }),
                "test.secondTask",
              );
            }),
          ),
        ),
      );
      for (const workspace of [first, second])
        await Effect.runPromise(
          harness.store.setPullRequest({
            workspaceId: workspace.workspaceId,
            repoPath: "/repo",
            taskId: created.id,
            pullRequest: linkedPullRequest("gitlab"),
          }),
        );
      const refreshedWorkspaces: string[] = [];
      const provider = createProvider(
        gitlabDescriptor,
        createPullRequestPort("gitlab", {
          refresh: ({ repoConfig, linkedPullRequest: linked }) =>
            Effect.sync(() => {
              refreshedWorkspaces.push(repoConfig.workspaceId);
              return {
                record: { ...linked, state: "closed_unmerged", updatedAt: "2026-05-03T10:00:00Z" },
                sourceBranch: "odt/task",
                targetBranch: "main",
              };
            }),
        }),
      );
      const service = createTaskService({
        atomicTaskStore: harness.store,
        gitProviderResolver: Effect.runSync(createGitProviderResolver([provider])),
        workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
          getRepoConfig: (workspaceId) =>
            Effect.succeed(workspaceId === first.workspaceId ? first : second),
        }),
      });
      await expect(
        Effect.runPromise(
          service.repoPullRequestSyncDetailed({
            workspaceId: first.workspaceId,
            repoPath: "/moved/repo",
          }),
        ),
      ).rejects.toThrow("no longer matches");
      expect(refreshedWorkspaces).toEqual([]);
      await Effect.runPromise(service.repoPullRequestSyncDetailed(first));
      expect(
        (await Effect.runPromise(harness.store.getTaskMetadata({ ...second, taskId: created.id })))
          .pullRequest?.state,
      ).toBe("open");
      await Effect.runPromise(service.repoPullRequestSyncDetailed(second));
      expect(
        (await Effect.runPromise(harness.store.getTaskMetadata({ ...first, taskId: created.id })))
          .pullRequest?.state,
      ).toBe("closed_unmerged");
      expect(refreshedWorkspaces).toEqual([first.workspaceId, second.workspaceId]);
    } finally {
      await harness.cleanup();
    }
  });

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
          artifacts: { spec: { markdown: "# Spec" }, plan: { markdown: "# Plan" } },
          agentSessions: [],
        }),
      setPullRequest,
    };
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
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
      service.detectPullRequest({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1" }),
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

  test("rejects a detected merged Pull Request from another provider", async () => {
    const findLatestMergedForSourceBranch = mock(() =>
      Effect.succeed(resolvedMergedPullRequest("github")),
    );
    const pullRequests = createPullRequestPort("gitlab", {
      findOpenForSourceBranch: () => Effect.succeed(undefined),
      findLatestMergedForSourceBranch,
    });
    const provider = createProvider(gitlabDescriptor, pullRequests);
    const gitProviderResolver = Effect.runSync(createGitProviderResolver([provider]));
    const setPullRequest = mock(() => Effect.succeed(true));
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      gitPort: createDirectMergeGitPort({
        calls: [],
        currentBranches: {
          "/worktrees/repo/task-1": { name: "odt/task-42", detached: false },
        },
      }),
      gitProviderResolver,
      taskStore: {
        getTask: () => Effect.succeed(task({ status: "human_review" })),
        getTaskMetadata: () =>
          Effect.succeed({
            artifacts: { spec: { markdown: "# Spec" }, plan: { markdown: "# Plan" } },
            agentSessions: [],
          }),
        setPullRequest,
      },
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService,
    });

    const failure = await Effect.runPromise(
      service
        .detectPullRequest({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1" })
        .pipe(Effect.flip),
    );

    expect(failure).toMatchObject({
      _tag: "HostValidationError",
      field: "pullRequest.providerId",
    });
    expect(findLatestMergedForSourceBranch).toHaveBeenCalledTimes(1);
    expect(setPullRequest).not.toHaveBeenCalled();
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
          artifacts: { spec: { markdown: "# Spec" }, plan: { markdown: "# Plan" } },
          agentSessions: [],
        }),
      setPullRequest,
    };
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      gitProviderResolver,
      taskStore,
      workspaceSettingsService,
    });

    const result = await Effect.runPromise(
      service.linkPullRequest({
        workspaceId: "repo",
        repoPath: "/repo",
        taskId: "task-1",
        number: 42,
      }),
    );

    expect(result).toEqual(linkedPullRequest("gitlab"));
    expect(getByNumber).toHaveBeenCalledWith({
      repoConfig: expect.objectContaining({ repoPath: "/repo" }),
      number: 42,
    });
    expect(setPullRequest).toHaveBeenCalledWith({
      workspaceId: "repo",
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
      taskWorkflows: builtinTaskWorkflows,
      gitProviderResolver,
      taskStore: {
        getTask: () => Effect.succeed(task({ status: "human_review" })),
        getTaskMetadata: () =>
          Effect.succeed({
            artifacts: { spec: { markdown: "# Spec" }, plan: { markdown: "# Plan" } },
            agentSessions: [],
          }),
        setPullRequest,
      },
      workspaceSettingsService,
    });

    const failure = await Effect.runPromise(
      service
        .linkPullRequest({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1", number: 42 })
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
      taskWorkflows: builtinTaskWorkflows,
      gitProviderResolver,
      taskStore,
      workspaceSettingsService,
    });

    const failure = await Effect.runPromise(
      service
        .repoPullRequestSyncDetailed({ workspaceId: "repo", repoPath: "/repo" })
        .pipe(Effect.flip),
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
          artifacts: { spec: { markdown: "# Spec" }, plan: { markdown: "# Plan" } },
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
      taskWorkflows: builtinTaskWorkflows,
      gitPort,
      gitProviderResolver,
      settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService,
    });

    await Effect.runPromise(
      service.upsertPullRequest({
        workspaceId: "repo",
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

  test("rejects linking a merged Pull Request from another provider", async () => {
    const pullRequests = createPullRequestPort("gitlab");
    const provider = createProvider(gitlabDescriptor, pullRequests);
    const gitProviderResolver = Effect.runSync(createGitProviderResolver([provider]));
    const taskStore: TaskStorePort = {
      listTasks: () => Effect.succeed([task({ status: "human_review" })]),
      getTaskMetadata: () =>
        Effect.succeed({
          artifacts: { spec: { markdown: "# Spec" }, plan: { markdown: "# Plan" } },
          agentSessions: [],
        }),
    };
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
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
          workspaceId: "repo",
          repoPath: "/repo",
          taskId: "task-1",
          removeWorktree: true,
          pullRequest: mergedPullRequest("github"),
        })
        .pipe(Effect.flip),
    );

    expect(failure).toMatchObject({
      _tag: "HostValidationError",
      field: "pullRequest.providerId",
    });
  });

  test("returns a closed task unchanged when the persisted Pull Request matches the provider", async () => {
    const { service, setPullRequest, transitionTask } = createClosedLinkService("gitlab");

    const result = await Effect.runPromise(
      service.linkMergedPullRequest({
        workspaceId: "repo",
        repoPath: "/repo",
        taskId: "task-1",
        removeWorktree: true,
        pullRequest: mergedPullRequest("gitlab"),
      }),
    );

    expect(result).toMatchObject({ id: "task-1", status: "closed" });
    expect(setPullRequest).not.toHaveBeenCalled();
    expect(transitionTask).not.toHaveBeenCalled();
  });

  test("rejects a closed idempotent link when the persisted Pull Request has provider drift", async () => {
    const { service, setPullRequest, transitionTask } = createClosedLinkService("github");

    const failure = await Effect.runPromise(
      service
        .linkMergedPullRequest({
          workspaceId: "repo",
          repoPath: "/repo",
          taskId: "task-1",
          removeWorktree: true,
          pullRequest: mergedPullRequest("github"),
        })
        .pipe(Effect.flip),
    );

    expect(failure).toMatchObject({
      _tag: "HostValidationError",
      field: "pullRequest.providerId",
    });
    expect(setPullRequest).not.toHaveBeenCalled();
    expect(transitionTask).not.toHaveBeenCalled();
  });
});
