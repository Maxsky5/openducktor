import { taskAssetRenderContextSchema, workspaceIdSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { TaskAssetError } from "../../application/task-assets/task-asset-error";

type TaskAssetMutationOperation = "create" | "update";
type TaskAssetFileOperation = TaskAssetMutationOperation | "delete" | "serve" | "startup_sweep";

const createFileError = (input: {
  operation: "stage" | "create" | "update" | "delete" | "discard" | "startup_sweep" | "serve";
  code:
    | "validation"
    | "filesystem"
    | "promotion"
    | "quarantine"
    | "restore"
    | "purge"
    | "partial_state";
  phase: string;
  message: string;
  assetIds?: string[];
  taskId?: string;
  cause?: unknown;
}): TaskAssetError => {
  const fields = {
    operation: input.operation,
    code: input.code,
    assetIds: input.assetIds ?? [],
    failedPhase: input.phase,
    durableState: "unchanged",
    retryAllowed: true,
    message: input.message,
  } satisfies Omit<ConstructorParameters<typeof TaskAssetError>[0], "taskId" | "cause">;
  if (input.taskId && input.cause !== undefined) {
    return new TaskAssetError({ ...fields, taskId: input.taskId, cause: input.cause });
  }
  if (input.taskId) {
    return new TaskAssetError({ ...fields, taskId: input.taskId });
  }
  if (input.cause !== undefined) {
    return new TaskAssetError({ ...fields, cause: input.cause });
  }
  return new TaskAssetError(fields);
};

const taskAssetTaskContextSchema = taskAssetRenderContextSchema.pick({
  workspaceId: true,
  taskId: true,
});

export const validateTaskAssetTaskContext = (
  workspaceId: string,
  taskId: string,
  operation: TaskAssetFileOperation,
): Effect.Effect<void, TaskAssetError> => {
  const parsed = taskAssetTaskContextSchema.safeParse({ workspaceId, taskId });
  if (!parsed.success) {
    return Effect.fail(
      createFileError({
        operation,
        code: "validation",
        phase: "validate_identifiers",
        message: "Task asset identifiers are invalid.",
        taskId,
        cause: parsed.error,
      }),
    );
  }
  return Effect.void;
};

export const validateTaskAssetContext = (
  workspaceId: string,
  taskId: string,
  assetId: string,
  operation: TaskAssetFileOperation,
): Effect.Effect<void, TaskAssetError> => {
  const parsed = taskAssetRenderContextSchema.safeParse({
    workspaceId,
    taskId,
    scope: "description",
    assetId,
  });
  if (!parsed.success) {
    return Effect.fail(
      createFileError({
        operation,
        code: "validation",
        phase: "validate_identifiers",
        message: "Task asset identifiers are invalid.",
        assetIds: [assetId],
        taskId,
        cause: parsed.error,
      }),
    );
  }
  return Effect.void;
};

export const validateTaskAssetStageContext = (
  workspaceId: string,
  assetId: string,
): Effect.Effect<void, TaskAssetError> => {
  if (!workspaceIdSchema.safeParse(workspaceId).success || !/^[0-9a-f-]{36}$/i.test(assetId)) {
    return Effect.fail(
      createFileError({
        operation: "stage",
        code: "validation",
        phase: "validate_identifiers",
        message: "Task asset staging identifiers are invalid.",
        assetIds: [assetId],
      }),
    );
  }
  return Effect.void;
};

export const taskAssetFileTryPromise = <A>(
  run: () => Promise<A>,
  error: Omit<Parameters<typeof createFileError>[0], "cause">,
): Effect.Effect<A, TaskAssetError> =>
  Effect.tryPromise({ try: run, catch: (cause) => createFileError({ ...error, cause }) });
