import type {
  AgentSessionControlForkInput,
  AgentSessionControlResumeInput,
  AgentSessionControlStartInput,
  AgentSessionControlStopInput,
  AgentSessionControlSummary,
  AgentSessionRecord,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { TaskService } from "../tasks/task-service";
import {
  type HostError,
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";

type RuntimeControl = Pick<
  AgentSessionLiveStateService,
  | "startSession"
  | "resumeSession"
  | "forkSession"
  | "updateSessionModel"
  | "stopSession"
  | "releaseSession"
  | "publishSession"
>;

type TaskSessions = Pick<
  TaskService,
  "agentSessionsList" | "agentSessionUpsert" | "agentSessionUpdateModel"
>;

type ControlledLaunchInput =
  | AgentSessionControlStartInput
  | AgentSessionControlResumeInput
  | AgentSessionControlForkInput;

const storeWorkflowSession = (
  tasks: TaskSessions,
  input: ControlledLaunchInput,
  summary: AgentSessionControlSummary,
  selectedModel: AgentSessionRecord["selectedModel"] = null,
) => {
  if (input.sessionScope.kind !== "workflow") {
    return Effect.void;
  }
  const scope = input.sessionScope;
  return tasks
    .agentSessionUpsert({
      repoPath: input.repoPath,
      taskId: scope.taskId,
      session: {
        externalSessionId: summary.externalSessionId,
        role: scope.role,
        startedAt: summary.startedAt,
        runtimeKind: summary.runtimeKind,
        workingDirectory: summary.workingDirectory,
        selectedModel: input.model
          ? { ...input.model, runtimeKind: summary.runtimeKind }
          : selectedModel,
      },
    })
    .pipe(
      Effect.asVoid,
      Effect.mapError((cause) =>
        toHostOperationError(cause, "task-workflow-session.create", {
          repoPath: input.repoPath,
          taskId: scope.taskId,
        }),
      ),
    );
};

const readStoredResumeSession = (
  tasks: TaskSessions,
  input: AgentSessionControlResumeInput,
): Effect.Effect<AgentSessionRecord | null, HostError> => {
  if (input.sessionScope.kind !== "workflow") {
    return Effect.succeed(null);
  }
  const scope = input.sessionScope;
  return tasks.agentSessionsList({ repoPath: input.repoPath, taskId: scope.taskId }).pipe(
    Effect.mapError((cause) =>
      toHostOperationError(cause, "task-workflow-session.read-resume", {
        repoPath: input.repoPath,
        taskId: scope.taskId,
        externalSessionId: input.externalSessionId,
      }),
    ),
    Effect.flatMap((sessions) => {
      const stored = sessions.find(
        (session) =>
          session.externalSessionId === input.externalSessionId &&
          session.runtimeKind === input.runtimeKind &&
          session.workingDirectory === input.workingDirectory,
      );
      return stored
        ? Effect.succeed(stored)
        : Effect.fail(
            new HostValidationError({
              field: "externalSessionId",
              message: `Task '${scope.taskId}' does not own session '${input.externalSessionId}'.`,
              details: {
                repoPath: input.repoPath,
                taskId: scope.taskId,
                externalSessionId: input.externalSessionId,
              },
            }),
          );
    }),
  );
};

const controlSessionRef = (
  repoPath: string,
  summary: AgentSessionControlSummary,
): AgentSessionControlStopInput => ({
  repoPath,
  runtimeKind: summary.runtimeKind,
  workingDirectory: summary.workingDirectory,
  externalSessionId: summary.externalSessionId,
});

const storeControlResult = (
  tasks: TaskSessions,
  runtime: RuntimeControl,
  input: ControlledLaunchInput,
  summary: AgentSessionControlSummary,
  cleanup: "release" | "stop",
  selectedModel?: AgentSessionRecord["selectedModel"],
) =>
  Effect.gen(function* () {
    const stored = yield* Effect.either(storeWorkflowSession(tasks, input, summary, selectedModel));
    if (stored._tag === "Right") {
      if (input.sessionScope.kind === "workflow") {
        yield* runtime.publishSession(controlSessionRef(input.repoPath, summary));
      }
      return summary;
    }
    const ref = controlSessionRef(input.repoPath, summary);
    const cleaned = yield* Effect.either(
      cleanup === "release" ? runtime.releaseSession(ref) : runtime.stopSession(ref),
    );
    if (cleaned._tag === "Left") {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "task-workflow-session.store-control-result",
          message: `${stored.left.message} Cleanup failed: ${cleaned.left.message}`,
          cause: { storeFailure: stored.left, cleanupFailure: cleaned.left },
          details: {
            repoPath: input.repoPath,
            externalSessionId: summary.externalSessionId,
            storeFailure: stored.left,
            cleanupFailure: cleaned.left,
          },
        }),
      );
    }
    return yield* Effect.fail(stored.left);
  });

export const createTaskWorkflowSessionControlService = ({
  runtime,
  tasks,
}: {
  runtime: RuntimeControl;
  tasks: TaskSessions;
}): RuntimeControl => ({
  ...runtime,
  startSession: (input) =>
    Effect.gen(function* () {
      const summary = yield* runtime.startSession(input);
      return yield* storeControlResult(tasks, runtime, input, summary, "stop");
    }),
  resumeSession: (input) =>
    Effect.gen(function* () {
      const storedSession = yield* readStoredResumeSession(tasks, input);
      const summary = yield* runtime.resumeSession(input);
      return yield* storeControlResult(
        tasks,
        runtime,
        input,
        summary,
        "release",
        storedSession?.selectedModel,
      );
    }),
  forkSession: (input) =>
    Effect.gen(function* () {
      const summary = yield* runtime.forkSession(input);
      return yield* storeControlResult(tasks, runtime, input, summary, "stop");
    }),
  updateSessionModel: (input) =>
    Effect.gen(function* () {
      yield* runtime.updateSessionModel(input);
      if (input.sessionScope.kind !== "workflow") {
        return;
      }
      const scope = input.sessionScope;
      yield* tasks
        .agentSessionUpdateModel({
          repoPath: input.repoPath,
          taskId: scope.taskId,
          identity: {
            externalSessionId: input.externalSessionId,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
          },
          selectedModel: input.model ? { ...input.model, runtimeKind: input.runtimeKind } : null,
        })
        .pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            toHostOperationError(cause, "task-workflow-session.update-model", {
              repoPath: input.repoPath,
              taskId: scope.taskId,
              externalSessionId: input.externalSessionId,
            }),
          ),
        );
    }),
});
