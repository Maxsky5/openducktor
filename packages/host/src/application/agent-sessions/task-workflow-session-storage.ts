import type {
  AgentRole,
  AgentSessionLiveRef,
  AgentSessionControlStopInput,
  AgentSessionControlSummary,
  AgentSessionRecord,
  AgentSessionWorkflowScope,
  AgentTranscriptModelSelection,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { TaskSessionOwnershipCommittedError } from "./task-session-ownership-error";
import {
  HostValidationError,
  type HostError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { TaskService } from "../tasks/task-service";

type WorkflowSessionInput = {
  repoPath: string;
  sessionScope: AgentSessionWorkflowScope;
  model: AgentTranscriptModelSelection | undefined;
  selectedModel: AgentSessionRecord["selectedModel"] | undefined;
  summary: AgentSessionControlSummary;
};

export const toControlSessionRef = (
  repoPath: string,
  summary: AgentSessionControlSummary,
): AgentSessionControlStopInput => ({
  repoPath,
  runtimeKind: summary.runtimeKind,
  workingDirectory: summary.workingDirectory,
  externalSessionId: summary.externalSessionId,
});

export const storeWorkflowSession = <Saved, Failure>(
  save: (input: Parameters<TaskService["agentSessionUpsert"]>[0]) => Effect.Effect<Saved, Failure>,
  input: WorkflowSessionInput,
): Effect.Effect<Saved, HostError> =>
  save(workflowSessionRecord(input)).pipe(
    Effect.mapError((cause) =>
      cause instanceof TaskSessionOwnershipCommittedError
        ? cause
        : toHostOperationError(cause, "task-workflow-session.create", {
            repoPath: input.repoPath,
            taskId: input.sessionScope.taskId,
          }),
    ),
  );

export const findWorkflowSession = (
  records: readonly AgentSessionRecord[],
  role: AgentRole,
  ref: Pick<AgentSessionRecord, "externalSessionId" | "runtimeKind" | "workingDirectory">,
): AgentSessionRecord | undefined =>
  records.find(
    (record) =>
      record.role === role &&
      record.externalSessionId === ref.externalSessionId &&
      record.runtimeKind === ref.runtimeKind &&
      record.workingDirectory === ref.workingDirectory,
  );

export const readStoredWorkflowSession = (
  tasks: Pick<TaskService, "agentSessionsList">,
  input: AgentSessionLiveRef & { sessionScope: AgentSessionWorkflowScope },
  operation: "read-fork" | "read-resume" | "send" | "update-model",
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
      const stored = findWorkflowSession(sessions, scope.role, input);
      return stored
        ? Effect.succeed(stored)
        : Effect.fail(
            new HostValidationError({
              field: "externalSessionId",
              message: `Task '${scope.taskId}' does not own session '${input.externalSessionId}' for role '${scope.role}'.`,
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

const workflowSessionRecord = (input: WorkflowSessionInput) => ({
  repoPath: input.repoPath,
  taskId: input.sessionScope.taskId,
  session: {
    externalSessionId: input.summary.externalSessionId,
    role: input.sessionScope.role,
    startedAt: input.summary.startedAt,
    runtimeKind: input.summary.runtimeKind,
    workingDirectory: input.summary.workingDirectory,
    selectedModel: input.model
      ? { ...input.model, runtimeKind: input.summary.runtimeKind }
      : (input.selectedModel ?? null),
  },
});
