import { Effect } from "effect";
import { TaskPolicyError } from "../../domain/task";
import { HostOperationError } from "../../effect/host-errors";
import { TaskMutationProgressFailure } from "./task-mutation-progress-failure";
import {
  createAgentSessionRecord,
  createBuildSettingsConfig,
  createBuildWorkspaceSettingsService,
  createDirectMergeDevServerService,
  createDirectMergeGitPort,
  createDirectMergeTaskWorktreeService,
  createPullRequestDetectSystemCommands,
  createPullRequestSyncSystemCommands,
  createPullRequestUpsertSystemCommands,
  createSystemCommandPort,
  createTaskService,
  createTaskServiceWithMutationProgress,
  extendGitPort,
  extendSettingsConfigPort,
  githubPullListPayload,
  githubPullResponsePayload,
  pullRequest,
  type TaskStorePort,
  task,
} from "./test-support/task-workflow-harness";

describe("createTaskService pull requests", () => {
  test("detects and links an existing open pull request for the builder branch", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "get", input });
            return task({ status: "human_review" });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "metadata", input });
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
              agentSessions: [],
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "setPullRequest", input });
            return true;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setSpecDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set spec");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPlanDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set plan");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      recordQaOutcome() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected QA");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    const service = createTaskService({
      gitPort: extendGitPort(
        createDirectMergeGitPort({
          calls,
          currentBranches: {
            "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
          },
        }),
        {
          listRemotes(workingDir) {
            return Effect.tryPromise({
              try: async () => {
                calls.push({ type: "listRemotes", workingDir });
                return [{ name: "origin", url: "git@github.com:openai/openducktor.git" }];
              },
              catch: (cause) =>
                new HostOperationError({
                  operation: "test.effect",
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause: cause,
                }),
            });
          },
        },
      ),
      systemCommands: createPullRequestDetectSystemCommands({
        calls,
        openPayload: githubPullListPayload([{ number: 42 }]),
      }),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: [] },
        git: {
          providers: {
            github: {
              enabled: true,
              repository: { host: "github.com", owner: "openai", name: "openducktor" },
              autoDetected: false,
            },
          },
        },
      }),
    });
    await expect(
      Effect.runPromise(service.detectPullRequest({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toMatchObject({
      outcome: "linked",
      pullRequest: {
        providerId: "github",
        number: 42,
        state: "open",
        url: "https://github.com/openai/openducktor/pull/42",
      },
    });
    expect(calls).toContainEqual({
      type: "setPullRequest",
      input: {
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest: expect.objectContaining({ number: 42, state: "open" }),
      },
    });
    expect(calls).toContainEqual(
      expect.objectContaining({
        type: "command",
        command: "gh",
        args: expect.arrayContaining(["api", "state=open"]),
        options: expect.objectContaining({
          env: expect.objectContaining({
            GH_PROMPT_DISABLED: "1",
            NO_COLOR: "1",
            CLICOLOR: "0",
            CLICOLOR_FORCE: "0",
            FORCE_COLOR: "0",
          }),
        }),
      }),
    );
  });
  test("detectPullRequest preserves task policy errors for invalid workflow statuses", async () => {
    const calls: unknown[] = [];
    const taskStore = {
      getTask() {
        return Effect.succeed(task({ status: "open" }));
      },
    } as unknown as TaskStorePort;
    const service = createTaskService({
      gitPort: createDirectMergeGitPort({ calls }),
      systemCommands: createPullRequestDetectSystemCommands({
        calls,
        openPayload: githubPullListPayload([]),
      }),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService(null),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: [] },
      }),
    });

    const error = await Effect.runPromise(
      Effect.flip(service.detectPullRequest({ repoPath: "/repo", taskId: "task-1" })),
    );

    expect(error).toBeInstanceOf(TaskPolicyError);
    expect((error as TaskPolicyError).code).toBe("TASK_POLICY_ERROR");
  });
  test("links a pull request by number after fetching provider metadata", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "get", input });
            return task({ status: "human_review" });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "metadata", input });
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
              agentSessions: [],
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "setPullRequest", input });
            return true;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setSpecDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set spec");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPlanDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set plan");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      recordQaOutcome() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected QA");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    const service = createTaskService({
      gitPort: extendGitPort(createDirectMergeGitPort({ calls }), {
        listRemotes(workingDir) {
          return Effect.tryPromise({
            try: async () => {
              calls.push({ type: "listRemotes", workingDir });
              return [{ name: "origin", url: "git@github.com:openai/openducktor.git" }];
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
      systemCommands: createSystemCommandPort({
        resolveCommandPath(command) {
          calls.push({ type: "resolveCommand", command });
          return Effect.succeed(command);
        },
        versionCommand() {
          return Effect.dieMessage("unexpected version command");
        },
        runCommandAllowFailure(command, args, options) {
          return Effect.tryPromise({
            try: async () => {
              calls.push({ type: "command", command, args, options });
              if (args.includes("auth")) {
                return {
                  ok: true,
                  stdout: "Logged in to github.com account octocat\n",
                  stderr: "",
                };
              }
              if (args.some((arg) => arg.includes("pulls/77"))) {
                return { ok: true, stdout: githubPullResponsePayload({ number: 77 }), stderr: "" };
              }
              throw new Error(`unexpected command args: ${args.join(" ")}`);
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          });
        },
      }),
      taskStore,
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: [] },
        git: {
          providers: {
            github: {
              enabled: true,
              repository: { host: "github.com", owner: "openai", name: "openducktor" },
              autoDetected: false,
            },
          },
        },
      }),
    });
    await expect(
      Effect.runPromise(
        service.linkPullRequest({
          repoPath: "/repo",
          taskId: "task-1",
          providerId: "github",
          number: 77,
        }),
      ),
    ).resolves.toMatchObject({
      providerId: "github",
      number: 77,
      url: "https://github.com/openai/openducktor/pull/77",
      state: "open",
    });
    expect(calls).toContainEqual({
      type: "setPullRequest",
      input: {
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest: expect.objectContaining({ number: 77, state: "open" }),
      },
    });
  });
  test("detects a merged pull request without linking metadata", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            return task({ status: "human_review" });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
              agentSessions: [],
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "setPullRequest", input });
            return true;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setSpecDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set spec");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPlanDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set plan");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      recordQaOutcome() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected QA");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          gitPort: extendGitPort(
            createDirectMergeGitPort({
              calls,
              currentBranches: {
                "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
              },
            }),
            {
              listRemotes() {
                return Effect.tryPromise({
                  try: async () => {
                    return [{ name: "origin", url: "git@github.com:openai/openducktor.git" }];
                  },
                  catch: (cause) =>
                    new HostOperationError({
                      operation: "test.effect",
                      message: cause instanceof Error ? cause.message : String(cause),
                      cause: cause,
                    }),
                });
              },
            },
          ),
          systemCommands: createPullRequestDetectSystemCommands({
            calls,
            allPayload: githubPullListPayload([
              {
                number: 12,
                state: "closed",
                mergedAt: "2026-05-10T11:00:00.000Z",
                updatedAt: "2026-05-10T11:00:00.000Z",
              },
            ]),
          }),
          taskStore,
          taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
            git: {
              providers: {
                github: {
                  enabled: true,
                  repository: { host: "github.com", owner: "openai", name: "openducktor" },
                  autoDetected: false,
                },
              },
            },
          }),
        }).detectPullRequest({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toMatchObject({
      outcome: "merged",
      pullRequest: {
        providerId: "github",
        number: 12,
        state: "merged",
      },
    });
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "setPullRequest" }));
  });
  test("reports not_found when no pull request matches the builder branch", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            return task({ status: "human_review" });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
              agentSessions: [],
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set pull request");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setSpecDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set spec");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPlanDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set plan");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      recordQaOutcome() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected QA");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          gitPort: extendGitPort(
            createDirectMergeGitPort({
              calls,
              currentBranches: {
                "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
              },
            }),
            {
              listRemotes() {
                return Effect.tryPromise({
                  try: async () => {
                    return [{ name: "origin", url: "git@github.com:openai/openducktor.git" }];
                  },
                  catch: (cause) =>
                    new HostOperationError({
                      operation: "test.effect",
                      message: cause instanceof Error ? cause.message : String(cause),
                      cause: cause,
                    }),
                });
              },
            },
          ),
          systemCommands: createPullRequestDetectSystemCommands({ calls }),
          taskStore,
          taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
            git: {
              providers: {
                github: {
                  enabled: true,
                  repository: { host: "github.com", owner: "openai", name: "openducktor" },
                  autoDetected: false,
                },
              },
            },
          }),
        }).detectPullRequest({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toEqual({
      outcome: "not_found",
      sourceBranch: "odt/task-1",
      targetBranch: "main",
    });
  });
  test("creates a pull request from a clean builder worktree", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            return task({ status: "human_review" });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
              agentSessions: [],
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "setPullRequest", input });
            return true;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setSpecDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set spec");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPlanDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set plan");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      recordQaOutcome() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected QA");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    const service = createTaskService({
      gitPort: extendGitPort(
        createDirectMergeGitPort({
          calls,
          currentBranches: {
            "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
          },
        }),
        {
          listRemotes(workingDir) {
            return Effect.tryPromise({
              try: async () => {
                calls.push({ type: "listRemotes", workingDir });
                return [{ name: "origin", url: "git@github.com:openai/openducktor.git" }];
              },
              catch: (cause) =>
                new HostOperationError({
                  operation: "test.effect",
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause: cause,
                }),
            });
          },
          getWorktreeStatusSummaryData(workingDir, targetBranch, diffScope) {
            return Effect.tryPromise({
              try: async () => {
                calls.push({ type: "summary", workingDir, targetBranch, diffScope });
                return {
                  currentBranch: { name: "odt/task-1", detached: false },
                  fileStatuses: [],
                  fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
                  targetAheadBehind: { ahead: 1, behind: 0 },
                  upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
                };
              },
              catch: (cause) =>
                new HostOperationError({
                  operation: "test.effect",
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause: cause,
                }),
            });
          },
          suggestedSquashCommitMessage() {
            return Effect.tryPromise({
              try: async () => {
                return undefined;
              },
              catch: (cause) =>
                new HostOperationError({
                  operation: "test.effect",
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause: cause,
                }),
            });
          },
          pushBranch(workingDir, branch, options) {
            return Effect.tryPromise({
              try: async () => {
                calls.push({ type: "push", workingDir, branch, options });
                return {
                  outcome: "pushed",
                  remote: options?.remote ?? "origin",
                  branch,
                  output: "",
                };
              },
              catch: (cause) =>
                new HostOperationError({
                  operation: "test.effect",
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause: cause,
                }),
            });
          },
        },
      ),
      settingsConfig: extendSettingsConfigPort(
        createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        {
          readConfig() {
            return Effect.tryPromise({
              try: async () => {
                return null;
              },
              catch: (cause) =>
                new HostOperationError({
                  operation: "test.effect",
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause: cause,
                }),
            });
          },
        },
      ),
      systemCommands: createPullRequestUpsertSystemCommands({
        calls,
        payload: githubPullResponsePayload({ number: 77 }),
      }),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: [] },
        git: {
          providers: {
            github: {
              enabled: true,
              repository: { host: "github.com", owner: "openai", name: "openducktor" },
              autoDetected: false,
            },
          },
        },
      }),
    });
    await expect(
      Effect.runPromise(
        service.upsertPullRequest({
          repoPath: "/repo",
          taskId: "task-1",
          content: { title: "Create PR", body: "Body" },
        }),
      ),
    ).resolves.toMatchObject({
      providerId: "github",
      number: 77,
      state: "open",
    });
    expect(calls).toContainEqual({
      type: "push",
      workingDir: "/worktrees/repo/task-1",
      branch: "odt/task-1",
      options: { remote: "origin", setUpstream: true, forceWithLease: false },
    });
    expect(calls).toContainEqual(
      expect.objectContaining({
        type: "command",
        args: expect.arrayContaining([
          "POST",
          "repos/openai/openducktor/pulls",
          "title=Create PR",
          "head=odt/task-1",
          "base=main",
          "body=Body",
        ]),
      }),
    );
    const resolvedGhChecks = calls.filter(
      (call) =>
        typeof call === "object" &&
        call !== null &&
        (call as { type?: unknown }).type === "resolveCommand" &&
        (call as { command?: unknown }).command === "gh",
    );
    expect(resolvedGhChecks).toHaveLength(1);
    expect(calls).toContainEqual({
      type: "setPullRequest",
      input: {
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest: expect.objectContaining({ number: 77, state: "open" }),
      },
    });
  });
  test("updates an existing editable pull request", async () => {
    const calls: unknown[] = [];
    const existingPullRequest = {
      providerId: "github" as const,
      number: 42,
      url: "https://github.com/openai/openducktor/pull/42",
      state: "draft" as const,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    };
    const taskStore: TaskStorePort = {
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            return task({ status: "human_review" });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
              pullRequest: existingPullRequest,
              agentSessions: [],
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "setPullRequest", input });
            return true;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setSpecDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set spec");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPlanDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set plan");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      recordQaOutcome() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected QA");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          gitPort: extendGitPort(
            createDirectMergeGitPort({
              calls,
              currentBranches: {
                "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
              },
            }),
            {
              listRemotes() {
                return Effect.tryPromise({
                  try: async () => {
                    return [{ name: "origin", url: "git@github.com:openai/openducktor.git" }];
                  },
                  catch: (cause) =>
                    new HostOperationError({
                      operation: "test.effect",
                      message: cause instanceof Error ? cause.message : String(cause),
                      cause: cause,
                    }),
                });
              },
              getWorktreeStatusSummaryData() {
                return Effect.tryPromise({
                  try: async () => {
                    return {
                      currentBranch: { name: "odt/task-1", detached: false },
                      fileStatuses: [],
                      fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
                      targetAheadBehind: { ahead: 1, behind: 0 },
                      upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
                    };
                  },
                  catch: (cause) =>
                    new HostOperationError({
                      operation: "test.effect",
                      message: cause instanceof Error ? cause.message : String(cause),
                      cause: cause,
                    }),
                });
              },
              suggestedSquashCommitMessage() {
                return Effect.tryPromise({
                  try: async () => {
                    return undefined;
                  },
                  catch: (cause) =>
                    new HostOperationError({
                      operation: "test.effect",
                      message: cause instanceof Error ? cause.message : String(cause),
                      cause: cause,
                    }),
                });
              },
              pushBranch(workingDir, branch, options) {
                return Effect.tryPromise({
                  try: async () => {
                    calls.push({ type: "push", workingDir, branch, options });
                    return {
                      outcome: "pushed",
                      remote: options?.remote ?? "origin",
                      branch,
                      output: "",
                    };
                  },
                  catch: (cause) =>
                    new HostOperationError({
                      operation: "test.effect",
                      message: cause instanceof Error ? cause.message : String(cause),
                      cause: cause,
                    }),
                });
              },
            },
          ),
          settingsConfig: extendSettingsConfigPort(
            createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
            {
              readConfig() {
                return Effect.tryPromise({
                  try: async () => {
                    return null;
                  },
                  catch: (cause) =>
                    new HostOperationError({
                      operation: "test.effect",
                      message: cause instanceof Error ? cause.message : String(cause),
                      cause: cause,
                    }),
                });
              },
            },
          ),
          systemCommands: createPullRequestUpsertSystemCommands({
            calls,
            payload: githubPullResponsePayload({ number: 42, draft: true }),
          }),
          taskStore,
          taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
            git: {
              providers: {
                github: {
                  enabled: true,
                  repository: { host: "github.com", owner: "openai", name: "openducktor" },
                  autoDetected: false,
                },
              },
            },
          }),
        }).upsertPullRequest({
          repoPath: "/repo",
          taskId: "task-1",
          content: { title: "Updated PR", body: "Body" },
        }),
      ),
    ).resolves.toMatchObject({
      providerId: "github",
      number: 42,
      state: "draft",
    });
    expect(calls).toContainEqual(
      expect.objectContaining({
        type: "command",
        args: expect.arrayContaining([
          "PATCH",
          "repos/openai/openducktor/pulls/42",
          "title=Updated PR",
          "body=Body",
        ]),
      }),
    );
  });
  test("rejects pull request upsert from a dirty builder worktree", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            return task({ status: "human_review" });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
              agentSessions: [],
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set pull request");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setSpecDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set spec");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPlanDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set plan");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      recordQaOutcome() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected QA");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          gitPort: extendGitPort(
            createDirectMergeGitPort({
              calls,
              currentBranches: {
                "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
              },
            }),
            {
              listRemotes() {
                return Effect.tryPromise({
                  try: async () => {
                    return [{ name: "origin", url: "git@github.com:openai/openducktor.git" }];
                  },
                  catch: (cause) =>
                    new HostOperationError({
                      operation: "test.effect",
                      message: cause instanceof Error ? cause.message : String(cause),
                      cause: cause,
                    }),
                });
              },
              getWorktreeStatusSummaryData() {
                return Effect.tryPromise({
                  try: async () => {
                    return {
                      currentBranch: { name: "odt/task-1", detached: false },
                      fileStatuses: [{ path: "src/main.ts", status: "modified", staged: false }],
                      fileStatusCounts: { total: 1, staged: 0, unstaged: 1 },
                      targetAheadBehind: { ahead: 1, behind: 0 },
                      upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
                    };
                  },
                  catch: (cause) =>
                    new HostOperationError({
                      operation: "test.effect",
                      message: cause instanceof Error ? cause.message : String(cause),
                      cause: cause,
                    }),
                });
              },
              suggestedSquashCommitMessage() {
                return Effect.tryPromise({
                  try: async () => {
                    return undefined;
                  },
                  catch: (cause) =>
                    new HostOperationError({
                      operation: "test.effect",
                      message: cause instanceof Error ? cause.message : String(cause),
                      cause: cause,
                    }),
                });
              },
            },
          ),
          settingsConfig: extendSettingsConfigPort(
            createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
            {
              readConfig() {
                return Effect.tryPromise({
                  try: async () => {
                    return null;
                  },
                  catch: (cause) =>
                    new HostOperationError({
                      operation: "test.effect",
                      message: cause instanceof Error ? cause.message : String(cause),
                      cause: cause,
                    }),
                });
              },
            },
          ),
          systemCommands: createPullRequestUpsertSystemCommands({
            calls,
            payload: githubPullResponsePayload({ number: 77 }),
          }),
          taskStore,
          taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
            git: {
              providers: {
                github: {
                  enabled: true,
                  repository: { host: "github.com", owner: "openai", name: "openducktor" },
                  autoDetected: false,
                },
              },
            },
          }),
        }).upsertPullRequest({
          repoPath: "/repo",
          taskId: "task-1",
          content: { title: "Create PR", body: "Body" },
        }),
      ),
    ).rejects.toThrow(
      "Human approval is blocked because the builder worktree has 1 uncommitted file. Commit or discard it before merging or opening a pull request.",
    );
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "push" }));
  });
  test("rejects pull request upsert when direct merge metadata exists", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            return task({ status: "human_review" });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
              directMerge: {
                method: "squash",
                sourceBranch: "odt/task-1",
                targetBranch: { branch: "main" },
                mergedAt: "2026-05-10T11:00:00.000Z",
              },
              agentSessions: [],
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set pull request");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setSpecDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set spec");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPlanDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set plan");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      recordQaOutcome() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected QA");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          gitPort: createDirectMergeGitPort({ calls }),
          settingsConfig: extendSettingsConfigPort(createBuildSettingsConfig(new Set(["/repo"])), {
            readConfig() {
              return Effect.tryPromise({
                try: async () => {
                  return null;
                },
                catch: (cause) =>
                  new HostOperationError({
                    operation: "test.effect",
                    message: cause instanceof Error ? cause.message : String(cause),
                    cause: cause,
                  }),
              });
            },
          }),
          systemCommands: createPullRequestUpsertSystemCommands({
            calls,
            payload: githubPullResponsePayload({ number: 77 }),
          }),
          taskStore,
          taskWorktreeService: createDirectMergeTaskWorktreeService(null),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
          }),
        }).upsertPullRequest({
          repoPath: "/repo",
          taskId: "task-1",
          content: { title: "Create PR", body: "Body" },
        }),
      ),
    ).rejects.toThrow(
      "A local direct merge is already recorded for task task-1. Finish or discard that direct merge workflow before opening a pull request.",
    );
  });
  test("syncs a merged linked pull request and closes the task", async () => {
    const calls: unknown[] = [];
    const buildSession = createAgentSessionRecord({
      workingDirectory: "/worktrees/repo/task-1",
    });
    const linkedPullRequest = {
      providerId: "github" as const,
      number: 42,
      url: "https://github.com/openai/openducktor/pull/42",
      state: "open" as const,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    };
    const taskStore: TaskStorePort = {
      listPullRequestSyncCandidates(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "syncCandidates", input });
            return [{ id: "task-1", status: "human_review", pullRequest: linkedPullRequest }];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [
              task({
                status: "human_review",
                pullRequest: linkedPullRequest,
              }),
            ];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "metadata", input });
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
              agentSessions: [buildSession],
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "setPullRequest", input });
            return true;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "transition", input });
            return task({ status: input.status });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected get");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setSpecDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set spec");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPlanDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set plan");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      recordQaOutcome() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected QA");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          devServerService: createDirectMergeDevServerService(calls),
          gitPort: createDirectMergeGitPort({
            calls,
            currentBranches: {
              "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
            },
            branches: {
              "/repo": [
                { name: "main", isCurrent: true, isRemote: false },
                { name: "odt/task-1", isCurrent: false, isRemote: false },
              ],
            },
            ancestorResults: { "/repo|odt/task-1|main": true },
          }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          systemCommands: createPullRequestSyncSystemCommands({
            calls,
            payload: githubPullResponsePayload({
              number: 42,
              state: "closed",
              mergedAt: "2026-05-10T11:00:00.000Z",
              updatedAt: "2026-05-10T11:00:00.000Z",
            }),
          }),
          taskStore,
          taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
            git: {
              providers: {
                github: {
                  enabled: true,
                  repository: { host: "github.com", owner: "openai", name: "openducktor" },
                  autoDetected: false,
                },
              },
            },
          }),
        }).repoPullRequestSync({ repoPath: "/repo" }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(calls).toContainEqual({
      type: "setPullRequest",
      input: {
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest: expect.objectContaining({ number: 42, state: "merged" }),
      },
    });
    expect(calls).toContainEqual({
      type: "transition",
      input: { repoPath: "/repo", taskId: "task-1", status: "closed" },
    });
    expect(calls).toContainEqual({
      type: "deleteLocalBranch",
      repoPath: "/repo",
      branch: "odt/task-1",
      force: false,
    });
  });
  test("syncs linked pull request metadata without closing open pull requests", async () => {
    const calls: unknown[] = [];
    const linkedPullRequest = {
      providerId: "github" as const,
      number: 42,
      url: "https://github.com/openai/openducktor/pull/42",
      state: "open" as const,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    };
    const taskStore: TaskStorePort = {
      listPullRequestSyncCandidates() {
        return Effect.tryPromise({
          try: async () => {
            return [{ id: "task-1", status: "human_review", pullRequest: linkedPullRequest }];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "setPullRequest", input });
            return true;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected get");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected metadata");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setSpecDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set spec");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPlanDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set plan");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      recordQaOutcome() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected QA");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          systemCommands: createPullRequestSyncSystemCommands({
            calls,
            payload: githubPullResponsePayload({
              number: 42,
              state: "open",
              updatedAt: "2026-05-10T10:00:00.000Z",
            }),
          }),
          taskStore,
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
            git: {
              providers: {
                github: {
                  enabled: true,
                  repository: { host: "github.com", owner: "openai", name: "openducktor" },
                  autoDetected: false,
                },
              },
            },
          }),
        }).repoPullRequestSync({ repoPath: "/repo" }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(calls).toContainEqual({
      type: "setPullRequest",
      input: {
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest: expect.objectContaining({
          number: 42,
          state: "open",
          updatedAt: "2026-05-10T10:00:00.000Z",
        }),
      },
    });
  });
  test("reports deduplicated changed task ids when a later pull request write fails", async () => {
    const mutationFailure = new HostOperationError({
      operation: "task-store.set-pull-request",
      message: "second write failed",
    });
    const linkedPullRequest = {
      providerId: "github" as const,
      number: 42,
      url: "https://github.com/openai/openducktor/pull/42",
      state: "open" as const,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    };
    let writes = 0;
    const taskStore: TaskStorePort = {
      listPullRequestSyncCandidates: () =>
        Effect.succeed([
          { id: "task-1", status: "human_review", pullRequest: linkedPullRequest },
          { id: "task-2", status: "human_review", pullRequest: linkedPullRequest },
        ]),
      setPullRequest: () => {
        writes += 1;
        return writes === 1 ? Effect.succeed(true) : Effect.fail(mutationFailure);
      },
    };
    const service = createTaskService({
      systemCommands: createPullRequestSyncSystemCommands({
        calls: [],
        payload: githubPullResponsePayload({
          number: 42,
          state: "open",
          updatedAt: "2026-05-10T10:00:00.000Z",
        }),
      }),
      taskStore,
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: [] },
        git: {
          providers: {
            github: {
              enabled: true,
              repository: { host: "github.com", owner: "openai", name: "openducktor" },
              autoDetected: false,
            },
          },
        },
      }),
    });

    const failure = await Effect.runPromise(
      service.repoPullRequestSyncDetailed({ repoPath: "/repo" }).pipe(Effect.flip),
    );
    expect(failure).toBeInstanceOf(TaskMutationProgressFailure);
    expect(failure).toMatchObject({
      changes: { taskIds: ["task-1"], removedTaskIds: [] },
      failure: mutationFailure,
    });
  });
  test("preserves a pre-write pull request sync failure without partial progress", async () => {
    const mutationFailure = new HostOperationError({
      operation: "task-store.set-pull-request",
      message: "first write failed",
    });
    const linkedPullRequest = {
      providerId: "github" as const,
      number: 42,
      url: "https://github.com/openai/openducktor/pull/42",
      state: "open" as const,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    };
    const taskStore: TaskStorePort = {
      listPullRequestSyncCandidates: () =>
        Effect.succeed([{ id: "task-1", status: "human_review", pullRequest: linkedPullRequest }]),
      setPullRequest: () => Effect.fail(mutationFailure),
    };
    const service = createTaskService({
      systemCommands: createPullRequestSyncSystemCommands({
        calls: [],
        payload: githubPullResponsePayload({
          number: 42,
          state: "open",
          updatedAt: "2026-05-10T10:00:00.000Z",
        }),
      }),
      taskStore,
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: [] },
        git: {
          providers: {
            github: {
              enabled: true,
              repository: { host: "github.com", owner: "openai", name: "openducktor" },
              autoDetected: false,
            },
          },
        },
      }),
    });

    await expect(
      Effect.runPromise(
        service.repoPullRequestSyncDetailed({ repoPath: "/repo" }).pipe(Effect.flip),
      ),
    ).resolves.toBe(mutationFailure);
  });
  test("retains merged pull request progress when task closure validation fails", async () => {
    const mutationFailure = new HostOperationError({
      operation: "task-store.list-tasks",
      message: "closure validation failed",
    });
    const linkedPullRequest = {
      providerId: "github" as const,
      number: 42,
      url: "https://github.com/openai/openducktor/pull/42",
      state: "open" as const,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    };
    const taskStore: TaskStorePort = {
      listPullRequestSyncCandidates: () =>
        Effect.succeed([{ id: "task-1", status: "human_review", pullRequest: linkedPullRequest }]),
      setPullRequest: () => Effect.succeed(true),
      listTasks: () => Effect.fail(mutationFailure),
    };
    const service = createTaskService({
      devServerService: createDirectMergeDevServerService([]),
      gitPort: createDirectMergeGitPort({ calls: [] }),
      settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
      systemCommands: createPullRequestSyncSystemCommands({
        calls: [],
        payload: githubPullResponsePayload({
          number: 42,
          state: "closed",
          mergedAt: "2026-05-10T11:00:00.000Z",
          updatedAt: "2026-05-10T11:00:00.000Z",
        }),
      }),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: [] },
        git: {
          providers: {
            github: {
              enabled: true,
              repository: { host: "github.com", owner: "openai", name: "openducktor" },
              autoDetected: false,
            },
          },
        },
      }),
    });

    const failure = await Effect.runPromise(
      service.repoPullRequestSyncDetailed({ repoPath: "/repo" }).pipe(Effect.flip),
    );
    expect(failure).toBeInstanceOf(TaskMutationProgressFailure);
    expect(failure).toMatchObject({
      changes: { taskIds: ["task-1"], removedTaskIds: [] },
      failure: mutationFailure,
    });
  });
  test("skips pull request sync before reading candidates when provider is unavailable", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      listPullRequestSyncCandidates() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not list candidates");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not set pull request");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected get");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected metadata");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setSpecDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set spec");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPlanDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set plan");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      recordQaOutcome() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected QA");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          systemCommands: createPullRequestSyncSystemCommands({
            calls,
            available: false,
            payload: githubPullResponsePayload({ number: 42 }),
          }),
          taskStore,
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
            git: {
              providers: {
                github: {
                  enabled: true,
                  repository: { host: "github.com", owner: "openai", name: "openducktor" },
                  autoDetected: false,
                },
              },
            },
          }),
        }).repoPullRequestSync({ repoPath: "/repo" }),
      ),
    ).resolves.toEqual({ ok: false });
    expect(calls).toEqual([{ type: "resolveCommand", command: "gh" }]);
  });
  test("unlinks a pull request after validating task state and metadata", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "get", input });
            return task({ status: "human_review" });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "metadata", input });
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
              pullRequest: {
                providerId: "github",
                number: 42,
                url: "https://github.com/openai/openducktor/pull/42",
                state: "open",
                createdAt: "2026-05-01T00:00:00.000Z",
                updatedAt: "2026-05-02T00:00:00.000Z",
              },
              agentSessions: [],
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "setPullRequest", input });
            return true;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({ taskStore }).unlinkPullRequest({
          repoPath: "/repo",
          taskId: "task-1",
        }),
      ),
    ).resolves.toBe(true);
    expect(calls).toEqual([
      { type: "get", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      {
        type: "setPullRequest",
        input: { repoPath: "/repo", taskId: "task-1", pullRequest: null },
      },
    ]);
  });
  test("rejects pull request unlink outside PR management statuses", async () => {
    const taskStore: TaskStorePort = {
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            return task({ status: "ready_for_dev" });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set pull request");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected metadata");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({ taskStore }).unlinkPullRequest({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).rejects.toThrow(
      "Pull request management is only available from in_progress, ai_review, or human_review.",
    );
  });
  test("rejects pull request unlink when no linked pull request exists", async () => {
    const taskStore: TaskStorePort = {
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            return task({ status: "in_progress" });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
              agentSessions: [],
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set pull request");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({ taskStore }).unlinkPullRequest({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).rejects.toThrow("Task task-1 does not have a linked pull request.");
  });
  test("links a merged pull request, closes the task, and cleans builder state", async () => {
    const calls: unknown[] = [];
    const closedTask = task({ status: "closed" });
    const buildSession = createAgentSessionRecord({
      workingDirectory: "/worktrees/repo/task-1",
    });
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [task({ status: "human_review" })];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "metadata", input });
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
              agentSessions: [buildSession],
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "setPullRequest", input });
            return true;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "transition", input });
            return closedTask;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected get");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    const service = createTaskService({
      devServerService: createDirectMergeDevServerService(calls),
      gitPort: createDirectMergeGitPort({
        calls,
        currentBranches: {
          "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
        },
        branches: {
          "/repo": [
            { name: "main", isCurrent: true, isRemote: false },
            { name: "odt/task-1", isCurrent: false, isRemote: false },
          ],
        },
        ancestorResults: { "/repo|odt/task-1|main": true },
      }),
      settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: [] },
      }),
    });
    await expect(
      Effect.runPromise(
        service.linkMergedPullRequest({
          repoPath: "/repo",
          taskId: "task-1",
          pullRequest: pullRequest(),
        }),
      ),
    ).resolves.toMatchObject({ id: "task-1", status: "closed" });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
      {
        type: "setPullRequest",
        input: { repoPath: "/repo", taskId: "task-1", pullRequest: pullRequest() },
      },
      { type: "stopDevServers", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        force: false,
      },
      { type: "listBranches", workingDir: "/repo" },
      { type: "isAncestor", workingDir: "/repo", ancestor: "odt/task-1", descendant: "main" },
      { type: "deleteLocalBranch", repoPath: "/repo", branch: "odt/task-1", force: false },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "closed" },
      },
    ]);
  });
  test("reports merged pull request closure failures as partial progress", async () => {
    const failure = new HostOperationError({
      operation: "task-store.transition-task",
      message: "closure failed",
    });
    let pullRequestWritten = false;
    const taskStore: TaskStorePort = {
      listTasks: () => Effect.succeed([task({ status: "human_review" })]),
      getTaskMetadata: () =>
        Effect.succeed({
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        }),
      setPullRequest: () =>
        Effect.sync(() => {
          pullRequestWritten = true;
          return true;
        }),
      transitionTask: () => Effect.fail(failure),
    };
    const service = createTaskServiceWithMutationProgress({
      devServerService: createDirectMergeDevServerService([]),
      gitPort: createDirectMergeGitPort({
        calls: [],
        currentBranches: { "/worktrees/repo/task-1": { name: "odt/task-1", detached: false } },
        branches: {
          "/repo": [
            { name: "main", isCurrent: true, isRemote: false },
            { name: "odt/task-1", isCurrent: false, isRemote: false },
          ],
        },
        ancestorResults: { "/repo|odt/task-1|main": true },
      }),
      settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: [] },
      }),
    });

    const result = await Effect.runPromise(
      service
        .linkMergedPullRequest({ repoPath: "/repo", taskId: "task-1", pullRequest: pullRequest() })
        .pipe(Effect.flip),
    );

    if (!(result instanceof TaskMutationProgressFailure)) {
      throw new Error("Expected a TaskMutationProgressFailure");
    }
    expect(pullRequestWritten).toBe(true);
    expect(result.operation).toBe("link-merged-pull-request");
    expect(result.changes).toEqual({ taskIds: ["task-1"], removedTaskIds: [] });
    expect(result.failure).toBe(failure);
  });
  test("linkMergedPullRequest preserves task policy errors for invalid workflow statuses", async () => {
    const calls: unknown[] = [];
    const taskStore = {
      listTasks(input: { repoPath: string }) {
        calls.push({ type: "list", input });
        return Effect.succeed([task({ status: "open" })]);
      },
      getTaskMetadata(input: { repoPath: string; taskId: string }) {
        calls.push({ type: "metadata", input });
        return Effect.succeed({
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        });
      },
    } as unknown as TaskStorePort;
    const service = createTaskService({
      devServerService: createDirectMergeDevServerService(calls),
      gitPort: createDirectMergeGitPort({ calls }),
      settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService(null),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: [] },
      }),
    });

    const error = await Effect.runPromise(
      Effect.flip(
        service.linkMergedPullRequest({
          repoPath: "/repo",
          taskId: "task-1",
          pullRequest: pullRequest(),
        }),
      ),
    );

    expect(error).toBeInstanceOf(TaskPolicyError);
    expect((error as TaskPolicyError).code).toBe("TASK_POLICY_ERROR");
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
    ]);
  });
  test("returns a closed task unchanged when the same merged pull request is already linked", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [task({ status: "closed" })];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "metadata", input });
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
              pullRequest: pullRequest(),
              agentSessions: [],
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not set pull request");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected get");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          devServerService: createDirectMergeDevServerService(calls),
          gitPort: createDirectMergeGitPort({ calls }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          taskStore,
          taskWorktreeService: createDirectMergeTaskWorktreeService(null),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
          }),
        }).linkMergedPullRequest({
          repoPath: "/repo",
          taskId: "task-1",
          pullRequest: pullRequest(),
        }),
      ),
    ).resolves.toMatchObject({ id: "task-1", status: "closed" });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
    ]);
  });
  test("rejects pull request link completion for unmerged pull requests", async () => {
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            return [task({ status: "human_review" })];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
              agentSessions: [],
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not set pull request");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected get");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          devServerService: createDirectMergeDevServerService([]),
          gitPort: createDirectMergeGitPort({ calls: [] }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          taskStore,
          taskWorktreeService: createDirectMergeTaskWorktreeService(null),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
          }),
        }).linkMergedPullRequest({
          repoPath: "/repo",
          taskId: "task-1",
          pullRequest: { ...pullRequest(), state: "open" },
        }),
      ),
    ).rejects.toThrow("Task task-1 can only link a merged pull request from detection results.");
  });
});
