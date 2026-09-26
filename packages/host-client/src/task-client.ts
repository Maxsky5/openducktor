import {
  type AgentSessionIdentity,
  type AgentSessionRecord,
  agentSessionRecordSchema,
  type PlanSubtaskInput,
  type TaskAgentSessions,
  type TaskAssetDescriptionMutation,
  type TaskAssetDiscardStagedInput,
  type TaskAssetStageInput,
  type TaskAssetStageResult,
  type TaskCard,
  type TaskCreateInput,
  type TaskMetadataPayload,
  type TaskStatus,
  type TaskStopImpact,
  type TaskStopImpactOperation,
  type TaskUpdatePatch,
  taskAgentSessionsSchema,
  taskAssetDescriptionMutationSchema,
  taskAssetDiscardStagedInputSchema,
  taskAssetStageInputSchema,
  taskAssetStageResultSchema,
  taskCardSchema,
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
  taskMetadataDocumentSchema,
  taskMetadataPayloadSchema,
  taskStatusSchema,
  taskStopImpactSchema,
  taskUpdatePatchSchema,
} from "@openducktor/contracts";
import type { SetPlanOutput, SetSpecOutput } from "@openducktor/core";
import type { InvokeFn } from "./invoke-utils";
import {
  arrayResultSchema,
  booleanResultSchema,
  okResultSchema,
  updatedAtResultSchema,
  voidResultSchema,
} from "./invoke-utils";

export type SetSpecInput = {
  taskId: string;
  markdown: string;
  repoPath?: string;
};

export type SaveSpecDocumentInput = {
  repoPath: string;
  taskId: string;
  markdown: string;
};

export type SetPlanInput = {
  taskId: string;
  markdown: string;
  subtasks?: PlanSubtaskInput[];
  repoPath?: string;
};

export type SavePlanDocumentInput = {
  repoPath: string;
  taskId: string;
  markdown: string;
};

export type TaskDocumentSection = "spec" | "plan" | "qa";
export type TaskDocumentReadResult = {
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
type SetPlanPayloadInput = { markdown: string; subtasks?: SetPlanInput["subtasks"] };

export class HostTaskClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  private readTaskMetadata(repoPath: string, taskId: string): Promise<TaskMetadataPayload> {
    return this.invokeFn("task_metadata_get", { repoPath, taskId }, taskMetadataPayloadSchema);
  }

  private async readTaskDocument(
    repoPath: string,
    taskId: string,
    section: TaskDocumentSection,
  ): Promise<TaskDocumentReadResult> {
    const payload = await this.readTaskMetadata(repoPath, taskId);

    if (section === "spec") {
      return {
        markdown: payload.spec.markdown,
        updatedAt: payload.spec.updatedAt ?? null,
        error: payload.spec.error ?? null,
      };
    }

    if (section === "plan") {
      return {
        markdown: payload.plan.markdown,
        updatedAt: payload.plan.updatedAt ?? null,
        error: payload.plan.error ?? null,
      };
    }

    return {
      markdown: payload.qaReport?.markdown ?? "",
      updatedAt: payload.qaReport?.updatedAt ?? null,
      error: payload.qaReport?.error ?? null,
    };
  }

  private requireRepoPath(repoPath: string | undefined, documentType: "spec" | "plan"): string {
    if (!repoPath) {
      throw new Error(`repoPath is required to set ${documentType}`);
    }
    return repoPath;
  }

  async tasksList(repoPath: string): Promise<TaskCard[]> {
    const args: TasksListArgs = { repoPath };
    return this.invokeFn("tasks_list", args, arrayResultSchema(taskCardSchema, "tasks_list"));
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
    return this.invokeFn("task_create", args, taskCardSchema);
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

  async taskDelete(
    repoPath: string,
    taskId: string,
    deleteSubtasks = false,
  ): Promise<{ ok: boolean }> {
    return this.invokeFn(
      "task_delete",
      { repoPath, taskId, deleteSubtasks },
      okResultSchema("task_delete"),
    );
  }

  async taskClose(repoPath: string, taskId: string): Promise<TaskCard> {
    return this.invokeFn("task_close", { repoPath, taskId }, taskCardSchema);
  }

  async taskResetImplementation(repoPath: string, taskId: string): Promise<TaskCard> {
    return this.invokeFn("task_reset_implementation", { repoPath, taskId }, taskCardSchema);
  }

  async taskReset(repoPath: string, taskId: string): Promise<TaskCard> {
    return this.invokeFn("task_reset", { repoPath, taskId }, taskCardSchema);
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
    return this.invokeFn("task_transition", args, taskCardSchema);
  }

  async specGet(repoPath: string, taskId: string): Promise<TaskDocumentReadResult> {
    return this.readTaskDocument(repoPath, taskId, "spec");
  }

  async setSpec(input: SetSpecInput): Promise<SetSpecOutput> {
    const repoPath = this.requireRepoPath(input.repoPath, "spec");

    const payload = await this.invokeFn(
      "set_spec",
      { repoPath, taskId: input.taskId, markdown: input.markdown },
      taskMetadataDocumentSchema,
    );

    return updatedAtResultSchema("set_spec").parse(payload);
  }

  async saveSpecDocument(input: SaveSpecDocumentInput): Promise<SetSpecOutput> {
    const payload = await this.invokeFn(
      "spec_save_document",
      { repoPath: input.repoPath, taskId: input.taskId, markdown: input.markdown },
      taskMetadataDocumentSchema,
    );
    return updatedAtResultSchema("spec_save_document").parse(payload);
  }

  async setPlan(input: SetPlanInput): Promise<SetPlanOutput> {
    const repoPath = this.requireRepoPath(input.repoPath, "plan");

    const planInput: SetPlanPayloadInput = {
      markdown: input.markdown,
    };
    if (input.subtasks !== undefined) {
      planInput.subtasks = input.subtasks;
    }
    const payload = await this.invokeFn(
      "set_plan",
      { repoPath, taskId: input.taskId, input: planInput },
      taskMetadataDocumentSchema,
    );

    return updatedAtResultSchema("set_plan").parse(payload);
  }

  async savePlanDocument(input: SavePlanDocumentInput): Promise<SetPlanOutput> {
    const payload = await this.invokeFn(
      "plan_save_document",
      { repoPath: input.repoPath, taskId: input.taskId, markdown: input.markdown },
      taskMetadataDocumentSchema,
    );
    return updatedAtResultSchema("plan_save_document").parse(payload);
  }

  async planGet(repoPath: string, taskId: string): Promise<TaskDocumentReadResult> {
    return this.readTaskDocument(repoPath, taskId, "plan");
  }

  async taskMetadataGet(repoPath: string, taskId: string): Promise<TaskMetadataPayload> {
    return this.readTaskMetadata(repoPath, taskId);
  }

  async taskDocumentGet(
    repoPath: string,
    taskId: string,
    section: TaskDocumentSection,
  ): Promise<TaskDocumentReadResult> {
    return this.readTaskDocument(repoPath, taskId, section);
  }

  async qaGetReport(repoPath: string, taskId: string): Promise<TaskDocumentReadResult> {
    return this.readTaskDocument(repoPath, taskId, "qa");
  }

  async qaApproved(repoPath: string, taskId: string, markdown: string): Promise<TaskCard> {
    return this.invokeFn("qa_approved", { repoPath, taskId, input: { markdown } }, taskCardSchema);
  }

  async qaRejected(repoPath: string, taskId: string, markdown: string): Promise<TaskCard> {
    return this.invokeFn("qa_rejected", { repoPath, taskId, input: { markdown } }, taskCardSchema);
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
}
