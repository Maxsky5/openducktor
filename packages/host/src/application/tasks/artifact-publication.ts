import {
  type ArtifactSaveResult,
  type ArtifactDeleteResult,
  type TaskMetadataArtifact,
  type TaskEventCursor,
  type WorkflowArtifactKind,
  type TaskChangeSet,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { workflowArtifactChange } from "./artifact-changes";
import type { TaskMutationProgressFailure } from "./task-mutation-progress-failure";
import type { TaskMutationOperation } from "./task-mutation-operation";
import type { createMutationPublisher } from "./task-mutation-publisher";
import type {
  TaskService,
  TaskServiceWithMutationProgress,
  TaskServiceError,
  TaskSetPlanResult,
} from "./task-service";

type PublishedWorkflowArtifact = TaskMetadataArtifact & { cursor: TaskEventCursor };

export type ArtifactPublishingMethods = Pick<
  TaskService,
  "specGet" | "planGet" | "qaGetReport" | "listTaskArtifacts" | "readTaskArtifact"
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
  setPlan(
    input: Parameters<TaskService["setPlan"]>[0],
  ): Effect.Effect<TaskSetPlanResult & { artifact: PublishedWorkflowArtifact }, TaskServiceError>;
  setSpec(
    input: Parameters<TaskService["setSpec"]>[0],
  ): Effect.Effect<PublishedWorkflowArtifact, TaskServiceError>;
  saveSpecArtifact(
    input: Parameters<TaskService["saveSpecArtifact"]>[0],
  ): Effect.Effect<PublishedWorkflowArtifact, TaskServiceError>;
  savePlanArtifact(
    input: Parameters<TaskService["savePlanArtifact"]>[0],
  ): Effect.Effect<PublishedWorkflowArtifact, TaskServiceError>;
};

export const createArtifactPublishingMethods = (
  taskService: TaskServiceWithMutationProgress,
  publishMutation: ReturnType<typeof createMutationPublisher>,
): ArtifactPublishingMethods => {
  const publishWorkflowArtifact = <A extends TaskMetadataArtifact>(
    operation: TaskMutationOperation,
    input: { repoPath: string; taskId: string },
    kind: WorkflowArtifactKind,
    mutation: Effect.Effect<A, TaskServiceError | TaskMutationProgressFailure>,
  ): Effect.Effect<A & { cursor: TaskEventCursor }, TaskServiceError> =>
    publishMutation(operation, input.repoPath, changeForTask(input.taskId), mutation, {
      artifactChanges: () => [workflowArtifactChange(input.taskId, kind)],
    }).pipe(Effect.map(({ value, cursor }) => ({ ...value, cursor })));

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
    specGet: (input) => taskService.specGet(input),
    setSpec: (input) =>
      publishWorkflowArtifact(
        "set-spec",
        input,
        "spec",
        Effect.suspend(() => taskService.setSpec(input)),
      ),
    saveSpecArtifact: (input) =>
      publishWorkflowArtifact(
        "save-spec-artifact",
        input,
        "spec",
        taskService.saveSpecArtifact(input),
      ),
    planGet: (input) => taskService.planGet(input),
    setPlan: (input) =>
      publishMutation(
        "set-plan",
        input.repoPath,
        changeForTask(input.taskId),
        Effect.suspend(() => taskService.setPlan(input)),
        {
          changes: (result) => result.changes,
          artifactChanges: () => [workflowArtifactChange(input.taskId, "plan")],
        },
      ).pipe(
        Effect.map(({ value, cursor }) => ({ ...value, artifact: { ...value.artifact, cursor } })),
      ),
    savePlanArtifact: (input) =>
      publishWorkflowArtifact(
        "save-plan-artifact",
        input,
        "plan",
        taskService.savePlanArtifact(input),
      ),
    qaGetReport: (input) => taskService.qaGetReport(input),
  };
};

const changeForTask = (taskId: string): TaskChangeSet => ({
  taskIds: [taskId],
  removedTaskIds: [],
});
