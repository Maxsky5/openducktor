import type { TaskWorkflowAssignment } from "./task-workflow-port";
import type { TaskCreateInput, TaskUpdatePatch } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { NewTaskAssetRecord } from "./task-asset-registry-port";
import type { TaskStoreError, TaskRecord } from "./task-repository-ports";

export type TaskDescriptionAssetPersistencePort = {
  createTaskWithDescriptionAssets(input: {
    workspaceId: string;
    repoPath: string;
    task: TaskCreateInput;
    /** The workflow that the new task follows. */
    workflow: TaskWorkflowAssignment;
    /** The initial state of the task workflow. */
    status: string;
    assets: NewTaskAssetRecord[];
    prepareFiles(taskId: string): Effect.Effect<void, TaskStoreError>;
  }): Effect.Effect<TaskRecord, TaskStoreError>;
  updateTaskWithDescriptionAssets(input: {
    workspaceId: string;
    repoPath: string;
    taskId: string;
    expectedTask: TaskRecord;
    expectedAssetIds: string[];
    patch: TaskUpdatePatch;
    insertAssets: NewTaskAssetRecord[];
    removeAssetIds: string[];
  }): Effect.Effect<TaskRecord, TaskStoreError>;
};
