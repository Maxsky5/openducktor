import {
  type AgentSessionIdentity,
  type AgentSessionRecord,
  agentSessionRecordSchema,
  type ExternalTaskSyncEvent,
  type PlanSubtaskInput,
  type TaskAgentSessions,
  type TaskAssetDescriptionMutation,
  type TaskAssetDiscardStagedInput,
  type TaskAssetStageInput,
  type TaskAssetStageResult,
  type TaskCard,
  type TaskCreateInput,
  type TaskStatus,
  type TaskUpdatePatch,
  taskAgentSessionsSchema,
  taskAssetDescriptionMutationSchema,
  taskAssetDiscardStagedInputSchema,
  taskAssetStageInputSchema,
  taskAssetStageResultSchema,
  taskCardSchema,
  taskCreateInputSchema,
  taskMetadataDocumentSchema,
  taskStatusSchema,
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
import type {
  ParsedTaskMetadata,
  TaskMetadataCache,
  TaskMetadataReadOptions,
} from "./task-metadata-cache";

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

type TasksListArgs = { repoPath: string; doneVisibleDays?: number };
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
  constructor(
    private readonly invokeFn: InvokeFn,
    private readonly metadataCache: TaskMetadataCache,
  ) {}

  private readTaskMetadata(
    repoPath: string,
    taskId: string,
    options?: TaskMetadataReadOptions,
  ): Promise<ParsedTaskMetadata> {
    return this.metadataCache.get(this.invokeFn, repoPath, taskId, options);
  }

  private async readTaskDocument(
    repoPath: string,
    taskId: string,
    section: TaskDocumentSection,
    options?: TaskMetadataReadOptions,
  ): Promise<TaskDocumentReadResult> {
    const payload = await this.readTaskMetadata(repoPath, taskId, options);

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

  private invalidateTaskMetadata(repoPath: string, taskId: string): void {
    this.metadataCache.invalidate(repoPath, taskId);
  }

  reconcileExternalTaskSyncEvent(event: ExternalTaskSyncEvent): void {
    const taskIds = event.kind === "external_task_created" ? [event.taskId] : event.taskIds;

    for (const taskId of taskIds) {
      this.invalidateTaskMetadata(event.repoPath, taskId);
    }
  }

  invalidateAllTaskMetadata(): void {
    this.metadataCache.invalidateAll();
  }

  private requireRepoPath(repoPath: string | undefined, documentType: "spec" | "plan"): string {
    if (!repoPath) {
      throw new Error(`repoPath is required to set ${documentType}`);
    }
    return repoPath;
  }

  async tasksList(repoPath: string, doneVisibleDays?: number): Promise<TaskCard[]> {
    const args: TasksListArgs = { repoPath };
    if (doneVisibleDays !== undefined) {
      args.doneVisibleDays = doneVisibleDays;
    }
    return this.invokeFn("tasks_list", args, arrayResultSchema(taskCardSchema, "tasks_list"));
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
    const payload = await this.invokeFn("task_update", args, taskCardSchema);
    this.invalidateTaskMetadata(repoPath, taskId);
    return payload;
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
    const payload = await this.invokeFn(
      "task_delete",
      { repoPath, taskId, deleteSubtasks },
      okResultSchema("task_delete"),
    );
    this.invalidateTaskMetadata(repoPath, taskId);
    return payload;
  }

  async taskClose(repoPath: string, taskId: string): Promise<TaskCard> {
    const payload = await this.invokeFn("task_close", { repoPath, taskId }, taskCardSchema);
    this.invalidateTaskMetadata(repoPath, taskId);
    return payload;
  }

  async taskResetImplementation(repoPath: string, taskId: string): Promise<TaskCard> {
    const payload = await this.invokeFn(
      "task_reset_implementation",
      { repoPath, taskId },
      taskCardSchema,
    );
    this.invalidateTaskMetadata(repoPath, taskId);
    return payload;
  }

  async taskReset(repoPath: string, taskId: string): Promise<TaskCard> {
    const payload = await this.invokeFn("task_reset", { repoPath, taskId }, taskCardSchema);
    this.invalidateTaskMetadata(repoPath, taskId);
    return payload;
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

    this.invalidateTaskMetadata(repoPath, input.taskId);
    return updatedAtResultSchema("set_spec").parse(payload);
  }

  async saveSpecDocument(input: SaveSpecDocumentInput): Promise<SetSpecOutput> {
    const payload = await this.invokeFn(
      "spec_save_document",
      { repoPath: input.repoPath, taskId: input.taskId, markdown: input.markdown },
      taskMetadataDocumentSchema,
    );
    this.invalidateTaskMetadata(input.repoPath, input.taskId);
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

    this.invalidateTaskMetadata(repoPath, input.taskId);
    return updatedAtResultSchema("set_plan").parse(payload);
  }

  async savePlanDocument(input: SavePlanDocumentInput): Promise<SetPlanOutput> {
    const payload = await this.invokeFn(
      "plan_save_document",
      { repoPath: input.repoPath, taskId: input.taskId, markdown: input.markdown },
      taskMetadataDocumentSchema,
    );
    this.invalidateTaskMetadata(input.repoPath, input.taskId);
    return updatedAtResultSchema("plan_save_document").parse(payload);
  }

  async planGet(repoPath: string, taskId: string): Promise<TaskDocumentReadResult> {
    return this.readTaskDocument(repoPath, taskId, "plan");
  }

  async taskMetadataGet(repoPath: string, taskId: string): Promise<ParsedTaskMetadata> {
    return this.readTaskMetadata(repoPath, taskId);
  }

  async taskMetadataGetFresh(repoPath: string, taskId: string): Promise<ParsedTaskMetadata> {
    return this.readTaskMetadata(repoPath, taskId, { forceFresh: true });
  }

  async taskDocumentGet(
    repoPath: string,
    taskId: string,
    section: TaskDocumentSection,
  ): Promise<TaskDocumentReadResult> {
    return this.readTaskDocument(repoPath, taskId, section);
  }

  async taskDocumentGetFresh(
    repoPath: string,
    taskId: string,
    section: TaskDocumentSection,
  ): Promise<TaskDocumentReadResult> {
    return this.readTaskDocument(repoPath, taskId, section, { forceFresh: true });
  }

  async qaGetReport(repoPath: string, taskId: string): Promise<TaskDocumentReadResult> {
    return this.readTaskDocument(repoPath, taskId, "qa");
  }

  async qaApproved(repoPath: string, taskId: string, markdown: string): Promise<TaskCard> {
    const payload = await this.invokeFn(
      "qa_approved",
      { repoPath, taskId, input: { markdown } },
      taskCardSchema,
    );
    this.invalidateTaskMetadata(repoPath, taskId);
    return payload;
  }

  async qaRejected(repoPath: string, taskId: string, markdown: string): Promise<TaskCard> {
    const payload = await this.invokeFn(
      "qa_rejected",
      { repoPath, taskId, input: { markdown } },
      taskCardSchema,
    );
    this.invalidateTaskMetadata(repoPath, taskId);
    return payload;
  }

  async agentSessionsList(repoPath: string, taskId: string): Promise<AgentSessionRecord[]> {
    return this.invokeFn(
      "agent_sessions_list",
      { repoPath, taskId },
      arrayResultSchema(agentSessionRecordSchema, "agent_sessions_list"),
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

  async agentSessionUpsert(
    repoPath: string,
    taskId: string,
    session: AgentSessionRecord,
  ): Promise<void> {
    await this.invokeFn(
      "agent_session_upsert",
      {
        repoPath,
        taskId,
        session,
      },
      booleanResultSchema,
    );
    this.invalidateTaskMetadata(repoPath, taskId);
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
    this.invalidateTaskMetadata(repoPath, taskId);
  }
}
