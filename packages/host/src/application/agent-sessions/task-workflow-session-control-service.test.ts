import { describe, expect, test } from "bun:test";
import type {
  AgentSessionControlStartInput,
  AgentSessionControlSummary,
  AgentSessionRecord,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
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

describe("createTaskWorkflowSessionControlService", () => {
  test("stores a workflow session only from its runtime control result", async () => {
    const calls: string[] = [];
    const stored: Array<{ repoPath: string; taskId: string; session: AgentSessionRecord }> = [];
    const service = createTaskWorkflowSessionControlService({
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
      runtime: {
        startSession: () => Effect.succeed(summary),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        updateSessionModel: () => Effect.dieMessage("unexpected model update"),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
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
        model: workflowStart.model,
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
  });

  test("stops a new runtime session when its task record cannot be stored", async () => {
    const stopped: string[] = [];
    const service = createTaskWorkflowSessionControlService({
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
    const storedModels: unknown[] = [];
    const service = createTaskWorkflowSessionControlService({
      runtime: {
        startSession: () => Effect.dieMessage("unexpected start"),
        resumeSession: () => Effect.dieMessage("unexpected resume"),
        forkSession: () => Effect.dieMessage("unexpected fork"),
        updateSessionModel: () =>
          Effect.sync(() => {
            calls.push("runtime");
          }),
        stopSession: () => Effect.dieMessage("unexpected stop"),
        releaseSession: () => Effect.dieMessage("unexpected release"),
      },
      tasks: {
        agentSessionUpsert: () => Effect.dieMessage("unexpected store"),
        agentSessionUpdateModel: (input) =>
          Effect.sync(() => {
            calls.push("store");
            storedModels.push(input);
            return true;
          }),
      },
    });

    await Effect.runPromise(
      service.updateSessionModel({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
        sessionScope: workflowStart.sessionScope,
        model: workflowStart.model ?? null,
      }),
    );

    expect(calls).toEqual(["runtime", "store"]);
    expect(storedModels).toEqual([
      {
        repoPath: "/repo",
        taskId: "task-1",
        identity: {
          externalSessionId: "session-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
        selectedModel: workflowStart.model,
      },
    ]);
  });
});
