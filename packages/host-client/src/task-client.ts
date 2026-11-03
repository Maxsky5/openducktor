import {
  type WorkspaceRef,
  workflowCatalogSchema,
  workspaceWorkflowContextSchema,
  type WorkflowCatalog,
  type WorkspaceWorkflowContext,
  type TaskCard,
  taskCardSchema,
  artifactScopeSchema,
  artifactReadRequestSchema,
  artifactCreateRequestSchema,
  artifactRenameRequestSchema,
  artifactReplaceRequestSchema,
  artifactDeleteRequestSchema,
  taskArtifactCollectionSchema,
  artifactReadResultSchema,
  artifactSaveResultSchema,
  artifactDeleteResultSchema,
  type ArtifactScope,
  type ArtifactReadRequest,
  type ArtifactCreateRequest,
  type ArtifactRenameRequest,
  type ArtifactReplaceRequest,
  type ArtifactDeleteRequest,
  type TaskArtifactCollection,
  type ArtifactReadResult,
  type ArtifactSaveResult,
  type ArtifactDeleteResult,
  type AgentSessionIdentity,
  type AgentSessionRecord,
  agentSessionRecordSchema,
  type TaskAgentSessions,
  type TaskAssetDescriptionMutation,
  type TaskAssetDiscardStagedInput,
  type TaskAssetStageInput,
  type TaskAssetStageResult,
  type TaskCreateInput,
  type TaskMetadataPayload,
  type TaskStopImpact,
  type TaskStopImpactOperation,
  type TaskUpdatePatch,
  taskAgentSessionsSchema,
  taskAssetDescriptionMutationSchema,
  taskAssetDiscardStagedInputSchema,
  taskAssetStageInputSchema,
  taskAssetStageResultSchema,
  taskCloseInputSchema,
  type TaskMergeStatusSnapshot,
  taskMergeStatusSnapshotSchema,
  type TaskWorktreeCleanupImpact,
  type TaskWorktreeOwners,
  type TaskWorktreeOwnersRequest,
  taskWorktreeOwnersSchema,
  taskWorktreeCleanupImpactSchema,
  type IssueItemsImportInput,
  type IssueItemsImportResult,
  type IssueItemsListInput,
  type IssueItemsListResult,
  type IssueItemGetInput,
  type IssueImageGetInput,
  type IssueImageGetResult,
  type SourceIssue,
  issueItemGetInputSchema,
  issueImageGetInputSchema,
  issueImageGetResultSchema,
  sourceIssueSchema,
  issueItemsImportInputSchema,
  issueItemsImportResultSchema,
  issueItemsListInputSchema,
  issueItemsListResultSchema,
  azureAreaPathsResultSchema,
  taskCreateInputSchema,
  type TaskArtifactSaveResult,
  taskArtifactSaveResultSchema,
  taskMetadataArtifactSchema,
  taskMetadataPayloadSchema,
  taskStatusSchema,
  taskStopImpactSchema,
  taskUpdatePatchSchema,
} from "@openducktor/contracts";
import { z } from "zod";
import type { InvokeFn } from "./invoke-utils";
import {
  arrayResultSchema,
  booleanResultSchema,
  okResultSchema,
  voidResultSchema,
} from "./invoke-utils";
type TaskStatus = string;

/** A submit sends the event that the artifact or its verdict declares. */
export type WorkflowArtifactSaveInput = WorkspaceRef & {
  taskId: string;
  code: string;
  markdown: string;
  verdict?: string;
  submit: boolean;
};

export type WorkflowArtifactReadResult = {
  markdown: string;
  updatedAt: string | null;
  error?: string | null;
};

type TaskCreateArgs = WorkspaceRef & {
  input: TaskCreateInput;
  descriptionAssets?: TaskAssetDescriptionMutation;
};
type TaskUpdateArgs = WorkspaceRef & {
  taskId: string;
  patch: TaskUpdatePatch;
  descriptionAssets?: TaskAssetDescriptionMutation;
};
type TaskTransitionArgs = WorkspaceRef & {
  taskId: string;
  status: TaskStatus;
  reason?: string;
};

/**
 * Callers can pass a wider object, such as a workspace record, because it has every scope field.
 * The request holds only the contract fields, so the host's strict schema accepts it.
 */
const artifactScopeRequest = z.object(artifactScopeSchema.shape);
const artifactReadRequest = z.object(artifactReadRequestSchema.shape);
const artifactCreateRequest = z.object(artifactCreateRequestSchema.shape);
const artifactRenameRequest = z.object(artifactRenameRequestSchema.shape);
const artifactReplaceRequest = z.object(artifactReplaceRequestSchema.shape);
const artifactDeleteRequest = z.object(artifactDeleteRequestSchema.shape);

export class HostTaskClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  workflowCatalogGet(): Promise<WorkflowCatalog> {
    return this.invokeFn("workflow_catalog_get", {}, workflowCatalogSchema);
  }

  workspaceWorkflowGet(scope: WorkspaceRef): Promise<WorkspaceWorkflowContext> {
    return this.invokeFn(
      "workspace_workflow_get",
      { workspaceId: scope.workspaceId, repoPath: scope.repoPath },
      workspaceWorkflowContextSchema,
    );
  }

  taskArtifactsList(input: ArtifactScope): Promise<TaskArtifactCollection> {
    return this.invokeFn(
      "task_artifacts_list",
      artifactScopeRequest.parse(input),
      taskArtifactCollectionSchema,
    );
  }

  taskArtifactRead(input: ArtifactReadRequest): Promise<ArtifactReadResult> {
    return this.invokeFn(
      "task_artifact_read",
      artifactReadRequest.parse(input),
      artifactReadResultSchema,
    );
  }

  taskArtifactCreate(input: ArtifactCreateRequest): Promise<ArtifactSaveResult> {
    return this.invokeFn(
      "task_artifact_create",
      artifactCreateRequest.parse(input),
      artifactSaveResultSchema,
    );
  }

  taskArtifactRename(input: ArtifactRenameRequest): Promise<ArtifactSaveResult> {
    return this.invokeFn(
      "task_artifact_rename",
      artifactRenameRequest.parse(input),
      artifactSaveResultSchema,
    );
  }

  taskArtifactReplace(input: ArtifactReplaceRequest): Promise<ArtifactSaveResult> {
    return this.invokeFn(
      "task_artifact_replace",
      artifactReplaceRequest.parse(input),
      artifactSaveResultSchema,
    );
  }

  taskArtifactDelete(input: ArtifactDeleteRequest): Promise<ArtifactDeleteResult> {
    return this.invokeFn(
      "task_artifact_delete",
      artifactDeleteRequest.parse(input),
      artifactDeleteResultSchema,
    );
  }

  async tasksList(scope: WorkspaceRef): Promise<TaskCard[]> {
    const args: WorkspaceRef = { workspaceId: scope.workspaceId, repoPath: scope.repoPath };
    return this.invokeFn("tasks_list", args, arrayResultSchema(taskCardSchema, "tasks_list"));
  }

  /** Read every task card, including closed tasks outside Kanban retention. */
  async tasksListAll(scope: WorkspaceRef): Promise<TaskCard[]> {
    const args: WorkspaceRef = { workspaceId: scope.workspaceId, repoPath: scope.repoPath };
    return this.invokeFn(
      "tasks_list_all",
      args,
      arrayResultSchema(taskCardSchema, "tasks_list_all"),
    );
  }

  /** The IDs of all tasks of a repository, also closed tasks that the Kanban board hides. */
  async taskIdsList(scope: WorkspaceRef): Promise<string[]> {
    const args: WorkspaceRef = { workspaceId: scope.workspaceId, repoPath: scope.repoPath };
    return this.invokeFn("task_ids_list", args, arrayResultSchema(z.string(), "task_ids_list"));
  }

  async issueItemsList(input: IssueItemsListInput): Promise<IssueItemsListResult> {
    return this.invokeFn(
      "issue_items_list",
      issueItemsListInputSchema.parse(input),
      issueItemsListResultSchema,
    );
  }

  async issueItemGet(input: IssueItemGetInput): Promise<SourceIssue> {
    return this.invokeFn("issue_item_get", issueItemGetInputSchema.parse(input), sourceIssueSchema);
  }

  async issueImageGet(input: IssueImageGetInput): Promise<IssueImageGetResult> {
    return this.invokeFn(
      "issue_image_get",
      issueImageGetInputSchema.parse(input),
      issueImageGetResultSchema,
    );
  }

  async issueItemsImport(input: IssueItemsImportInput): Promise<IssueItemsImportResult> {
    return this.invokeFn(
      "issue_items_import",
      issueItemsImportInputSchema.parse(input),
      issueItemsImportResultSchema,
    );
  }

  async azureAreaPathsList(scope: WorkspaceRef): Promise<string[]> {
    return this.invokeFn(
      "azure_area_paths_list",
      { workspaceId: scope.workspaceId, repoPath: scope.repoPath },
      azureAreaPathsResultSchema,
    );
  }

  async taskCreate(
    scope: WorkspaceRef,
    input: TaskCreateInput,
    descriptionAssets?: TaskAssetDescriptionMutation,
  ): Promise<TaskCard> {
    const createInput = taskCreateInputSchema.parse(input);
    const assetIntent = descriptionAssets
      ? taskAssetDescriptionMutationSchema.parse(descriptionAssets)
      : undefined;
    const args: TaskCreateArgs = {
      workspaceId: scope.workspaceId,
      repoPath: scope.repoPath,
      input: createInput,
    };
    if (assetIntent) {
      args.descriptionAssets = assetIntent;
    }
    return this.invokeFn("task_create", args, taskCardSchema);
  }

  async taskUpdate(
    scope: WorkspaceRef,
    taskId: string,
    patch: TaskUpdatePatch,
    descriptionAssets?: TaskAssetDescriptionMutation,
  ): Promise<TaskCard> {
    const updatePatch = taskUpdatePatchSchema.parse(patch);
    const assetIntent = descriptionAssets
      ? taskAssetDescriptionMutationSchema.parse(descriptionAssets)
      : undefined;
    if (assetIntent && !Object.hasOwn(updatePatch, "description")) {
      throw new Error("descriptionAssets requires a description patch.");
    }
    const args: TaskUpdateArgs = {
      workspaceId: scope.workspaceId,
      repoPath: scope.repoPath,
      taskId,
      patch: updatePatch,
    };
    if (assetIntent) {
      args.descriptionAssets = assetIntent;
    }
    return this.invokeFn("task_update", args, taskCardSchema);
  }

  async taskAssetStage(input: TaskAssetStageInput): Promise<TaskAssetStageResult> {
    return this.invokeFn(
      "task_asset_stage",
      taskAssetStageInputSchema.parse(input),
      taskAssetStageResultSchema,
    );
  }

  async taskAssetDiscardStaged(input: TaskAssetDiscardStagedInput): Promise<void> {
    await this.invokeFn(
      "task_asset_discard_staged",
      taskAssetDiscardStagedInputSchema.parse(input),
      voidResultSchema,
    );
  }

  async taskDelete(scope: WorkspaceRef, taskId: string): Promise<{ ok: boolean }> {
    return this.invokeFn(
      "task_delete",
      { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId },
      okResultSchema("task_delete"),
    );
  }

  async taskClose(scope: WorkspaceRef, taskId: string, removeWorktree: boolean): Promise<TaskCard> {
    return this.invokeFn(
      "task_close",
      taskCloseInputSchema.parse({
        workspaceId: scope.workspaceId,
        repoPath: scope.repoPath,
        taskId,
        removeWorktree,
      }),
      taskCardSchema,
    );
  }

  async taskWorktreeCleanupImpactGet(
    scope: WorkspaceRef,
    taskId: string,
  ): Promise<TaskWorktreeCleanupImpact> {
    return this.invokeFn(
      "task_worktree_cleanup_impact_get",
      { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId },
      taskWorktreeCleanupImpactSchema,
    );
  }

  /** The others that need a worktree that a task action removes. Only a confirmation reads them. */
  async taskWorktreeOwnersGet(input: TaskWorktreeOwnersRequest): Promise<TaskWorktreeOwners> {
    return this.invokeFn("task_worktree_owners_get", input, taskWorktreeOwnersSchema);
  }

  /** Removes the worktree and local branches of a closed task. */
  async taskWorktreeRemove(scope: WorkspaceRef, taskId: string): Promise<void> {
    await this.invokeFn(
      "task_worktree_remove",
      { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId },
      voidResultSchema,
    );
  }

  async taskMergeStatusGet(scope: WorkspaceRef): Promise<TaskMergeStatusSnapshot> {
    return this.invokeFn(
      "task_merge_status_get",
      { workspaceId: scope.workspaceId, repoPath: scope.repoPath },
      taskMergeStatusSnapshotSchema,
    );
  }

  /** Fetches and runs a merge detection pass for the workspace, then returns its snapshot. */
  async taskMergeStatusCheck(scope: WorkspaceRef): Promise<TaskMergeStatusSnapshot> {
    return this.invokeFn(
      "task_merge_status_check",
      { workspaceId: scope.workspaceId, repoPath: scope.repoPath },
      taskMergeStatusSnapshotSchema,
    );
  }

  async taskResetImplementation(scope: WorkspaceRef, taskId: string): Promise<TaskCard> {
    return this.invokeFn(
      "task_reset_implementation",
      { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId },
      taskCardSchema,
    );
  }

  async taskReset(scope: WorkspaceRef, taskId: string): Promise<TaskCard> {
    return this.invokeFn(
      "task_reset",
      { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId },
      taskCardSchema,
    );
  }

  async taskTransition(
    scope: WorkspaceRef,
    taskId: string,
    status: TaskStatus,
    reason?: string,
  ): Promise<TaskCard> {
    taskStatusSchema.parse(status);
    const args: TaskTransitionArgs = {
      workspaceId: scope.workspaceId,
      repoPath: scope.repoPath,
      taskId,
      status,
    };
    if (reason !== undefined) {
      args.reason = reason;
    }
    return this.invokeFn("task_transition", args, taskCardSchema);
  }

  async taskApplyEvent(scope: WorkspaceRef, taskId: string, eventId: string): Promise<TaskCard> {
    return this.invokeFn(
      "task_apply_event",
      { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId, eventId },
      taskCardSchema,
    );
  }

  async workflowArtifactGet(
    scope: WorkspaceRef,
    taskId: string,
    code: string,
  ): Promise<WorkflowArtifactReadResult> {
    const artifact = await this.invokeFn(
      "workflow_artifact_get",
      { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId, code },
      taskMetadataArtifactSchema,
    );
    return {
      markdown: artifact.markdown,
      updatedAt: artifact.updatedAt ?? null,
      error: artifact.error ?? null,
    };
  }

  async workflowArtifactSave(input: WorkflowArtifactSaveInput): Promise<TaskArtifactSaveResult> {
    return this.invokeFn("workflow_artifact_save", { ...input }, taskArtifactSaveResultSchema);
  }

  async taskMetadataGet(scope: WorkspaceRef, taskId: string): Promise<TaskMetadataPayload> {
    return this.invokeFn(
      "task_metadata_get",
      { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId },
      taskMetadataPayloadSchema,
    );
  }

  async agentSessionsList(scope: WorkspaceRef, taskId: string): Promise<AgentSessionRecord[]> {
    return this.invokeFn(
      "agent_sessions_list",
      { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskId },
      arrayResultSchema(agentSessionRecordSchema, "agent_sessions_list"),
    );
  }

  async taskStopImpactGet(
    scope: WorkspaceRef,
    taskIds: string[],
    operation: TaskStopImpactOperation,
  ): Promise<TaskStopImpact> {
    return this.invokeFn(
      "task_stop_impact_get",
      { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskIds, operation },
      taskStopImpactSchema,
    );
  }

  async agentSessionsListForTasks(
    scope: WorkspaceRef,
    taskIds: string[],
  ): Promise<TaskAgentSessions[]> {
    return this.invokeFn(
      "agent_sessions_list_for_tasks",
      { workspaceId: scope.workspaceId, repoPath: scope.repoPath, taskIds },
      arrayResultSchema(taskAgentSessionsSchema, "agent_sessions_list_for_tasks"),
    );
  }

  async agentSessionDelete(
    scope: WorkspaceRef,
    taskId: string,
    identity: AgentSessionIdentity,
  ): Promise<void> {
    await this.invokeFn(
      "agent_session_delete",
      {
        workspaceId: scope.workspaceId,
        repoPath: scope.repoPath,
        taskId,
        identity,
      },
      booleanResultSchema,
    );
  }
}
