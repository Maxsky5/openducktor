import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { describe, expect, test } from "bun:test";
import type {
  AcceptedAgentUserMessage,
  AgentSessionControlSendInput,
  AgentSessionControlSummary,
  AgentSessionControlUpdateModelInput,
  AgentSessionRecord,
  AgentWorkflowSessionStartInput,
  AgentSessionControlForkInput,
  TaskCard,
} from "@openducktor/contracts";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { z } from "zod";
import { HostOperationError } from "../../effect/host-errors";
import { createTaskStoreTestDouble } from "../../test-support/task-store-test-double";
import {
  createBuildSettingsConfig,
  createBuildStartGitPort,
  createBuildStartRuntimeRegistry,
  createBuildStartWorktreeFiles,
  createBuildWorkspaceSettingsService,
  createBuildWorktreeActions,
  createRuntimeDefinitionsService,
  task as harnessTask,
} from "../tasks/test-support/task-workflow-harness";
import { createTaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import { createTaskSessionStartPreparationService } from "../tasks/worktrees/task-session-start-preparation-service";
import { createTaskWorkflowSessionFork } from "./task-workflow-session-fork";
import { createTaskSessionOperations } from "./task-session-operations";
import { createAgentSessionCommandService as createControlService } from "./agent-session-command-service";

type ControlServiceInput = Parameters<typeof createControlService>[0];
type TestControlServiceInput = Omit<
  ControlServiceInput,
  | "taskSessionStart"
  | "tasks"
  | "repositoryPolicy"
  | "persistTaskModel"
  | "runtime"
  | "pauseForStop"
  | "turnPreparation"
  | "readSessionRootRefs"
  | "approvalPolicy"
  | "taskWorkflows"
> & {
  runtime: Omit<
    ControlServiceInput["runtime"],
    | "loadContext"
    | "loadSessionDiff"
    | "replyApproval"
    | "replyQuestion"
    | "read"
    | "list"
    | "publishOperation"
    | "retainOperation"
  > &
    Partial<Pick<ControlServiceInput["runtime"], "read">>;
  taskSessionStart?: ControlServiceInput["taskSessionStart"];
  tasks: Omit<ControlServiceInput["tasks"], "applyStartEvent"> &
    Partial<Pick<ControlServiceInput["tasks"], "applyStartEvent">>;
  recordAcceptedMessage?: ControlServiceInput["repositoryPolicy"]["recordAcceptedMessage"];
  pauseForStop?: ControlServiceInput["pauseForStop"];
};

const createAgentSessionCommandService = ({
  recordAcceptedMessage = () => Effect.void,
  pauseForStop = () => Effect.void,
  ...input
}: TestControlServiceInput) =>
  createControlService({
    taskWorkflows: builtinTaskWorkflows,
    pauseForStop,
    turnPreparation: {
      context: () => Effect.succeed("Current host context"),
      promptOverrides: () => Effect.succeed({}),
      model: (_target, selection) => Effect.succeed(selection),
    },
    approvalPolicy: { reply: () => Effect.die(new Error("unexpected approval reply")) },
    readSessionRootRefs: (repoPath) =>
      input.tasks.agentSessionsList({ repoPath, taskId: "task-1" }).pipe(
        Effect.map((records) =>
          records.map((record) => ({
            repoPath,
            ...record,
            sessionScope: { kind: "workflow" as const, taskId: "task-1", role: record.role },
          })),
        ),
        Effect.mapError(
          (cause) =>
            new HostOperationError({ operation: "test.read-roots", message: cause.message }),
        ),
      ),
    taskSessionStart: {
      prepare: () => Effect.die(new Error("unexpected task session preparation")),
      complete: () => Effect.die(new Error("unexpected task session completion")),
    },
    ...input,
    runtime: {
      read: (ref) =>
        Effect.succeed({
          type: "live" as const,
          session: {
            ref,
            title: "Session",
            startedAt: "2026-10-13T12:00:00Z",
            activity: "idle" as const,
            pendingApprovals: [],
            pendingQuestions: [],
            contextUsage: null,
          },
        }),
      list: () => Effect.succeed([]),
      publishOperation: () => Effect.void,
      retainOperation: () => Effect.void,
      loadContext: () => Effect.die(new Error("unexpected context read")),
      loadSessionDiff: () => Effect.die(new Error("unexpected diff read")),
      replyApproval: () => Effect.die(new Error("unexpected approval reply")),
      replyQuestion: () => Effect.die(new Error("unexpected question reply")),
      ...input.runtime,
    },
    repositoryPolicy: {
      run: (_ref, _operation, effect) => effect,
      runSend: (_ref, effect) => effect,
      validateRef: () => Effect.void,
      prepareResume: (request) => Effect.succeed({ input: request, save: () => Effect.void }),
      prepareForkSource: () => Effect.die(new Error("unexpected fork source read")),
      prepareSend: (request) => Effect.succeed(request),
      recordAcceptedMessage,
      prepareModelUpdate: (request) =>
        Effect.succeed({ input: request, previousModel: null, save: Effect.succeed(Effect.void) }),
    },
    persistTaskModel: (request) =>
      input.tasks.agentSessionUpdateModel(request).pipe(
        Effect.mapError((cause) =>
          cause instanceof HostOperationError
            ? cause
            : new HostOperationError({
                operation: "test.update-model",
                message: cause.message,
                cause,
              }),
        ),
        Effect.map((updated) => ({ updated, publish: Effect.void })),
      ),
    tasks: {
      applyStartEvent: () => Effect.die(new Error("unexpected task transition")),
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
  availableActions: [],
  labels: [],
  artifactSummary: {
    spec: { present: false },
    plan: { present: false },
    qaReport: { present: false },
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
    build: {
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
  delivery: "new_turn",
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

const unexpectedSend = () => Effect.die(new Error("unexpected send"));

type ControlDeps = Parameters<typeof createAgentSessionCommandService>[0];

const createModelUpdateService = ({
  selectedModel = storedModel,
  runtimeKind = "opencode",
  updateRuntimeModel,
  updateStoredModel,
}: {
  selectedModel?: AgentSessionRecord["selectedModel"];
  runtimeKind?: AgentSessionRecord["runtimeKind"];
  updateRuntimeModel: ControlDeps["runtime"]["updateSessionModel"];
  updateStoredModel: ControlDeps["tasks"]["agentSessionUpdateModel"];
}) =>
  createAgentSessionCommandService({
    ...createControlDeps(),
    runtime: {
      startSession: () => Effect.die(new Error("unexpected start")),
      resumeSession: () => Effect.die(new Error("unexpected resume")),
      continueInterruptedTurn: () => Effect.die(new Error("unexpected continue interrupted turn")),
      forkSession: () => Effect.die(new Error("unexpected fork")),
      sendUserMessage: unexpectedSend,
      updateSessionModel: updateRuntimeModel,
      stopSession: () => Effect.die(new Error("unexpected stop")),
      releaseSession: () => Effect.die(new Error("unexpected release")),
    },
    tasks: {
      agentSessionsList: () =>
        Effect.succeed([{ ...summary, runtimeKind, role: "build", selectedModel }]),
      agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
      agentSessionUpdateModel: updateStoredModel,
    },
  });

const createReplyForkHarness = (
  role: string,
  failure?: "save" | "save_clean" | "save_defect" | "stop_defect" | "publish" | "publish_defect",
) => {
  const calls: string[] = [];
  const requests: AgentSessionControlForkInput[] = [];
  const records: AgentSessionRecord[] = [];
  const selectedModel = { ...storedModel!, variant: "current-variant", speed: "fast" };
  const source = { ...summary, role, selectedModel };
  const deps = {
    ...createControlDeps(),
    taskReader: { getTask: () => Effect.succeed(task("closed")) },
  };
  const fail = (message: string) =>
    Effect.fail(new HostOperationError({ operation: "test.fork", message }));
  const runtime: TestControlServiceInput["runtime"] = {
    startSession: unexpectedSend,
    resumeSession: unexpectedSend,
    continueInterruptedTurn: unexpectedSend,
    forkSession: (request) =>
      Effect.sync(() => {
        calls.push("native-fork");
        requests.push(request);
        return { ...summary, externalSessionId: "fork-1" };
      }),
    sendUserMessage: unexpectedSend,
    updateSessionModel: unexpectedSend,
    stopSession: (ref) =>
      Effect.sync(() => {
        calls.push(`stop:${ref.externalSessionId}`);
      }).pipe(
        Effect.andThen(
          failure === "save"
            ? fail("stop failed")
            : failure === "stop_defect"
              ? Effect.die(new Error("stop defect"))
              : Effect.void,
        ),
      ),
    releaseSession: (ref) =>
      Effect.sync(() => {
        calls.push(`release:${ref.externalSessionId}`);
      }),
    read: (ref) =>
      Effect.succeed({
        type: "live",
        session: {
          ref,
          title: "Running source",
          startedAt: summary.startedAt,
          activity: "running",
          pendingApprovals: [],
          pendingQuestions: [],
          contextUsage: null,
        },
      }),
  };
  const tasks = {
    agentSessionsList: () => Effect.succeed([source]),
    agentSessionUpsert: unexpectedSend,
    agentSessionUpdateModel: unexpectedSend,
    applyStartEvent: unexpectedSend,
  };
  const commands = createAgentSessionCommandService({
    ...deps,
    runtime,
    tasks,
  });
  const sessions = createTaskSessionOperations({
    taskWorkflows: builtinTaskWorkflows,
    ...deps,
    tasks,
    runtime: { ...runtime, ...commands.prepareSessionCreation },
    taskSessionStart: { prepare: unexpectedSend, complete: unexpectedSend },
    writes: {
      saveSession: (input) =>
        Effect.suspend(() => {
          calls.push("save");
          if (failure === "save_defect") return Effect.die(new Error("store defect"));
          if (failure === "save" || failure === "save_clean" || failure === "stop_defect")
            return fail("store failed");
          records.push(input.session);
          return Effect.succeed({
            publish:
              failure === "publish"
                ? fail("event bus unavailable")
                : failure === "publish_defect"
                  ? Effect.die(new Error("event callback failed"))
                  : Effect.void,
          });
        }),
      applyStartEvent: unexpectedSend,
    },
  });
  return {
    calls,
    requests,
    records,
    source,
    fork: createTaskWorkflowSessionFork({
      runtimeAdmission: { admit: (_kind, work) => work },
      commands,
      sessions,
      stop: runtime.stopSession,
    }),
  };
};

describe("createAgentSessionCommandService", () => {
  test.each(["spec", "planner", "build", "qa"] as const)(
    "forks a completed reply for %s with current settings and no task transition",
    async (role) => {
      const h = createReplyForkHarness(role);
      const result = await Effect.runPromise(
        h.fork({
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
          sessionScope: { kind: "workflow", taskId: "task-1", role },
          forkPoint: { messageId: "completed-reply" },
        }),
      );
      expect(h.calls).toEqual(["native-fork", "save"]);
      expect(h.requests[0]).toMatchObject({
        parentExternalSessionId: "session-1",
        sourceWorkingDirectory: "/repo/worktree",
        workingDirectory: "/repo/worktree",
        model: h.source.selectedModel,
        systemPrompt: "Current host context",
        forkPoint: { messageId: "completed-reply" },
        sessionScope: { kind: "workflow", taskId: "task-1", role },
      });
      expect(result.record).toEqual(h.records[0]!);
      expect(result.record).toMatchObject({
        externalSessionId: "fork-1",
        role,
        selectedModel: h.source.selectedModel,
      });
      expect(result.runtimeSession.status).toBe("idle");
    },
  );

  test.each(["publish", "publish_defect"] as const)(
    "returns the saved task fork when publication fails: %s",
    async (failure) => {
      const h = createReplyForkHarness("build", failure);
      const result = await Effect.runPromise(
        h.fork({
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          forkPoint: { messageId: "completed-reply" },
        }),
      );
      expect(result).toMatchObject({
        record: { externalSessionId: "fork-1" },
        syncWarning: expect.stringContaining("fork was saved"),
      });
      expect(h.calls).toEqual(["native-fork", "save"]);
      expect(h.records).toHaveLength(1);
    },
  );

  test.each(["save", "save_clean", "save_defect", "stop_defect"] as const)(
    "reports retained native history after a reply fork save failure: %s",
    async (failure) => {
      const h = createReplyForkHarness("build", failure);
      const result = await Effect.runPromise(
        Effect.result(
          h.fork({
            repoPath: "/repo",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktree",
            externalSessionId: "session-1",
            sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
            forkPoint: { messageId: "completed-reply" },
          }),
        ),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.message).toContain(
          failure === "save_defect" ? "store defect" : "store failed",
        );
        expect(result.failure.message).toContain(
          "Native history for runtime session 'fork-1' can remain.",
        );
        if (failure === "save") expect(result.failure.message).toContain("stop failed");
        if (failure === "stop_defect") expect(result.failure.message).toContain("stop defect");
      }
      expect(h.calls).toEqual(["native-fork", "save", "stop:fork-1", "release:fork-1"]);
      expect(h.records).toEqual([]);
    },
  );

  test("rejects workflow startup while direct merge runs", async () => {
    const deps = createControlDeps();
    const service = createAgentSessionCommandService({
      ...deps,
      runtime: {
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.die(new Error("unexpected list")),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected model store")),
      },
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* deps.taskLifecycle.acquireLifecycle("/repo", ["task-1"], "direct merge");
          const result = yield* Effect.result(service.startWorkflowSession(workflowStart));
          expect(result).toMatchObject({
            _tag: "Failure",
            failure: { operation: "task.start session.lifecycle_guard" },
          });
        }),
      ),
    );
  });

  test.each([
    { step: "runtime", stopFails: false, storeFails: false },
    { step: "runtime", stopFails: true, storeFails: false },
    { step: "store", stopFails: false, storeFails: false },
    { step: "store", stopFails: true, storeFails: false },
    { step: "store", stopFails: false, storeFails: true },
  ])(
    "finishes admitted startup after the caller leaves: %j",
    async ({ step, stopFails, storeFails }) => {
      const calls: string[] = [];
      const created = await Effect.runPromise(Deferred.make<void>());
      const returnSummary = await Effect.runPromise(Deferred.make<void>());
      const preparedTask = task("ready_for_dev");
      const deps = createControlDeps();
      const service = createAgentSessionCommandService({
        ...deps,
        taskSessionStart: {
          prepare: () =>
            Effect.succeed({
              canonicalRepoPath: "/repo",
              rollback: () =>
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
          complete: () => Effect.die(new Error("unexpected completion")),
        },
        runtime: {
          startSession: () =>
            Effect.gen(function* () {
              calls.push("runtime-created");
              if (step === "runtime") {
                yield* Deferred.succeed(created, undefined);
                yield* Deferred.await(returnSummary);
              }
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
          resumeSession: () => Effect.die(new Error("unexpected resume")),
          continueInterruptedTurn: () =>
            Effect.die(new Error("unexpected continue interrupted turn")),
          forkSession: () => Effect.die(new Error("unexpected fork")),
          sendUserMessage: unexpectedSend,
          updateSessionModel: () => Effect.die(new Error("unexpected model update")),
          releaseSession: () =>
            Effect.sync(() => {
              calls.push("release-runtime");
            }),
        },
        tasks: {
          agentSessionsList: () => Effect.die(new Error("unexpected list")),
          agentSessionUpsert: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(created, undefined);
              yield* Deferred.await(returnSummary);
              if (storeFails) {
                calls.push("store-failed");
                return yield* Effect.fail(
                  new HostOperationError({ operation: "test.store", message: "store failed" }),
                );
              }
              calls.push("store-committed");
              return true;
            }),
          agentSessionUpdateModel: () => Effect.die(new Error("unexpected model store")),
        },
      });
      const fiber = Effect.runFork(service.startWorkflowSession(workflowStart));
      try {
        await Effect.runPromise(Deferred.await(created));
        fiber.interruptUnsafe();
        await Effect.runPromise(Deferred.succeed(returnSummary, undefined));
        expect(Exit.isFailure(await Effect.runPromise(Fiber.await(fiber)))).toBe(true);
        const expected = ["runtime-created", "runtime-returned"];
        expected.push(storeFails ? "store-failed" : "store-committed");
        if (storeFails) {
          expected.push("stop-runtime");
          if (!stopFails) expected.push("release-runtime", "cleanup-worktree");
        }
        expect(calls).toEqual(expected);
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
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      taskLifecycle,
      taskSessionStart: {
        prepare: () =>
          Effect.sync(() => {
            calls.push("prepare");
            return {
              canonicalRepoPath: "/repo",
              rollback: () => Effect.void,
              preparedStatus: preparedTask.status,
              role: "build" as const,
              runtimeKind: "opencode" as const,
              task: preparedTask,
              workingDirectory: "/repo/worktree",
            };
          }),
        complete: (_prepared, applyStartEvent) =>
          Effect.gen(function* () {
            calls.push("complete");
            yield* applyStartEvent({
              repoPath: "/repo",
              taskId: "task-1",
              eventId: "start-builder",
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
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.die(new Error("unexpected list")),
        agentSessionUpsert: () =>
          Effect.gen(function* () {
            calls.push("store");
            const overlap = yield* Effect.result(
              Effect.scoped(taskLifecycle.acquireLifecycle("/repo", ["task-1"], "close task")),
            );
            expect(overlap._tag).toBe("Failure");
            return true;
          }),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected model store")),
        applyStartEvent: () =>
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

  test.each([false, true])(
    "cleans an unsaved start before rollback, release failure: %s",
    async (releaseFails) => {
      const calls: string[] = [];
      const preparedTask = task("ready_for_dev");
      const service = createAgentSessionCommandService({
        ...createControlDeps(),
        taskSessionStart: {
          prepare: () =>
            Effect.succeed({
              canonicalRepoPath: "/repo",
              rollback: () =>
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
          complete: () => Effect.die(new Error("unexpected completion")),
        },
        runtime: {
          startSession: () => Effect.succeed(summary),
          resumeSession: () => Effect.die(new Error("unexpected resume")),
          continueInterruptedTurn: () =>
            Effect.die(new Error("unexpected continue interrupted turn")),
          forkSession: () => Effect.die(new Error("unexpected fork")),
          sendUserMessage: unexpectedSend,
          updateSessionModel: () => Effect.die(new Error("unexpected model update")),
          stopSession: () => Effect.sync(() => calls.push("stop-runtime")),
          releaseSession: () =>
            Effect.sync(() => {
              calls.push("release-runtime");
            }).pipe(
              Effect.andThen(
                releaseFails
                  ? Effect.fail(
                      new HostOperationError({
                        operation: "test.release",
                        message: "release failed",
                      }),
                    )
                  : Effect.void,
              ),
            ),
        },
        tasks: {
          agentSessionsList: () => Effect.die(new Error("unexpected list")),
          agentSessionUpsert: () =>
            Effect.fail(
              new HostOperationError({ operation: "test.store", message: "store failed" }),
            ),
          agentSessionUpdateModel: () => Effect.die(new Error("unexpected model store")),
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
      ).rejects.toThrow(
        releaseFails ? "store failed Cleanup failed: release failed" : "store failed",
      );
      expect(calls).toEqual([
        "stop-runtime",
        "release-runtime",
        ...(releaseFails ? [] : ["cleanup-worktree"]),
      ]);
    },
  );

  test.each(["none", "stop", "release"] as const)(
    "releases only the unsaved fork, cleanup failure: %s",
    async (cleanupFailure) => {
      const calls: string[] = [];
      const service = createAgentSessionCommandService({
        ...createControlDeps(),
        runtime: {
          startSession: () => Effect.die(new Error("unexpected start")),
          resumeSession: () => Effect.die(new Error("unexpected resume")),
          continueInterruptedTurn: () => Effect.die(new Error("unexpected continuation")),
          forkSession: () => Effect.succeed({ ...summary, externalSessionId: "fork-1" }),
          sendUserMessage: unexpectedSend,
          updateSessionModel: () => Effect.die(new Error("unexpected model update")),
          stopSession: (ref) =>
            Effect.sync(() => {
              calls.push(`stop:${ref.externalSessionId}`);
            }).pipe(
              Effect.andThen(
                cleanupFailure === "stop"
                  ? Effect.fail(
                      new HostOperationError({ operation: "test.stop", message: "stop failed" }),
                    )
                  : Effect.void,
              ),
            ),
          releaseSession: (ref) =>
            Effect.sync(() => {
              calls.push(`release:${ref.externalSessionId}`);
            }).pipe(
              Effect.andThen(
                cleanupFailure === "release"
                  ? Effect.fail(
                      new HostOperationError({
                        operation: "test.release",
                        message: "release failed",
                      }),
                    )
                  : Effect.void,
              ),
            ),
        },
        tasks: {
          agentSessionsList: () =>
            Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
          agentSessionUpsert: () =>
            Effect.fail(
              new HostOperationError({ operation: "test.store", message: "store failed" }),
            ),
          agentSessionUpdateModel: () => Effect.die(new Error("unexpected model store")),
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
      ).rejects.toThrow(
        cleanupFailure === "none" ? "store failed" : `Cleanup failed: ${cleanupFailure} failed`,
      );
      expect(calls).toEqual([
        "stop:fork-1",
        ...(cleanupFailure === "stop" ? [] : ["release:fork-1"]),
      ]);
    },
  );

  test("closes worktree action terminals before it removes a new worktree when the runtime start fails", async () => {
    const calls: unknown[] = [];
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      taskLifecycle,
      taskSessionStart: createTaskSessionStartPreparationService({
        taskWorkflows: builtinTaskWorkflows,
        taskStore: createTaskStoreTestDouble({
          getTask: () => Effect.succeed(harnessTask({ status: "ready_for_dev" })),
        }),
        gitPort: createBuildStartGitPort({ calls }),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
        worktreeActions: createBuildWorktreeActions(calls),
        worktreeFiles: createBuildStartWorktreeFiles(calls),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { postComplete: [] },
        }),
        runtimeDefinitionsService: createRuntimeDefinitionsService(),
        runtimeRegistry: createBuildStartRuntimeRegistry(calls),
        taskSessionLifecycleCoordinator: taskLifecycle,
      }),
      runtime: {
        startSession: () =>
          Effect.fail(
            new HostOperationError({ operation: "test.start", message: "runtime start failed" }),
          ),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.die(new Error("unexpected list")),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected model store")),
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
    ).rejects.toThrow("runtime start failed");
    const types = calls.map(
      (call) => z.object({ type: z.string() }).safeParse(call).data?.type ?? null,
    );
    expect(types).toContain("runWorktreeActions");
    expect(types).toContain("stopWorktreeActionTerminals");
    expect(types.indexOf("stopWorktreeActionTerminals")).toBeLessThan(
      types.indexOf("removeWorktree"),
    );
    expect(calls).toContainEqual({
      type: "removeWorktree",
      repoPath: "/repo",
      worktreePath: "/worktrees/repo/task-1",
      force: true,
    });
  });

  test("keeps a new worktree when session storage and runtime stop both fail", async () => {
    const calls: string[] = [];
    const preparedTask = task("ready_for_dev");
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      taskSessionStart: {
        prepare: () =>
          Effect.succeed({
            canonicalRepoPath: "/repo",
            rollback: () =>
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
        complete: () => Effect.die(new Error("unexpected completion")),
      },
      runtime: {
        startSession: () => Effect.succeed(summary),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () =>
          Effect.sync(() => calls.push("stop-runtime")).pipe(
            Effect.andThen(
              Effect.fail(
                new HostOperationError({
                  operation: "test.stop",
                  message: "runtime stop failed",
                }),
              ),
            ),
          ),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.die(new Error("unexpected list")),
        agentSessionUpsert: () =>
          Effect.fail(new HostOperationError({ operation: "test.store", message: "store failed" })),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected model store")),
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

  test("stops Builder and publishes ownership when the issue type changes during startup", async () => {
    const calls: unknown[] = [];
    const events: string[] = [];
    const records: AgentSessionRecord[] = [];
    let currentTask = harnessTask({ status: "open", issueType: "bug" });
    const taskStore = createTaskStoreTestDouble({
      getTask: () => Effect.succeed(currentTask),
    });
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const sessions = createTaskSessionOperations({
      taskWorkflows: builtinTaskWorkflows,
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader: taskStore,
      taskLifecycle,
      taskSessionStart: createTaskSessionStartPreparationService({
        taskWorkflows: builtinTaskWorkflows,
        taskStore,
        gitPort: createBuildStartGitPort({ calls }),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
        worktreeActions: createBuildWorktreeActions(calls),
        worktreeFiles: createBuildStartWorktreeFiles(calls),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { postComplete: [] },
        }),
        runtimeDefinitionsService: createRuntimeDefinitionsService(),
        runtimeRegistry: createBuildStartRuntimeRegistry(calls),
        taskSessionLifecycleCoordinator: taskLifecycle,
      }),
      runtime: {
        startSession: () =>
          Effect.sync(() => {
            currentTask = { ...currentTask, issueType: "feature" };
            return { ...summary, workingDirectory: "/worktrees/repo/task-1" };
          }),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.die(new Error("unexpected list")),
      },
      writes: {
        saveSession: ({ session }) =>
          Effect.sync(() => {
            records.push(session);
            events.push("store-session");
            return {
              publish: Effect.sync(() => {
                events.push("publish-ownership");
              }),
            };
          }),
        applyStartEvent: () => Effect.die(new Error("unexpected task transition")),
      },
    });

    const result = await Effect.runPromiseExit(
      Effect.result(
        sessions.start(
          {
            repoPath: "/repo",
            runtimeKind: "opencode",
            sessionScope: workflowStart.sessionScope,
            systemPrompt: workflowStart.systemPrompt,
            model: workflowStart.model!,
          },
          {
            checkCanceled: () => Effect.void,
            created: () => Effect.void,
            saved: () => {},
            stop: () =>
              Effect.sync(() => {
                events.push("stop-runtime");
              }),
          },
        ),
      ),
    );
    expect(result).toMatchObject({
      _tag: "Success",
      value: {
        _tag: "Failure",
        failure: { _tag: "TaskPolicyError", code: "TASK_TRANSITION_NOT_ALLOWED" },
      },
    });
    expect(records).toMatchObject([{ externalSessionId: summary.externalSessionId }]);
    expect(events).toEqual(["store-session", "stop-runtime", "publish-ownership"]);
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "removeWorktree" }));
  });

  test("does not store a repository session", async () => {
    let storeCount = 0;
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      runtime: {
        startSession: () => Effect.succeed(summary),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.die(new Error("unexpected list")),
        agentSessionUpsert: () =>
          Effect.sync(() => {
            storeCount += 1;
            return true;
          }),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected stored model update")),
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

  test.each([
    { choice: "saved", nativeModel: undefined },
    {
      choice: "native",
      nativeModel: {
        runtimeKind: "opencode" as const,
        providerId: "openai",
        modelId: "gpt-6",
        variant: "low",
      },
    },
  ])(
    "stores controlled resume and fork results with the $choice model",
    async ({ nativeModel }) => {
      const stored: AgentSessionRecord[] = [];
      const service = createAgentSessionCommandService({
        ...createControlDeps(),
        runtime: {
          startSession: () => Effect.die(new Error("unexpected start")),
          resumeSession: (input) =>
            Effect.succeed({
              ...summary,
              externalSessionId: input.externalSessionId,
              model: nativeModel,
            }),
          continueInterruptedTurn: () =>
            Effect.die(new Error("unexpected continue interrupted turn")),
          forkSession: () => Effect.succeed({ ...summary, externalSessionId: "fork-1" }),
          sendUserMessage: unexpectedSend,
          updateSessionModel: () => Effect.die(new Error("unexpected model update")),
          stopSession: () => Effect.die(new Error("unexpected stop")),
          releaseSession: () => Effect.die(new Error("unexpected release")),
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
          agentSessionUpdateModel: () => Effect.die(new Error("unexpected stored model update")),
        },
      });

      await Effect.runPromise(
        service.resumeSession({
          resumeMode: "reattach",
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
      expect(stored[0]?.selectedModel).toEqual(nativeModel ?? storedModel);
    },
  );

  test("routes a continue-interrupted-turn resume to the runtime without storing a session", async () => {
    const continuations: unknown[] = [];
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      runtime: {
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected reattach resume")),
        continueInterruptedTurn: (input) =>
          Effect.sync(() => {
            continuations.push(input);
            return { ...summary, externalSessionId: input.externalSessionId };
          }),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build" as const, selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected stored model update")),
      },
    });

    const result = await Effect.runPromise(
      service.resumeSession({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
        sessionScope: workflowStart.sessionScope,
        resumeMode: "continue_interrupted_turn",
      }),
    );

    expect(result).toMatchObject({ externalSessionId: "session-1" });
    expect(continuations).toHaveLength(1);
    expect(continuations[0]).toMatchObject({
      repoPath: "/repo",
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
      sessionScope: workflowStart.sessionScope,
      model: storedModel,
    });
    expect(continuations[0]).not.toHaveProperty("resumeMode");
    expect(continuations[0]).not.toHaveProperty("selectedModel");
  });

  test("rejects a workflow resume when the stored role differs", async () => {
    let runtimeCalls = 0;
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      runtime: {
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return summary;
          }),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
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
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected stored model update")),
      },
    });

    await expect(
      Effect.runPromise(
        service.resumeSession({
          resumeMode: "reattach",
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
          sessionScope: workflowStart.sessionScope,
        }),
      ),
    ).rejects.toThrow("belongs to another task, role, or workspace chat");
    expect(runtimeCalls).toBe(0);
  });

  test("rejects a workflow fork when the task does not own the parent", async () => {
    let runtimeCalls = 0;
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      runtime: {
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return { ...summary, externalSessionId: "fork-1" };
          }),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.succeed([]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected stored model update")),
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
    ).rejects.toThrow("Session 'session-1' has no verified saved owner.");
    expect(runtimeCalls).toBe(0);
  });

  test("rejects a workflow fork when its role is not available", async () => {
    let runtimeCalls = 0;
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      taskReader: { getTask: () => Effect.succeed(task("closed")) },
      runtime: {
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return { ...summary, externalSessionId: "fork-1" };
          }),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected stored model update")),
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

  test("sends a workflow message with current context and no settings payload", async () => {
    const runtimeInputs: AgentSessionControlSendInput[] = [];
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: () => Effect.succeed("/repo"),
      taskReader,
      runtime: {
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: (input) =>
          Effect.sync(() => {
            runtimeInputs.push(input);
            return acceptedUserMessage;
          }),
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected stored model update")),
      },
      taskLifecycle: createTaskSessionLifecycleCoordinator(),
    });

    const { delivery: _delivery, ...content } = workflowSend;
    const prepared = await Effect.runPromise(
      service.prepareUserMessage({ ...content, repoPath: "/repo/." }),
    );
    await expect(
      Effect.runPromise(service.sendUserMessage({ ...prepared, delivery: "new_turn" })),
    ).resolves.toEqual(acceptedUserMessage);
    expect(runtimeInputs).toMatchObject([
      {
        ...workflowSend,
        repoPath: "/repo",
        systemPrompt: "Current host context",
      },
    ]);
  });

  test("keeps settings out of new turns and steering", async () => {
    const runtimeInputs: AgentSessionControlSendInput[] = [];
    let activity: "idle" | "running" = "idle";
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      runtime: {
        read: (ref) =>
          Effect.succeed({
            type: "live" as const,
            session: {
              ref,
              title: "Session",
              startedAt: "2026-10-13T12:00:00Z",
              activity,
              pendingApprovals: [],
              pendingQuestions: [],
              contextUsage: null,
            },
          }),
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: (input) =>
          Effect.sync(() => {
            runtimeInputs.push(input);
            return acceptedUserMessage;
          }),
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected stored model update")),
      },
    });

    for (const delivery of ["new_turn", "steer"] as const) {
      // Send leaves session settings with the runtime.
      await Effect.runPromise(
        service.sendUserMessage({
          ...workflowSend,
          delivery,
        }),
      );
      activity = "running";
    }

    expect(
      runtimeInputs.map((input) => [input.sessionScope.kind, input.delivery, "model" in input]),
    ).toEqual([
      ["workflow", "new_turn", false],
      ["workflow", "steer", false],
    ]);
  });

  test("pauses the message queue before it stops the session", async () => {
    const order: string[] = [];
    const service = createAgentSessionCommandService({
      pauseForStop: (ref) => Effect.sync(() => order.push(`pause:${ref.externalSessionId}`)),
      ...createControlDeps(),
      runtime: {
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: () => Effect.die(new Error("unexpected send")),
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: (input) =>
          Effect.sync(() => void order.push(`stop:${input.externalSessionId}`)),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected stored model update")),
      },
    });

    await Effect.runPromise(
      service.stopSession({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      }),
    );

    expect(order).toEqual(["pause:session-1", "stop:session-1"]);
  });

  test("rejects a workflow message when the task does not own the session", async () => {
    let runtimeCalls = 0;
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      runtime: {
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return acceptedUserMessage;
          }),
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.succeed([]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected stored model update")),
      },
    });

    await expect(Effect.runPromise(service.sendUserMessage(workflowSend))).rejects.toThrow(
      "no verified saved owner",
    );
    expect(runtimeCalls).toBe(0);
  });

  test("does not send a workflow message while another task lifecycle change runs", async () => {
    let runtimeCalls = 0;
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return acceptedUserMessage;
          }),
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected stored model update")),
      },
      taskLifecycle,
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task");
          return yield* Effect.result(service.sendUserMessage(workflowSend));
        }),
      ),
    );

    expect(result._tag).toBe("Failure");
    expect(runtimeCalls).toBe(0);
  });

  test.each([undefined, "plan"])(
    "updates a stored model after runtime acceptance, replacement profile=%s",
    async (profileId) => {
      const previousModel = { ...storedModel };
      if (profileId) previousModel.profileId = "removed";
      const model: NonNullable<AgentSessionControlUpdateModelInput["model"]> = {
        providerId: "openai",
        modelId: "gpt-5.1",
        variant: "high",
      };
      if (profileId) model.profileId = profileId;
      const calls: string[] = [];
      const runtimeInputs: unknown[] = [];
      const storedModels: unknown[] = [];
      const taskLifecycle = createTaskSessionLifecycleCoordinator();
      const service = createAgentSessionCommandService({
        canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
        taskReader,
        runtime: {
          startSession: () => Effect.die(new Error("unexpected start")),
          resumeSession: () => Effect.die(new Error("unexpected resume")),
          continueInterruptedTurn: () =>
            Effect.die(new Error("unexpected continue interrupted turn")),
          forkSession: () => Effect.die(new Error("unexpected fork")),
          sendUserMessage: unexpectedSend,
          updateSessionModel: (input) =>
            Effect.sync(() => {
              calls.push("runtime");
              runtimeInputs.push(input);
            }),
          stopSession: () => Effect.die(new Error("unexpected stop")),
          releaseSession: () => Effect.die(new Error("unexpected release")),
        },
        tasks: {
          agentSessionsList: () =>
            Effect.succeed([
              {
                ...summary,
                role: "build",
                selectedModel: previousModel,
              },
            ]),
          agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
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
          model,
        }),
      );

      expect(calls).toEqual(["runtime", "store"]);
      expect(runtimeInputs).toMatchObject([
        {
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
          sessionScope: workflowStart.sessionScope,
          model,
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
            profileId: profileId ?? "build",
          },
        },
      ]);
    },
  );

  test("stores a model switch without an undefined profile key when no profile is stored", async () => {
    const storedModels: unknown[] = [];
    const runtimeModels: unknown[] = [];
    const service = createModelUpdateService({
      runtimeKind: "codex",
      selectedModel: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-6-astra" },
      updateRuntimeModel: (input) =>
        Effect.sync(() => {
          runtimeModels.push(input.model);
        }),
      updateStoredModel: (input) =>
        Effect.sync(() => {
          storedModels.push(input.selectedModel);
          return true;
        }),
    });

    await Effect.runPromise(
      service.updateSessionModel({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
        sessionScope: workflowStart.sessionScope,
        model: { providerId: "openai", modelId: "gpt-5.6-sol" },
      }),
    );

    expect(runtimeModels).toEqual([{ providerId: "openai", modelId: "gpt-5.6-sol" }]);
    expect(storedModels).toStrictEqual([
      { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5.6-sol" },
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
        profileId: "build",
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
      { providerId: "openai", modelId: "gpt-5", profileId: "build" },
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
      Effect.result(service.updateSessionModel(workflowModelUpdate)),
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toBeInstanceOf(HostOperationError);
      expect(result.failure.message).toBe(
        "task store unavailable Runtime model restore failed: runtime restore unavailable",
      );
      expect(result.failure).toMatchObject({
        cause: { cause: { storeFailure, restoreFailure } },
        observation: { modelChange: { state: "unresolved" } },
      });
    }
  });

  test("checks workflow ownership before it changes the runtime model", async () => {
    let runtimeCalls = 0;
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
          }),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () => Effect.succeed([]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected stored model update")),
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
    ).rejects.toThrow("no verified saved owner");
    expect(runtimeCalls).toBe(0);
  });

  test("does not change a workflow model while another task lifecycle change runs", async () => {
    let runtimeCalls = 0;
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
          }),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected stored model update")),
      },
      taskLifecycle,
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task");
          return yield* Effect.result(
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

    expect(result._tag).toBe("Failure");
    expect(runtimeCalls).toBe(0);
  });

  test("does not resume a workflow session while another task lifecycle change runs", async () => {
    let runtimeCalls = 0;
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return summary;
          }),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected stored model update")),
      },
      taskLifecycle,
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task");
          return yield* Effect.result(
            service.resumeSession({
              resumeMode: "reattach",
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

    expect(result._tag).toBe("Failure");
    expect(runtimeCalls).toBe(0);
  });

  test("does not fork a workflow session while another task lifecycle change runs", async () => {
    let runtimeCalls = 0;
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () =>
          Effect.sync(() => {
            runtimeCalls += 1;
            return { ...summary, externalSessionId: "fork-1" };
          }),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected stored model update")),
      },
      taskLifecycle,
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task");
          return yield* Effect.result(
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

    expect(result._tag).toBe("Failure");
    expect(runtimeCalls).toBe(0);
  });

  test("holds the task lifecycle gate until the fork record is stored", async () => {
    const taskLifecycle = createTaskSessionLifecycleCoordinator();
    let resetWasBlocked = false;
    const service = createAgentSessionCommandService({
      ...createControlDeps(),
      runtime: {
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.succeed({ ...summary, externalSessionId: "fork-1" }),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () => Effect.die(new Error("unexpected model update")),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () =>
          Effect.scoped(taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task")).pipe(
            Effect.result,
            Effect.tap((result) =>
              Effect.sync(() => {
                resetWasBlocked = result._tag === "Failure";
              }),
            ),
            Effect.as(true),
          ),
        agentSessionUpdateModel: () => Effect.die(new Error("unexpected stored model update")),
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
    const service = createAgentSessionCommandService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      taskReader,
      runtime: {
        startSession: () => Effect.die(new Error("unexpected start")),
        resumeSession: () => Effect.die(new Error("unexpected resume")),
        continueInterruptedTurn: () =>
          Effect.die(new Error("unexpected continue interrupted turn")),
        forkSession: () => Effect.die(new Error("unexpected fork")),
        sendUserMessage: unexpectedSend,
        updateSessionModel: () =>
          Effect.scoped(taskLifecycle.acquireLifecycle("/repo", ["task-1"], "reset task")).pipe(
            Effect.result,
            Effect.tap((result) =>
              Effect.sync(() => {
                resetWasBlocked = result._tag === "Failure";
              }),
            ),
            Effect.asVoid,
          ),
        stopSession: () => Effect.die(new Error("unexpected stop")),
        releaseSession: () => Effect.die(new Error("unexpected release")),
      },
      tasks: {
        agentSessionsList: () =>
          Effect.succeed([{ ...summary, role: "build", selectedModel: storedModel }]),
        agentSessionUpsert: () => Effect.die(new Error("unexpected store")),
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
