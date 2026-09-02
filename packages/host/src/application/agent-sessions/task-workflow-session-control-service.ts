import type {
  AgentSessionControlForkInput,
  AgentSessionControlResumeInput,
  AgentSessionControlStartInput,
  AgentSessionControlStopInput,
  AgentSessionControlSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { TaskService } from "../tasks/task-service";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";

type RuntimeControl = Pick<
  AgentSessionLiveStateService,
  | "startSession"
  | "resumeSession"
  | "forkSession"
  | "updateSessionModel"
  | "stopSession"
  | "releaseSession"
>;

type TaskSessions = Pick<TaskService, "agentSessionUpsert" | "agentSessionUpdateModel">;

type ControlledLaunchInput =
  | AgentSessionControlStartInput
  | AgentSessionControlResumeInput
  | AgentSessionControlForkInput;

const storeWorkflowSession = (
  tasks: TaskSessions,
  input: ControlledLaunchInput,
  summary: AgentSessionControlSummary,
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
        selectedModel: input.model ? { ...input.model, runtimeKind: summary.runtimeKind } : null,
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
) =>
  Effect.gen(function* () {
    const stored = yield* Effect.either(storeWorkflowSession(tasks, input, summary));
    if (stored._tag === "Right") {
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
      const summary = yield* runtime.resumeSession(input);
      return yield* storeControlResult(tasks, runtime, input, summary, "release");
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
