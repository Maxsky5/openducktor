import {
  artifactCreateRequestSchema,
  artifactDeleteRequestSchema,
  artifactReadRequestSchema,
  artifactRenameRequestSchema,
  artifactReplaceRequestSchema,
  artifactScopeSchema,
  type ArtifactScope,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { z } from "zod";
import {
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../../effect/host-errors";
import { decodeArtifactInput } from "../support/artifact-content";
import type { TaskService, TaskServiceUseCaseInput, TaskServiceError } from "../task-service";

type ArtifactUseCases = Pick<
  TaskService,
  | "listTaskArtifacts"
  | "readTaskArtifact"
  | "createTaskArtifact"
  | "renameTaskArtifact"
  | "replaceTaskArtifact"
  | "deleteTaskArtifact"
>;

export const createArtifactUseCases = ({
  taskStore,
  taskWorkflows,
  taskSessionLifecycleCoordinator,
  gitPort,
}: TaskServiceUseCaseInput): ArtifactUseCases => {
  return {
    listTaskArtifacts(input) {
      return Effect.gen(function* () {
        const scope = yield* parseRequest(artifactScopeSchema, input);
        const task = yield* taskStore.getTask(scope);
        const artifacts = yield* taskStore.listArtifacts(scope);
        return {
          artifacts,
          canManageFree: !taskWorkflows.forTask(task).isTerminalState(task.status),
        };
      });
    },
    readTaskArtifact(input) {
      return Effect.gen(function* () {
        const request = yield* parseRequest(artifactReadRequestSchema, input);
        const stored = yield* taskStore.readArtifact(request);
        if (!stored)
          return yield* Effect.fail(
            new HostValidationError({
              field: "artifactId",
              message: "Artifact is unavailable for this task. Refresh the artifact collection.",
            }),
          );
        return {
          artifact: stored.artifact,
          dataBase64: Buffer.from(stored.content).toString("base64"),
        };
      });
    },
    createTaskArtifact(input) {
      return Effect.gen(function* () {
        const request = yield* parseRequest(artifactCreateRequestSchema, input);
        const content = yield* decodeContent(request.dataBase64);
        const artifact = yield* write(request, taskStore.createArtifact({ ...request, content }));
        return { artifact };
      });
    },
    renameTaskArtifact(input) {
      return Effect.gen(function* () {
        const request = yield* parseRequest(artifactRenameRequestSchema, input);
        const artifact = yield* write(request, taskStore.renameArtifact(request));
        return { artifact };
      });
    },
    replaceTaskArtifact(input) {
      return Effect.gen(function* () {
        const request = yield* parseRequest(artifactReplaceRequestSchema, input);
        const content = yield* decodeContent(request.dataBase64);
        const artifact = yield* write(request, taskStore.replaceArtifact({ ...request, content }));
        return { artifact };
      });
    },
    deleteTaskArtifact(input) {
      return Effect.gen(function* () {
        const request = yield* parseRequest(artifactDeleteRequestSchema, input);
        yield* write(request, taskStore.deleteArtifact(request));
        return { artifactId: request.artifactId };
      });
    },
  };

  /** Hold the task guard through the store transaction and its rollback or commit. */
  function write<A>(
    scope: ArtifactScope,
    action: Effect.Effect<A, TaskServiceError>,
  ): Effect.Effect<A, TaskServiceError> {
    return Effect.scoped(
      Effect.gen(function* () {
        const repoPath = gitPort ? yield* gitPort.canonicalizePath(scope.repoPath) : scope.repoPath;
        yield* taskSessionLifecycleCoordinator.acquireLifecycle(
          repoPath,
          [scope.taskId],
          "change artifact",
        );
        return yield* action;
      }),
    );
  }
};

const parseRequest = <T>(schema: z.ZodType<T>, input: T): Effect.Effect<T, HostValidationError> =>
  Effect.try({
    try: () => schema.parse(input),
    catch: (cause) =>
      new HostValidationError({
        field: "artifact",
        message: `Invalid artifact request: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  });

const decodeContent = (
  dataBase64: string,
): Effect.Effect<Uint8Array, HostValidationErrorAggregate> =>
  Effect.try({
    try: () => decodeArtifactInput(dataBase64),
    catch: (cause) =>
      cause instanceof HostValidationError
        ? cause
        : new HostValidationError({
            field: "dataBase64",
            message:
              "Cannot decode artifact content. Encode the original bytes as base64 and retry.",
            cause,
          }),
  });
