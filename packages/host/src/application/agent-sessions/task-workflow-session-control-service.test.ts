import { describe, expect, test } from "bun:test";
import type {
  AgentSessionControlStartInput,
  AgentSessionControlSummary,
  AgentSessionRecord,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createTaskSessionBootstrapCoordinator } from "../tasks/worktrees/task-session-bootstrap-coordinator";
import { createTaskWorkflowSessionControlService } from "./task-workflow-session-control-service";

const workflowStart: AgentSessionControlStartInput = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
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

const createControlDeps = () => ({
  canonicalizeRepoPath: (repoPath: string) => Effect.succeed(repoPath),
  taskLifecycle: createTaskSessionBootstrapCoordinator(),
});

describe("createTaskWorkflowSessionControlService", () => {
  test("stores a workflow session only from its runtime control result", async () => {
    const calls: string[] = [];
    const stored: Array<{ repoPath: string; taskId: string; session: AgentSessionRecord }> = [];
    const service = createTaskWorkflowSessionControlService({
      ...createControlDeps(),
      runtime: {
        startSession: () =>
          Effect.sync(() => {
            calls.push("runtime");
            return summary;
          }),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () => Effect.dieMessage("unexpected list"),
        agentSessionUpsert: (input) =>
          Effect.sync(() => {
            calls.push("store");
            stored.push(input);
            return true;
          }),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected stored model update"),
      },
    });

    await Effect.runPromise(service.startSession(workflowStart));

    expect(calls).toEqual(["runtime", "store"]);
    expect(stored).toEqual([
      {
        repoPath: "/repo",
        taskId: "task-1",
        session: {
          externalSessionId: "session-1",
          role: "build",
          startedAt: "2026-09-02T10:00:00.000Z",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
          },
        },
      },
    ]);
  });

  test("does not store a repository session", async () => {
    let storeCount = 0;
    const service = createTaskWorkflowSessionControlService({
      ...createControlDeps(),
      runtime: {
        startSession: () => Effect.succeed(summary),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
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
        ...workflowStart,
        sessionScope: { kind: "repository" },
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
          Effect.succeed({ ...summary, externalSessionId: input.externalSessionId }),
        forkSession: () => Effect.succeed({ ...summary, externalSessionId: "fork-1" }),
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

  test("stops a new runtime session when its task record cannot be stored", async () => {
    const stopped: string[] = [];
    const service = createTaskWorkflowSessionControlService({
      ...createControlDeps(),
      runtime: {
        startSession: () => Effect.succeed(summary),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: (input) =>
          Effect.sync(() => {
            stopped.push(input.externalSessionId);
          }),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionsList: () => Effect.dieMessage("unexpected list"),
        agentSessionUpsert: () =>
          Effect.fail(
            new HostOperationError({
              operation: "task-session.store",
              message: "task store unavailable",
            }),
          ),
        agentSessionUpdateModel: () => Effect.dieMessage("unexpected stored model update"),
      },
    });

    await expect(Effect.runPromise(service.startSession(workflowStart))).rejects.toThrow(
      "task store unavailable",
    );
    expect(stopped).toEqual(["session-1"]);
  });

  test("updates a stored model only after the runtime accepts the workflow change", async () => {
    const calls: string[] = [];
    const runtimeInputs: unknown[] = [];
    const storedModels: unknown[] = [];
    const taskLifecycle = createTaskSessionBootstrapCoordinator();
    const service = createTaskWorkflowSessionControlService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
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

  test("checks workflow ownership before it changes the runtime model", async () => {
    let runtimeCalls = 0;
    const taskLifecycle = createTaskSessionBootstrapCoordinator();
    const service = createTaskWorkflowSessionControlService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
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
    ).rejects.toThrow("Task 'task-1' does not own session 'session-1'.");
    expect(runtimeCalls).toBe(0);
  });

  test("does not change a workflow model while another task lifecycle change runs", async () => {
    let runtimeCalls = 0;
    const taskLifecycle = createTaskSessionBootstrapCoordinator();
    const service = createTaskWorkflowSessionControlService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
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

  test("holds the task lifecycle gate until the model record is stored", async () => {
    const taskLifecycle = createTaskSessionBootstrapCoordinator();
    let resetWasBlocked = false;
    const service = createTaskWorkflowSessionControlService({
      canonicalizeRepoPath: (repoPath) => Effect.succeed(repoPath),
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
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
