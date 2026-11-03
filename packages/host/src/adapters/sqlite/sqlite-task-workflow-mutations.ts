import { workflowArtifactId } from "@openducktor/contracts";
import { eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type {
  AtomicTaskTransition,
  AtomicWorkflowArtifactWrite,
  TaskRecord,
  TaskStorePort,
  WorkflowArtifactSaveResult,
} from "../../ports/task-repository-ports";
import { getTaskRecord } from "./sqlite-task-card-read-model";
import { insertWorkflowArtifact } from "./sqlite-task-workflow-artifact-writes";
import { updateTaskStatus } from "./sqlite-task-writes";
import { commitTaskMutation } from "./sqlite-task-mutation";
import type { HostDatabaseSession } from "./sqlite-host-database-schema";
import * as settingsSchema from "./sqlite-host-settings-schema";
import { readHostAutopilotSettings } from "./sqlite-host-settings-store-reads";
import type { SqliteTaskRepositoryContextProvider } from "./sqlite-task-repository-context";

const operation = "sqliteTaskRepository.readTransitionMetadata";

/** Reads what Autopilot evaluates a status change with, in the transaction that commits it. */
const readTransitionMetadata = (session: HostDatabaseSession, workspaceId: string) =>
  Effect.gen(function* () {
    const autopilotSettings = yield* readHostAutopilotSettings(session);
    const [workspace] = yield* session.execute(
      (db) =>
        db
          .select({
            repoPath: settingsSchema.workspaces.repoPath,
            workspaceName: settingsSchema.workspaces.workspaceName,
          })
          .from(settingsSchema.workspaces)
          .where(eq(settingsSchema.workspaces.workspaceId, workspaceId)),
      operation,
    );
    // The transaction checked `open` access, so the workspace row exists.
    if (!workspace)
      return yield* new HostOperationError({
        operation,
        message: `Workspace ${workspaceId} is missing from the host database. Restart the host.`,
      });
    return { autopilotSettings, workspace };
  });

export const createSqliteTaskWorkflowMutations = ({
  contextProvider: withDatabase,
  now,
}: {
  contextProvider: SqliteTaskRepositoryContextProvider;
  now: () => Date;
}): Pick<TaskStorePort, "saveWorkflowArtifact" | "transitionTask"> => {
  return {
    saveWorkflowArtifact<E>(input: AtomicWorkflowArtifactWrite<E>) {
      return withDatabase(input, "sqliteTaskRepository.saveWorkflowArtifact", (context) =>
        commitTaskMutation<Result.Result<WorkflowArtifactSaveResult, E>, unknown>(
          context,
          "sqliteTaskRepository.saveWorkflowArtifact",
          (session) =>
            Effect.gen(function* () {
              const current = yield* getTaskRecord(
                session,
                context.workspaceId,
                input.taskId,
                input.repoPath,
                context.taskWorkflows,
              );
              const decision = input.decide(current);
              if (decision._tag === "Failure") return { value: Result.fail(decision.failure) };
              const workflow = context.taskWorkflows.forTask(current);
              const declared = workflow.artifact(input.code);
              if (!declared)
                return yield* new HostValidationError({
                  field: "code",
                  message: `Task workflow "${workflow.definition.id}" has no workflow artifact ${input.code}.`,
                  details: { code: input.code },
                });
              const updatedAt = now();
              if (decision.success.status !== current.status)
                yield* updateTaskStatus(session, context.workspaceId, {
                  taskId: input.taskId,
                  status: decision.success.status,
                  updatedAt,
                });
              const artifact = yield* insertWorkflowArtifact(session, context.workspaceId, {
                ...input,
                name: declared.label,
                updatedAt,
              });
              const task = yield* getTaskRecord(
                session,
                context.workspaceId,
                input.taskId,
                input.repoPath,
                context.taskWorkflows,
              );
              const metadata = yield* readTransitionMetadata(session, context.workspaceId);
              return {
                value: Result.succeed<WorkflowArtifactSaveResult>({ task, artifact }),
                taskId: input.taskId,
                artifactChanges: [
                  {
                    taskId: input.taskId,
                    artifactIds: [workflowArtifactId(input.taskId, input.code)],
                    removedArtifactIds: [],
                  },
                ],
                transition: {
                  task,
                  previousStatus: current.status,
                  workflowId: decision.success.workflowId,
                  workflow: {
                    id: context.taskWorkflows.forTask(current).definition.id,
                    revision: context.taskWorkflows.forTask(current).definition.revision,
                  },
                  cause: decision.success.cause,
                  ...metadata,
                },
              };
            }),
        ),
      ).pipe(
        Effect.flatMap((result) =>
          result._tag === "Failure" ? Effect.fail(result.failure) : Effect.succeed(result.success),
        ),
      );
    },
    transitionTask<E>(input: AtomicTaskTransition<E>) {
      return withDatabase(input, "sqliteTaskRepository.transitionTask", (context) =>
        commitTaskMutation<Result.Result<TaskRecord, E>, unknown>(
          context,
          "sqliteTaskRepository.transitionTask",
          (session) =>
            Effect.gen(function* () {
              const current = yield* getTaskRecord(
                session,
                context.workspaceId,
                input.taskId,
                input.repoPath,
                context.taskWorkflows,
              );
              const decision = input.decide(current);
              if (decision._tag === "Failure") return { value: Result.fail(decision.failure) };
              if (decision.success.status === current.status)
                return { value: Result.succeed<TaskRecord>(current) };
              yield* updateTaskStatus(session, context.workspaceId, {
                taskId: input.taskId,
                status: decision.success.status,
                updatedAt: now(),
              });
              const task = yield* getTaskRecord(
                session,
                context.workspaceId,
                input.taskId,
                input.repoPath,
                context.taskWorkflows,
              );
              const metadata = yield* readTransitionMetadata(session, context.workspaceId);
              return {
                value: Result.succeed<TaskRecord>(task),
                taskId: input.taskId,
                transition: {
                  task,
                  previousStatus: current.status,
                  workflowId: decision.success.workflowId,
                  workflow: {
                    id: context.taskWorkflows.forTask(current).definition.id,
                    revision: context.taskWorkflows.forTask(current).definition.revision,
                  },
                  cause: decision.success.cause,
                  ...metadata,
                },
              };
            }),
        ),
      ).pipe(
        Effect.flatMap((result) =>
          result._tag === "Failure" ? Effect.fail(result.failure) : Effect.succeed(result.success),
        ),
      );
    },
  };
};
