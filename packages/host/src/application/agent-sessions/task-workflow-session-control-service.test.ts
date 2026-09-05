import { describe, expect, test } from "bun:test";
import type {
  AcceptedAgentUserMessage,
  AgentSessionControlSendInput,
  AgentSessionControlSummary,
  AgentSessionControlUpdateModelInput,
  AgentSessionRecord,
  AgentWorkflowSessionStartInput,
  TaskCard,
} from "@openducktor/contracts";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createTaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import { createTaskWorkflowSessionControlService as createControlService } from "./task-workflow-session-control-service";

type ControlServiceInput = Parameters<typeof createControlService>[0];
type TestControlServiceInput = Omit<ControlServiceInput, "taskSessionStart" | "tasks"> & {
  taskSessionStart?: ControlServiceInput["taskSessionStart"];
  tasks: Omit<ControlServiceInput["tasks"], "transitionTask"> &
    Partial<Pick<ControlServiceInput["tasks"], "transitionTask">>;
};

const createTaskWorkflowSessionControlService = (input: TestControlServiceInput) =>
  createControlService({
    taskSessionStart: {
      prepare: () => Effect.dieMessage("unexpected task session preparation"),
      complete: () => Effect.dieMessage("unexpected task session completion"),
    },
    ...input,
    tasks: {
      transitionTask: () => Effect.dieMessage("unexpected task transition"),
      ...input.tasks,
    },
  });

const workflowStart: AgentWorkflowSessionStartInput = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  targetWorkingDirectory: "/repo/worktree",
  sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
  systemPrompt: "Build the feature",
  model: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
  },
};

const summary: AgentSessionControlSummary = {
  externalSessionId: "session-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  title: "Build session",
  startedAt: "2026-09-02T10:00:00.000Z",
  status: "idle",
};

const storedModel: AgentSessionRecord["selectedModel"] = {
  runtimeKind: "opencode",
  providerId: "openai",
  modelId: "gpt-5",
  profileId: "build",
};

const task = (status: TaskCard["status"]): TaskCard => ({
  id: "task-1",
  title: "Task 1",
  description: "",
  status,
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
    spec: {
      required: false,
      canSkip: true,
      available: false,
      completed: false,
    },
    planner: {
      required: false,
      canSkip: true,
      available: false,
      completed: false,
    },
    builder: {
      required: true,
      canSkip: false,
      available: false,
      completed: false,
    },
    qa: { required: true, canSkip: false, available: false, completed: false },
  },
  updatedAt: "2026-09-02T10:00:00.000Z",
  createdAt: "2026-09-02T09:00:00.000Z",
});

const taskReader = { getTask: () => Effect.succeed(task("in_progress")) };

const createControlDeps = () => ({
  canonicalizeRepoPath: (repoPath: string) => Effect.succeed(repoPath),
  taskReader,
  taskLifecycle: createTaskSessionLifecycleCoordinator(),
});

const workflowModelUpdate: AgentSessionControlUpdateModelInput = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
  sessionScope: workflowStart.sessionScope,
  model: { providerId: "openai", modelId: "gpt-5.1" },
};

const workflowSend: AgentSessionControlSendInput = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
  sessionScope: workflowStart.sessionScope,
  parts: [{ kind: "text", text: "Continue" }],
  model: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
    profileId: "other-profile",
  },
};

const acceptedUserMessage: AcceptedAgentUserMessage = {
  type: "user_message",
  externalSessionId: "session-1",
  timestamp: "2026-09-02T10:01:00.000Z",
  messageId: "message-1",
  message: "Continue",
  parts: [{ kind: "text", text: "Continue" }],
  state: "queued",
};

const unexpectedSend = () => Effect.dieMessage("unexpected send");

type ControlDeps = Parameters<typeof createTaskWorkflowSessionControlService>[0];

const createModelUpdateService = ({
  selectedModel = storedModel,
  updateRuntimeModel,
  updateStoredModel,
}: {
  selectedModel?: AgentSessionRecord["selectedModel"];
  updateRuntimeModel: ControlDeps["runtime"]["updateSessionModel"];
  updateStoredModel: ControlDeps["tasks"]["agentSessionUpdateModel"];
}) =>
  createTaskWorkflowSessionControlService({
    ...createControlDeps(),
    runtime: {
      startSession: () => Effect.dieMessage("unexpected start"),
      resumeSession: () => Effect.dieMessage("unexpected resume"),
      forkSession: () => Effect.dieMessage("unexpected fork"),
      sendUserMessage: unexpectedSend,
      updateSessionModel: updateRuntimeModel,
      stopSession: () => Effect.dieMessage("unexpected stop"),
      releaseSession: () => Effect.dieMessage("unexpected release"),
    },
    tasks: {
      agentSessionsList: () => Effect.succeed([{ ...summary, role: "build", selectedModel }]),
      agentSessionUpsert: () => Effect.dieMessage("unexpected store"),
      agentSessionUpdateModel: updateStoredModel,
    },
  });

describe("createTaskWorkflowSessionControlService", () => {
  test.each([false, true])(
    "waits for interrupted runtime creation before cleanup (stop fails: %s)",
    async (stopFails) => {
      const calls: string[] = [];
      const created = await Effect.runPromise(Deferred.make<void>());
      const returnSummary = await Effect.runPromise(Deferred.make<void>());
      const preparedTask = task("ready_for_dev");
      const deps = createControlDeps();
      const service = createTaskWorkflowSessionControlService({
        ...deps,
        taskSessionStart: {
          prepare: () =>
            Effect.succeed({
              canonicalRepoPath: "/repo",
              cleanup: () =>
                Effect.sync(() => {
                  calls.push("cleanup-worktree");
                  return "";
                }),
              preparedStatus: preparedTask.status,
              role: "build",
              runtimeKind: "opencode",
              task: preparedTask,
              workingDirectory: "/repo/worktree",
            }),
          complete: () => Effect.dieMessage("unexpected completion"),
        },
        runtime: {
          startSession: () =>
            Effect.gen(function* () {
              calls.push("runtime-created");
              yield* Deferred.succeed(created, undefined);
              yield* Deferred.await(returnSummary);
              calls.push("runtime-returned");
              return summary;
            }),
          stopSession: (ref) =>
            Effect.gen(function* () {
              expect(ref.externalSessionId).toBe(summary.externalSessionId);
              calls.push("stop-runtime");
              if (stopFails) {
                return yield* Effect.fail(
                  new HostOperationError({
                    operation: "test.stop",
                    message: "stop failed",
                  }),
                );
              }
            }),
          resumeSession: () => Effect.dieMessage("unexpected resume"),
          forkSession: () => Effect.dieMessage("unexpected fork"),
          sendUserMessage: unexpectedSend,
          updateSessionModel: () => Effect.dieMessage("unexpected model update"),
          releaseSession: () => Effect.dieMessage("unexpected release"),
        },
        tasks: {
          agentSessionsList: () => Effect.dieMessage("unexpected list"),
          agentSessionUpsert: () => Effect.dieMessage("unexpected store"),
          agentSessionUpdateModel: () => Effect.dieMessage("unexpected model store"),
        },
      });
      const fiber = Effect.runFork(service.startWorkflowSession(workflowStart));
      try {
        await Effect.runPromise(Deferred.await(created));
        await Effect.runPromise(Fiber.interruptFork(fiber));
        await Effect.runPromise(Deferred.succeed(returnSummary, undefined));
        expect(Exit.isFailure(await Effect.runPromise(Fiber.await(fiber)))).toBe(true);
        expect(calls).toEqual(
          stopFails
            ? ["runtime-created", "runtime-returned", "stop-runtime"]
            : ["runtime-created", "runtime-returned", "stop-runtime", "cleanup-worktree"],
        );
        await expect(
          Effect.runPromise(
            Effect.scoped(deps.taskLifecycle.acquireLifecycle("/repo", ["task-1"], "close task")),
          ),
        ).resolves.toBeUndefined();
      } finally {
        await Effect.runPromise(Deferred.succeed(returnSummary, undefined));
        await Effect.runPromise(Fiber.interrupt(fiber));
      }
    },
  );

  test("starts and stores a fresh workflow session inside one task lifecycle scope", async () => {
    const calls: string[] = [];
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const preparedTask = task("ready_for_dev");
    const service = createTaskWorkflowSessionControlService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      taskLifecycle,
      taskSessionStart: {
        prepare: () =>
          Effect.sync(() => {
            calls.push("prepare");
            return {
              canonicalRepoPath: "/repo",
              cleanup: () => Effect.succeed(""),
              preparedStatus: preparedTask.status,
              role: "build" as const,
              runtimeKind: "opencode" as const,
              task: preparedTask,
              workingDirectory: "/repo/worktree",
            };
          }),
        complete: (_prepared, transitionTask) =>
          Effect.gen(function* () {
            calls.push("complete");
            yield* transitionTask({
              repoPath: "/repo",
              taskId: "task-1",
              status: "in_progress",
            });
            return undefined;
          }),
      },
      runtime: {
        startSession: () =>
          Effect.sync(() => {
            calls.push("runtime");
            return summary;
          }),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () => Effect.dieMessage("unexpected list"),
        agentSessionUpsert: () =>
          Effect.gen(function* () {
            calls.push("store");
            const overlap = yield* Effect.either(
              Effect.scoped(taskLifecycle.acquireLifecycle("/repo", ["task-1"], "close task")),
            );
            expect(overlap._tag).toBe("Left");
            return true;
          }),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected model store"),
        transitionTask: () =>
          Effect.sync(() => {
            calls.push("transition");
            return task("in_progress");
          }),
      },
    });

    await expect(
      Effect.runPromise(
        service.startWorkflowSession({
          repoPath: "/repo",
          runtimeKind: "opencode",
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: workflowStart.systemPrompt,
          model: workflowStart.model!,
        }),
      ),
    ).resolves.toEqual(summary);
    expect(calls).toEqual(["prepare", "runtime", "store", "complete", "transition"]);
    await expect(
      Effect.runPromise(
        Effect.scoped(taskLifecycle.acquireLifecycle("/repo", ["task-1"], "close task")),
      ),
    ).resolves.toBeUndefined();
  });

  test("stops the runtime and removes a new worktree when session storage fails", async () => {
    const calls: string[] = [];
    const preparedTask = task("ready_for_dev");
    const service = createTaskWorkflowSessionControlService({
      ...createControlDeps(),
      taskSessionStart: {
        prepare: () =>
          Effect.succeed({
            canonicalRepoPath: "/repo",
            cleanup: () =>
              Effect.sync(() => {
                calls.push("cleanup-worktree");
                return "";
              }),
            preparedStatus: preparedTask.status,
            role: "build" as const,
            runtimeKind: "opencode" as const,
            task: preparedTask,
            workingDirectory: "/repo/worktree",
          }),
        complete: () => Effect.dieMessage("unexpected completion"),
      },
      runtime: {
        startSession: () => Effect.succeed(summary),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: () => Effect.sync(() => calls.push("stop-runtime")),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () => Effect.dieMessage("unexpected list"),
        agentSessionUpsert: () =>
          Effect.fail(new HostOperationError({ operation: "test.store", message: "store failed" })),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected model store"),
      },
    });

    await expect(
      Effect.runPromise(
        service.startWorkflowSession({
          repoPath: "/repo",
          runtimeKind: "opencode",
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: workflowStart.systemPrompt,
          model: workflowStart.model!,
        }),
      ),
    ).rejects.toThrow("store failed");
    expect(calls).toEqual(["stop-runtime", "cleanup-worktree"]);
  });

  test("keeps a new worktree when session storage and runtime stop both fail", async () => {
    const calls: string[] = [];
    const preparedTask = task("ready_for_dev");
    const service = createTaskWorkflowSessionControlService({
      ...createControlDeps(),
      taskSessionStart: {
        prepare: () =>
          Effect.succeed({
            canonicalRepoPath: "/repo",
            cleanup: () =>
              Effect.sync(() => {
                calls.push("cleanup-worktree");
                return "";
              }),
            preparedStatus: preparedTask.status,
            role: "build" as const,
            runtimeKind: "opencode" as const,
            task: preparedTask,
            workingDirectory: "/repo/worktree",
          }),
        complete: () => Effect.dieMessage("unexpected completion"),
      },
      runtime: {
        startSession: () => Effect.succeed(summary),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: () =>
          Effect.sync(() => calls.push("stop-runtime")).pipe(
            Effect.zipRight(
              Effect.fail(
                new HostOperationError({
                  operation: "test.stop",
                  message: "runtime stop failed",
                }),
              ),
            ),
          ),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () => Effect.dieMessage("unexpected list"),
        agentSessionUpsert: () =>
          Effect.fail(new HostOperationError({ operation: "test.store", message: "store failed" })),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected model store"),
      },
    });

    await expect(
      Effect.runPromise(
        service.startWorkflowSession({
          repoPath: "/repo",
          runtimeKind: "opencode",
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: workflowStart.systemPrompt,
          model: workflowStart.model!,
        }),
      ),
    ).rejects.toThrow("store failed Cleanup failed: runtime stop failed");
    expect(calls).toEqual(["stop-runtime"]);
  });

  test("keeps the stored session and worktree when Builder completion fails", async () => {
    const calls: string[] = [];
    const preparedTask = task("ready_for_dev");
    const service = createTaskWorkflowSessionControlService({
      ...createControlDeps(),
      taskSessionStart: {
        prepare: () =>
          Effect.succeed({
            canonicalRepoPath: "/repo",
            cleanup: () =>
              Effect.sync(() => {
                calls.push("cleanup-worktree");
                return "";
              }),
            preparedStatus: preparedTask.status,
            role: "build" as const,
            runtimeKind: "opencode" as const,
            task: preparedTask,
            workingDirectory: "/repo/worktree",
          }),
        complete: () =>
          Effect.fail(
            new HostOperationError({ operation: "test.complete", message: "task changed" }),
          ),
      },
      runtime: {
        startSession: () => Effect.succeed(summary),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: () => Effect.sync(() => calls.push("stop-runtime")),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () => Effect.dieMessage("unexpected list"),
        agentSessionUpsert: () => Effect.succeed(true),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected model store"),
      },
    });

    await expect(
      Effect.runPromise(
        service.startWorkflowSession({
          repoPath: "/repo",
          runtimeKind: "opencode",
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: workflowStart.systemPrompt,
          model: workflowStart.model!,
        }),
      ),
    ).rejects.toThrow("task changed");
    expect(calls).toEqual(["stop-runtime"]);
  });

  test("does not store a repository session", async () => {
    let storeCount = 0;
    const service = createTaskWorkflowSessionControlService({
      ...createControlDeps(),
      runtime: {
        startSession: () => Effect.succeed(summary),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () => Effect.dieMessage("unexpected list"),
        agentSessionUpsert: () =>
          Effect.sync(() => {
            storeCount += 1;
            return true;
          }),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected stored model update"),
      },
    });

    await Effect.runPromise(
      service.startSession({
        repoPath: workflowStart.repoPath,
        runtimeKind: workflowStart.runtimeKind,
        workingDirectory: "/repo/worktree",
        sessionScope: { kind: "repository" },
        systemPrompt: workflowStart.systemPrompt,
        model: workflowStart.model,
      }),
    );

    expect(storeCount).toBe(0);
  });

  test("stores controlled resume and fork results", async () => {
    const stored: AgentSessionRecord[] = [];
    const service = createTaskWorkflowSessionControlService({
      ...createControlDeps(),
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: (input) =>
          Effect.succeed({
            ...summary,
            externalSessionId: input.externalSessionId,
          }),
        forkSession: () => Effect.succeed({ ...summary, externalSessionId: "fork-1" }),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([
            {
              ...summary,
              role: "build",
              selectedModel: storedModel,
            },
          ]),
        agentSessionUpsert: ({ session }) =>
          Effect.sync(() => {
            stored.push(session);
            return true;
          }),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected stored model update"),
      },
    });

    await Effect.runPromise(
      service.resumeSession({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
        sessionScope: workflowStart.sessionScope,
      }),
    );
    await Effect.runPromise(
      service.forkSession({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        parentExternalSessionId: "session-1",
        sessionScope: workflowStart.sessionScope,
        systemPrompt: "Fork it",
        model: workflowStart.model,
      }),
    );

    expect(stored.map(({ externalSessionId }) => externalSessionId)).toEqual([
      "session-1",
      "fork-1",
    ]);
    expect(stored[0]?.selectedModel).toEqual(storedModel);
  });

  test("rejects a workflow resume when the stored role differs", async () => {
    let runtimeCalls = 0;
    const service = createTaskWorkflowSessionControlService({
      ...createControlDeps(),
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return summary;
          }),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([
            {
              ...summary,
              role: "planner" as const,
              selectedModel: storedModel,
            },
          ]),
        agentSessionUpsert: () => Effect.dieMessage("unexpected store"),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected stored model update"),
      },
    });

    await expect(
      Effect.runPromise(
        service.resumeSession({
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
          sessionScope: workflowStart.sessionScope,
        }),
      ),
    ).rejects.toThrow("Task 'task-1' does not own session 'session-1' for role 'build'.");
    expect(runtimeCalls).toBe(0);
  });

  test("rejects a workflow fork when the task does not own the parent", async () => {
    let runtimeCalls = 0;
    const service = createTaskWorkflowSessionControlService({
      ...createControlDeps(),
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return { ...summary, externalSessionId: "fork-1" };
          }),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () => Effect.succeed([]),
        agentSessionUpsert: () => Effect.dieMessage("unexpected store"),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected stored model update"),
      },
    });

    await expect(
      Effect.runPromise(
        service.forkSession({
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          parentExternalSessionId: "session-1",
          sessionScope: workflowStart.sessionScope,
          systemPrompt: "Fork it",
          model: workflowStart.model,
        }),
      ),
    ).rejects.toThrow("Task 'task-1' does not own session 'session-1' for role 'build'.");
    expect(runtimeCalls).toBe(0);
  });

  test("rejects a workflow fork when its role is not available", async () => {
    let runtimeCalls = 0;
    const service = createTaskWorkflowSessionControlService({
      ...createControlDeps(),
      taskReader: { getTask: () => Effect.succeed(task("closed")) },
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return { ...summary, externalSessionId: "fork-1" };
          }),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.dieMessage("unexpected store"),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected stored model update"),
      },
    });

    await expect(
      Effect.runPromise(
        service.forkSession({
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          parentExternalSessionId: "session-1",
          sessionScope: workflowStart.sessionScope,
          systemPrompt: "Fork it",
          model: workflowStart.model,
        }),
      ),
    ).rejects.toThrow("build workflow is not available for task task-1");
    expect(runtimeCalls).toBe(0);
  });

  test("sends a workflow message through its stored session", async () => {
    const runtimeInputs: AgentSessionControlSendInput[] = [];
    const service = createTaskWorkflowSessionControlService({
      canonicalizeRepoPath: () => Effect.succeed("/repo"),
      taskReader,
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        sendUserMessage: (input) =>
          Effect.sync(() => {
            runtimeInputs.push(input);
            return acceptedUserMessage;
          }),
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.dieMessage("unexpected store"),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected stored model update"),
      },
      taskLifecycle: createTaskSessionLifecycleCoordinator(),
    });

    await expect(
      Effect.runPromise(service.sendUserMessage({ ...workflowSend, repoPath: "/repo/." })),
    ).resolves.toEqual(acceptedUserMessage);
    expect(runtimeInputs).toEqual([
      {
        ...workflowSend,
        repoPath: "/repo",
        model: storedModel,
      },
    ]);
  });

  test("rejects a workflow message when the task does not own the session", async () => {
    let runtimeCalls = 0;
    const service = createTaskWorkflowSessionControlService({
      ...createControlDeps(),
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        sendUserMessage: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return acceptedUserMessage;
          }),
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () => Effect.succeed([]),
        agentSessionUpsert: () => Effect.dieMessage("unexpected store"),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected stored model update"),
      },
    });

    await expect(Effect.runPromise(service.sendUserMessage(workflowSend))).rejects.toThrow(
      "Task 'task-1' does not own session 'session-1' for role 'build'.",
    );
    expect(runtimeCalls).toBe(0);
  });

  test("does not send a workflow message while another task lifecycle change runs", async () => {
    let runtimeCalls = 0;
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createTaskWorkflowSessionControlService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        sendUserMessage: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return acceptedUserMessage;
          }),
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.dieMessage("unexpected store"),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected stored model update"),
      },
      taskLifecycle,
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task");
          return yield* Effect.either(service.sendUserMessage(workflowSend));
        }),
      ),
    );

    expect(result._tag).toBe("Left");
    expect(runtimeCalls).toBe(0);
  });

  test("updates a stored model only after the runtime accepts the workflow change", async () => {
    const calls: string[] = [];
    const runtimeInputs: unknown[] = [];
    const storedModels: unknown[] = [];
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createTaskWorkflowSessionControlService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        sendUserMessage: unexpectedSend,
        updateSessionModel: (input) =>
          Effect.sync(() => {
            calls.push("runtime");
            runtimeInputs.push(input);
          }),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.dieMessage("unexpected store"),
        agentSessionUpdateModel: (input) =>
          Effect.sync(() => {
            calls.push("store");
            storedModels.push(input);
            return true;
          }),
      },
      taskLifecycle,
    });

    await Effect.runPromise(
      service.updateSessionModel({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
        sessionScope: workflowStart.sessionScope,
        model: {
          providerId: "openai",
          modelId: "gpt-5.1",
          variant: "high",
        },
      }),
    );

    expect(calls).toEqual(["runtime", "store"]);
    expect(runtimeInputs).toEqual([
      {
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
        sessionScope: workflowStart.sessionScope,
        model: {
          providerId: "openai",
          modelId: "gpt-5.1",
          variant: "high",
        },
      },
    ]);
    expect(storedModels).toEqual([
      {
        repoPath: "/repo",
        taskId: "task-1",
        identity: {
          externalSessionId: "session-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5.1",
          variant: "high",
          profileId: "build",
        },
      },
    ]);
  });

  test("restores the runtime model when the task record update fails", async () => {
    const calls: string[] = [];
    const runtimeModels: unknown[] = [];
    const service = createModelUpdateService({
      updateRuntimeModel: (input) =>
        Effect.sync(() => {
          calls.push("runtime");
          runtimeModels.push(input.model);
        }),
      updateStoredModel: () => {
        calls.push("store");
        return Effect.fail(
          new HostOperationError({
            operation: "task-session.update-model",
            message: "task store unavailable",
          }),
        );
      },
    });

    await expect(
      Effect.runPromise(
        service.updateSessionModel({
          ...workflowModelUpdate,
          model: {
            providerId: "openai",
            modelId: "gpt-5.1",
            variant: "high",
          },
        }),
      ),
    ).rejects.toThrow("task store unavailable");

    expect(calls).toEqual(["runtime", "store", "runtime"]);
    expect(runtimeModels).toEqual([
      {
        providerId: "openai",
        modelId: "gpt-5.1",
        variant: "high",
      },
      {
        providerId: "openai",
        modelId: "gpt-5",
      },
    ]);
  });

  test("clears the runtime model when a failed task record update had no stored model", async () => {
    const runtimeModels: unknown[] = [];
    const service = createModelUpdateService({
      selectedModel: null,
      updateRuntimeModel: (input) =>
        Effect.sync(() => {
          runtimeModels.push(input.model);
        }),
      updateStoredModel: () =>
        Effect.fail(
          new HostOperationError({
            operation: "task-session.update-model",
            message: "task store unavailable",
          }),
        ),
    });

    await expect(
      Effect.runPromise(service.updateSessionModel(workflowModelUpdate)),
    ).rejects.toThrow("task store unavailable");

    expect(runtimeModels).toEqual([{ providerId: "openai", modelId: "gpt-5.1" }, null]);
  });

  test("restores the runtime model when no task record is updated", async () => {
    const runtimeModels: unknown[] = [];
    const service = createModelUpdateService({
      updateRuntimeModel: (input) =>
        Effect.sync(() => {
          runtimeModels.push(input.model);
        }),
      updateStoredModel: () => Effect.succeed(false),
    });

    await expect(
      Effect.runPromise(service.updateSessionModel(workflowModelUpdate)),
    ).rejects.toThrow("Task 'task-1' did not update session 'session-1'.");

    expect(runtimeModels).toEqual([
      { providerId: "openai", modelId: "gpt-5.1" },
      { providerId: "openai", modelId: "gpt-5" },
    ]);
  });

  test("reports both failures when it cannot restore the runtime model", async () => {
    const storeFailure = new HostOperationError({
      operation: "task-session.update-model",
      message: "task store unavailable",
    });
    const restoreFailure = new HostOperationError({
      operation: "agent-session.update-model",
      message: "runtime restore unavailable",
    });
    let runtimeCalls = 0;
    const service = createModelUpdateService({
      updateRuntimeModel: () => {
        runtimeCalls += 1;
        return runtimeCalls === 1 ? Effect.void : Effect.fail(restoreFailure);
      },
      updateStoredModel: () => Effect.fail(storeFailure),
    });

    const result = await Effect.runPromise(
      Effect.either(service.updateSessionModel(workflowModelUpdate)),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(HostOperationError);
      expect(result.left.message).toBe(
        "task store unavailable Runtime model restore failed: runtime restore unavailable",
      );
      expect(result.left.cause).toEqual({ storeFailure, restoreFailure });
    }
  });

  test("checks workflow ownership before it changes the runtime model", async () => {
    let runtimeCalls = 0;
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createTaskWorkflowSessionControlService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
          }),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () => Effect.succeed([]),
        agentSessionUpsert: () => Effect.dieMessage("unexpected store"),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected stored model update"),
      },
      taskLifecycle,
    });

    await expect(
      Effect.runPromise(
        service.updateSessionModel({
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
          sessionScope: workflowStart.sessionScope,
          model: { providerId: "openai", modelId: "gpt-5.1" },
        }),
      ),
    ).rejects.toThrow("Task 'task-1' does not own session 'session-1' for role 'build'.");
    expect(runtimeCalls).toBe(0);
  });

  test("does not change a workflow model while another task lifecycle change runs", async () => {
    let runtimeCalls = 0;
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createTaskWorkflowSessionControlService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
          }),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.dieMessage("unexpected store"),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected stored model update"),
      },
      taskLifecycle,
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task");
          return yield* Effect.either(
            service.updateSessionModel({
              repoPath: "/repo",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
              externalSessionId: "session-1",
              sessionScope: workflowStart.sessionScope,
              model: { providerId: "openai", modelId: "gpt-5.1" },
            }),
          );
        }),
      ),
    );

    expect(result._tag).toBe("Left");
    expect(runtimeCalls).toBe(0);
  });

  test("does not resume a workflow session while another task lifecycle change runs", async () => {
    let runtimeCalls = 0;
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createTaskWorkflowSessionControlService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return summary;
          }),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.dieMessage("unexpected store"),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected stored model update"),
      },
      taskLifecycle,
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task");
          return yield* Effect.either(
            service.resumeSession({
              repoPath: "/repo",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
              externalSessionId: "session-1",
              sessionScope: workflowStart.sessionScope,
            }),
          );
        }),
      ),
    );

    expect(result._tag).toBe("Left");
    expect(runtimeCalls).toBe(0);
  });

  test("does not fork a workflow session while another task lifecycle change runs", async () => {
    let runtimeCalls = 0;
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createTaskWorkflowSessionControlService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return { ...summary, externalSessionId: "fork-1" };
          }),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.dieMessage("unexpected store"),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected stored model update"),
      },
      taskLifecycle,
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task");
          return yield* Effect.either(
            service.forkSession({
              repoPath: "/repo",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
              parentExternalSessionId: "session-1",
              sessionScope: workflowStart.sessionScope,
              systemPrompt: "Fork it",
              model: workflowStart.model,
            }),
          );
        }),
      ),
    );

    expect(result._tag).toBe("Left");
    expect(runtimeCalls).toBe(0);
  });

  test("holds the task lifecycle gate until the fork record is stored", async () => {
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    let resetWasBlocked = false;
    const service = createTaskWorkflowSessionControlService({
      ...createControlDeps(),
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.succeed({ ...summary, externalSessionId: "fork-1" }),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () =>
          Effect.scoped(taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task")).pipe(
            Effect.either,
            Effect.tap((result) =>
              Effect.sync(() => {
                resetWasBlocked = result._tag === "Left";
              }),
            ),
            Effect.as(true),
          ),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected stored model update"),
      },
      taskLifecycle,
    });

    await Effect.runPromise(
      service.forkSession({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        parentExternalSessionId: "session-1",
        sessionScope: workflowStart.sessionScope,
        systemPrompt: "Fork it",
        model: workflowStart.model,
      }),
    );

    expect(resetWasBlocked).toBe(true);
  });

  test("holds the task lifecycle gate until the model record is stored", async () => {
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    let resetWasBlocked = false;
    const service = createTaskWorkflowSessionControlService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () =>
          Effect.scoped(taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task")).pipe(
            Effect.either,
            Effect.tap((result) =>
              Effect.sync(() => {
                resetWasBlocked = result._tag === "Left";
              }),
            ),
            Effect.asVoid,
          ),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.dieMessage("unexpected store"),
        agentSessionUpdateModel: () => Effect.succeed(true),
      },
      taskLifecycle,
    });

    await Effect.runPromise(
      service.updateSessionModel({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
        sessionScope: workflowStart.sessionScope,
        model: { providerId: "openai", modelId: "gpt-5.1" },
      }),
    );

    expect(resetWasBlocked).toBe(true);
  });
});
