import {
  artifactScopeSchema,
  artifactReadRequestSchema,
  artifactCreateRequestSchema,
  artifactRenameRequestSchema,
  artifactReplaceRequestSchema,
  artifactDeleteRequestSchema,
  taskArtifactCollectionSchema,
  artifactContentChunkSchema,
  artifactSaveResultSchema,
  artifactDeleteResultSchema,
  type ArtifactScope,
  type ArtifactReadRequest,
  type ArtifactCreateRequest,
  type ArtifactRenameRequest,
  type ArtifactReplaceRequest,
  type ArtifactDeleteRequest,
  type TaskArtifactCollection,
  type ArtifactContentChunk,
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
import {
  type BuiltinStateId as TaskStatus,
  type BuiltinTaskCard as TaskCard,
  builtinTaskCardSchema,
} from "@openducktor/workflows";

/** A submit sends the event that the artifact or its verdict declares. */
export type WorkflowArtifactSaveInput = {
  repoPath: string;
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

type TasksListArgs = { repoPath: string };
type TaskCreateArgs = {
  repoPath: string;
  input: TaskCreateInput;
  descriptionAssets?: TaskAssetDescriptionMutation;
};
type TaskUpdateArgs = {
  repoPath: string;
  taskId: string;
  patch: TaskUpdatePatch;
  descriptionAssets?: TaskAssetDescriptionMutation;
};
type TaskTransitionArgs = {
  repoPath: string;
  taskId: string;
  status: TaskStatus;
  reason?: string;
};

export class HostTaskClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  taskArtifactsList(input: ArtifactScope): Promise<TaskArtifactCollection> {
    return this.invokeFn(
      "task_artifacts_list",
      artifactScopeSchema.parse(input),
      taskArtifactCollectionSchema,
    );
  }

  taskArtifactRead(input: ArtifactReadRequest): Promise<ArtifactContentChunk> {
    return this.invokeFn(
      "task_artifact_read",
      artifactReadRequestSchema.parse(input),
      artifactContentChunkSchema,
    );
  }

  taskArtifactCreate(input: ArtifactCreateRequest): Promise<ArtifactSaveResult> {
    return this.invokeFn(
      "task_artifact_create",
      artifactCreateRequestSchema.parse(input),
      artifactSaveResultSchema,
    );
  }

  taskArtifactRename(input: ArtifactRenameRequest): Promise<ArtifactSaveResult> {
    return this.invokeFn(
      "task_artifact_rename",
      artifactRenameRequestSchema.parse(input),
      artifactSaveResultSchema,
    );
  }

  taskArtifactReplace(input: ArtifactReplaceRequest): Promise<ArtifactSaveResult> {
    return this.invokeFn(
      "task_artifact_replace",
      artifactReplaceRequestSchema.parse(input),
      artifactSaveResultSchema,
    );
  }

  taskArtifactDelete(input: ArtifactDeleteRequest): Promise<ArtifactDeleteResult> {
    return this.invokeFn(
      "task_artifact_delete",
      artifactDeleteRequestSchema.parse(input),
      artifactDeleteResultSchema,
    );
  }

  async tasksList(repoPath: string): Promise<TaskCard[]> {
    const args: TasksListArgs = { repoPath };
    return this.invokeFn(
      "tasks_list",
      args,
      arrayResultSchema(builtinTaskCardSchema, "tasks_list"),
    );
  }

  /** Read every task card, including closed tasks outside Kanban retention. */
  async tasksListAll(repoPath: string): Promise<TaskCard[]> {
    const args: TasksListArgs = { repoPath };
    return this.invokeFn(
      "tasks_list_all",
      args,
      arrayResultSchema(builtinTaskCardSchema, "tasks_list_all"),
    );
  }

  /** The IDs of all tasks of a repository, also closed tasks that the Kanban board hides. */
  async taskIdsList(repoPath: string): Promise<string[]> {
    const args: TasksListArgs = { repoPath };
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

  async azureAreaPathsList(repoPath: string): Promise<string[]> {
    return this.invokeFn("azure_area_paths_list", { repoPath }, azureAreaPathsResultSchema);
  }

  async taskCreate(
    repoPath: string,
    input: TaskCreateInput,
    descriptionAssets?: TaskAssetDescriptionMutation,
  ): Promise<TaskCard> {
    const createInput = taskCreateInputSchema.parse(input);
    const assetIntent = descriptionAssets
      ? taskAssetDescriptionMutationSchema.parse(descriptionAssets)
      : undefined;
    const args: TaskCreateArgs = {
      repoPath,
      input: createInput,
    };
    if (assetIntent) {
      args.descriptionAssets = assetIntent;
    }
    return this.invokeFn("task_create", args, builtinTaskCardSchema);
  }

  async taskUpdate(
    repoPath: string,
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
      repoPath,
      taskId,
      patch: updatePatch,
    };
    if (assetIntent) {
      args.descriptionAssets = assetIntent;
    }
    return this.invokeFn("task_update", args, builtinTaskCardSchema);
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

  async taskDelete(repoPath: string, taskId: string): Promise<{ ok: boolean }> {
    return this.invokeFn("task_delete", { repoPath, taskId }, okResultSchema("task_delete"));
  }

  async taskClose(repoPath: string, taskId: string): Promise<TaskCard> {
    return this.invokeFn("task_close", { repoPath, taskId }, builtinTaskCardSchema);
  }

  async taskResetImplementation(repoPath: string, taskId: string): Promise<TaskCard> {
    return this.invokeFn("task_reset_implementation", { repoPath, taskId }, builtinTaskCardSchema);
  }

  async taskReset(repoPath: string, taskId: string): Promise<TaskCard> {
    return this.invokeFn("task_reset", { repoPath, taskId }, builtinTaskCardSchema);
  }

  async taskTransition(
    repoPath: string,
    taskId: string,
    status: TaskStatus,
    reason?: string,
  ): Promise<TaskCard> {
    taskStatusSchema.parse(status);
    const args: TaskTransitionArgs = {
      repoPath,
      taskId,
      status,
    };
    if (reason !== undefined) {
      args.reason = reason;
    }
    return this.invokeFn("task_transition", args, builtinTaskCardSchema);
  }

  async taskApplyEvent(repoPath: string, taskId: string, eventId: string): Promise<TaskCard> {
    return this.invokeFn("task_apply_event", { repoPath, taskId, eventId }, builtinTaskCardSchema);
  }

  async workflowArtifactGet(
    repoPath: string,
    taskId: string,
    code: string,
  ): Promise<WorkflowArtifactReadResult> {
    const artifact = await this.invokeFn(
      "workflow_artifact_get",
      { repoPath, taskId, code },
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

  async taskMetadataGet(repoPath: string, taskId: string): Promise<TaskMetadataPayload> {
    return this.readTaskMetadata(repoPath, taskId);
  }

  async agentSessionsList(repoPath: string, taskId: string): Promise<AgentSessionRecord[]> {
    return this.invokeFn(
      "agent_sessions_list",
      { repoPath, taskId },
      arrayResultSchema(agentSessionRecordSchema, "agent_sessions_list"),
    );
  }

  async taskStopImpactGet(
    repoPath: string,
    taskIds: string[],
    operation: TaskStopImpactOperation,
  ): Promise<TaskStopImpact> {
    return this.invokeFn(
      "task_stop_impact_get",
      { repoPath, taskIds, operation },
      taskStopImpactSchema,
    );
  }

  async agentSessionsListForTasks(
    repoPath: string,
    taskIds: string[],
  ): Promise<TaskAgentSessions[]> {
    return this.invokeFn(
      "agent_sessions_list_for_tasks",
      { repoPath, taskIds },
      arrayResultSchema(taskAgentSessionsSchema, "agent_sessions_list_for_tasks"),
    );
  }

  async agentSessionDelete(
    repoPath: string,
    taskId: string,
    identity: AgentSessionIdentity,
  ): Promise<void> {
    await this.invokeFn(
      "agent_session_delete",
      {
        repoPath,
        taskId,
        identity,
      },
      booleanResultSchema,
    );
  }

  private readTaskMetadata(repoPath: string, taskId: string): Promise<TaskMetadataPayload> {
    return this.invokeFn("task_metadata_get", { repoPath, taskId }, taskMetadataPayloadSchema);
  }
}
