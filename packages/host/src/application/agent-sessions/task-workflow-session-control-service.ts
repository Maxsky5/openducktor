import type {
  AgentSessionControlForkInput,
  AgentSessionControlResumeInput,
  AgentSessionControlStartInput,
  AgentSessionControlStopInput,
  AgentSessionControlSummary,
  AgentSessionLiveRef,
  AgentSessionRecord,
  AgentSessionWorkflowScope,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { TaskService } from "../tasks/task-service";
import type { TaskSessionBootstrapCoordinator } from "../tasks/worktrees/task-session-bootstrap-coordinator";
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
>;

type TaskSessions = Pick<
  TaskService,
  "agentSessionsList" | "agentSessionUpsert" | "agentSessionUpdateModel"
>;

type TaskLifecycle = Pick<TaskSessionBootstrapCoordinator, "acquireLifecycle">;
type CanonicalizeRepoPath = (repoPath: string) => Effect.Effect<string, HostError>;
type StoredWorkflowSessionRef = AgentSessionLiveRef & {
  sessionScope: AgentSessionWorkflowScope;
};

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

const readStoredWorkflowSession = (
  tasks: TaskSessions,
  input: StoredWorkflowSessionRef,
  operation: "read-resume" | "update-model",
): Effect.Effect<AgentSessionRecord, HostError> => {
  const scope = input.sessionScope;
  return tasks.agentSessionsList({ repoPath: input.repoPath, taskId: scope.taskId }).pipe(
    Effect.mapError((cause) =>
      toHostOperationError(cause, `task-workflow-session.${operation}`, {
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
  canonicalizeRepoPath,
  runtime,
  tasks,
  taskLifecycle,
}: {
  canonicalizeRepoPath: CanonicalizeRepoPath;
  runtime: RuntimeControl;
  tasks: TaskSessions;
  taskLifecycle: TaskLifecycle;
}): RuntimeControl => ({
  ...runtime,
  startSession: (input) =>
    Effect.gen(function* () {
      const summary = yield* runtime.startSession(input);
      return yield* storeControlResult(tasks, runtime, input, summary, "stop");
    }),
  resumeSession: (input) =>
    Effect.gen(function* () {
      const storedSession =
        input.sessionScope.kind === "workflow"
          ? yield* readStoredWorkflowSession(
              tasks,
              {
                repoPath: input.repoPath,
                runtimeKind: input.runtimeKind,
                workingDirectory: input.workingDirectory,
                externalSessionId: input.externalSessionId,
                sessionScope: input.sessionScope,
              },
              "read-resume",
            )
          : null;
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
  updateSessionModel: (input) => {
    if (input.sessionScope.kind !== "workflow") {
      return runtime.updateSessionModel(input);
    }
    const scope = input.sessionScope;
    return Effect.scoped(
      Effect.gen(function* () {
        const repoPath = yield* canonicalizeRepoPath(input.repoPath);
        yield* taskLifecycle.acquireLifecycle(repoPath, [scope.taskId], "change session model");
        const stored = yield* readStoredWorkflowSession(
          tasks,
          {
            repoPath,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
            externalSessionId: input.externalSessionId,
            sessionScope: scope,
          },
          "update-model",
        );
        const runtimeInput = {
          ...input,
          repoPath,
          runtimeKind: stored.runtimeKind,
          workingDirectory: stored.workingDirectory,
        };
        yield* runtime.updateSessionModel(runtimeInput);
        const profileId = stored.selectedModel?.profileId;
        const selectedModel = input.model
          ? {
              ...input.model,
              runtimeKind: stored.runtimeKind,
              profileId,
            }
          : null;
        yield* tasks
          .agentSessionUpdateModel({
            repoPath,
            taskId: scope.taskId,
            identity: {
              externalSessionId: stored.externalSessionId,
              runtimeKind: stored.runtimeKind,
              workingDirectory: stored.workingDirectory,
            },
            selectedModel,
          })
          .pipe(
            Effect.asVoid,
            Effect.mapError((cause) =>
              toHostOperationError(cause, "task-workflow-session.update-model", {
                repoPath,
                taskId: scope.taskId,
                externalSessionId: stored.externalSessionId,
              }),
            ),
          );
      }),
    );
  },
});
