import {
  type ArtifactSaveResult,
  type ArtifactDeleteResult,
  type TaskMetadataArtifact,
  type TaskEventCursor,
  type TaskChangeSet,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { workflowArtifactChange } from "./artifact-changes";
import type { createMutationPublisher } from "./task-mutation-publisher";
import type {
  TaskService,
  TaskServiceWithMutationProgress,
  TaskServiceError,
} from "./task-service";
import type { WorkflowArtifactSaveResult } from "./use-cases/manage-workflow-artifacts";

type PublishedWorkflowArtifact = TaskMetadataArtifact & { cursor: TaskEventCursor };

export type ArtifactPublishingMethods = Pick<
  TaskService,
  "workflowArtifactGet" | "listTaskArtifacts" | "readTaskArtifact"
> & {
  createTaskArtifact(
    input: Parameters<TaskService["createTaskArtifact"]>[0],
  ): Effect.Effect<ArtifactSaveResult, TaskServiceError>;
  renameTaskArtifact(
    input: Parameters<TaskService["renameTaskArtifact"]>[0],
  ): Effect.Effect<ArtifactSaveResult, TaskServiceError>;
  replaceTaskArtifact(
    input: Parameters<TaskService["replaceTaskArtifact"]>[0],
  ): Effect.Effect<ArtifactSaveResult, TaskServiceError>;
  deleteTaskArtifact(
    input: Parameters<TaskService["deleteTaskArtifact"]>[0],
  ): Effect.Effect<ArtifactDeleteResult, TaskServiceError>;
  workflowArtifactSave(
    input: Parameters<TaskService["workflowArtifactSave"]>[0],
  ): Effect.Effect<
    WorkflowArtifactSaveResult & { artifact: PublishedWorkflowArtifact },
    TaskServiceError
  >;
};

export const createArtifactPublishingMethods = (
  taskService: TaskServiceWithMutationProgress,
  publishMutation: ReturnType<typeof createMutationPublisher>,
): ArtifactPublishingMethods => {
  const publishArtifactSave = (
    operation: "create-artifact" | "rename-artifact" | "replace-artifact",
    input: { repoPath: string; taskId: string },
    mutation: Effect.Effect<Omit<ArtifactSaveResult, "cursor">, TaskServiceError>,
  ): Effect.Effect<ArtifactSaveResult, TaskServiceError> =>
    publishMutation(operation, input.repoPath, changeForTask(input.taskId), mutation, {
      settleOnInterrupt: true,
      artifactChanges: (result) => [
        {
          taskId: input.taskId,
          artifactIds: [result.artifact.artifactId],
          removedArtifactIds: [],
        },
      ],
    }).pipe(Effect.map(({ value, cursor }) => ({ ...value, cursor })));

  return {
    listTaskArtifacts: (input) => taskService.listTaskArtifacts(input),
    readTaskArtifact: (input) => taskService.readTaskArtifact(input),
    createTaskArtifact: (input) =>
      publishArtifactSave("create-artifact", input, taskService.createTaskArtifact(input)),
    renameTaskArtifact: (input) =>
      publishArtifactSave("rename-artifact", input, taskService.renameTaskArtifact(input)),
    replaceTaskArtifact: (input) =>
      publishArtifactSave("replace-artifact", input, taskService.replaceTaskArtifact(input)),
    deleteTaskArtifact: (input) =>
      publishMutation(
        "delete-artifact",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.deleteTaskArtifact(input),
        {
          settleOnInterrupt: true,
          artifactChanges: () => [
            {
              taskId: input.taskId,
              artifactIds: [input.artifactId],
              removedArtifactIds: [input.artifactId],
            },
          ],
        },
      ).pipe(Effect.map(({ value, cursor }) => ({ ...value, cursor }))),
    workflowArtifactGet: (input) => taskService.workflowArtifactGet(input),
    workflowArtifactSave: (input) =>
      publishMutation(
        "save-workflow-artifact",
        input.repoPath,
        changeForTask(input.taskId),
        Effect.suspend(() => taskService.workflowArtifactSave(input)),
        {
          changes: (result) => result.changes,
          artifactChanges: () => [workflowArtifactChange(input.taskId, input.code)],
        },
      ).pipe(
        Effect.map(({ value, cursor }) => ({ ...value, artifact: { ...value.artifact, cursor } })),
      ),
  };
};

const changeForTask = (taskId: string): TaskChangeSet => ({
  taskIds: [taskId],
  removedTaskIds: [],
});
